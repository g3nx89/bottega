/**
 * Playbook DSL — scripts agent conversations for deterministic testing.
 *
 * Inspired by @marcfargas/pi-test-harness. Replaces the LLM streamFn
 * with a scripted queue of tool calls and text responses.
 *
 * Usage:
 *   await t.run(
 *     when("Create a button", [
 *       calls("figma_get_file_data", { depth: 2 }),
 *       calls("figma_render_jsx", () => ({ jsx })).chain(r => { nodeId = r.text; }),
 *       calls("figma_screenshot", () => ({ nodeId })),
 *       says("Done!"),
 *     ]),
 *   );
 */

import {
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  createAssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
} from '@mariozechner/pi-ai';
import type { ToolResultRecord } from './event-collector.js';

// ── Types ───────────────────────────────────────────────────

export interface PlaybookAction {
  type: 'call' | 'say';
  toolName?: string;
  params?: Record<string, unknown> | (() => Record<string, unknown>);
  text?: string;
  thenCallback?: (result: ToolResultRecord) => void;
}

export interface Turn {
  prompt: string;
  actions: PlaybookAction[];
}

export interface PlaybookState {
  consumed: number;
  remaining: number;
  consumedActions: PlaybookAction[];
  pendingCallbacks: Map<string, (result: ToolResultRecord) => void>;
}

// ── DSL Builders ────────────────────────────────────────────

class CallAction {
  readonly action: PlaybookAction;

  constructor(toolName: string, params: Record<string, unknown> | (() => Record<string, unknown>)) {
    this.action = { type: 'call', toolName, params };
  }

  chain(callback: (result: ToolResultRecord) => void): CallAction {
    this.action.thenCallback = callback;
    return this;
  }
}

/**
 * Script a tool call from the "model".
 * @param toolName Tool to invoke
 * @param params Static params or late-bound function
 */
export function calls(
  toolName: string,
  params: Record<string, unknown> | (() => Record<string, unknown>) = {},
): CallAction {
  return new CallAction(toolName, params);
}

/** Script a text response from the "model". Ends the agent loop for this turn. */
export function says(text: string): PlaybookAction {
  return { type: 'say', text };
}

/**
 * Define one user→model turn.
 * @param prompt User message text
 * @param actions Scripted model behavior (calls/says sequence)
 */
export function when(prompt: string, actions: Array<CallAction | PlaybookAction>): Turn {
  return {
    prompt,
    actions: actions.map((a) => (a instanceof CallAction ? a.action : a)),
  };
}

// ── PlaybookStreamFn ────────────────────────────────────────

function resolveParams(
  params: Record<string, unknown> | (() => Record<string, unknown>) | undefined,
): Record<string, unknown> {
  if (!params) return {};
  if (typeof params === 'function') return params();
  return params;
}

function createAssistantMessage(action: PlaybookAction, toolCallCounter: number): AssistantMessage {
  const content: AssistantMessage['content'] = [];

  if (action.type === 'say') {
    content.push({ type: 'text', text: action.text ?? '' });
  } else if (action.type === 'call') {
    content.push({
      type: 'toolCall',
      id: `playbook-tc-${toolCallCounter}`,
      name: action.toolName!,
      arguments: resolveParams(action.params),
    });
  }

  return {
    role: 'assistant',
    content,
    api: 'openai-responses',
    provider: 'test',
    model: 'playbook',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: action.type === 'call' ? 'toolUse' : 'stop',
    timestamp: Date.now(),
  };
}

function formatPlaybookDiagnostic(
  type: 'exhausted' | 'remaining',
  state: PlaybookState,
  remainingActions?: PlaybookAction[],
): string {
  if (type === 'exhausted') {
    const last = state.consumedActions[state.consumedActions.length - 1];
    const lines = [`Playbook exhausted unexpectedly.`, `  Consumed ${state.consumed} action(s).`];
    if (last) {
      const desc = last.type === 'call' ? `calls("${last.toolName}")` : `says("${last.text?.slice(0, 40)}")`;
      lines.push(`  Last consumed: ${desc} at step ${state.consumed}`);
    }
    lines.push(
      '',
      '  The agent loop called streamFn but no more playbook actions were available.',
      '  This usually means a tool produced an unexpected result that caused',
      '  additional streamFn calls (retries, error handling).',
    );
    return lines.join('\n');
  }

  if (type === 'remaining' && remainingActions) {
    const lines = [
      `Playbook not fully consumed after run() completed.`,
      `  Consumed ${state.consumed} of ${state.consumed + remainingActions.length} action(s).`,
      `  Remaining:`,
    ];
    for (const action of remainingActions.slice(0, 5)) {
      const desc = action.type === 'call' ? `calls("${action.toolName}")` : `says("${action.text?.slice(0, 40)}")`;
      lines.push(`    - ${desc}`);
    }
    if (remainingActions.length > 5) {
      lines.push(`    ... +${remainingActions.length - 5} more`);
    }
    return lines.join('\n');
  }

  return 'Unknown playbook diagnostic.';
}

/**
 * Creates a Pi SDK-compatible streamFn that replays scripted actions.
 * Returns the streamFn and a mutable state object for tracking consumption.
 */
export function createPlaybookStreamFn(turns: Turn[]): {
  streamFn: (model: Model<any>, context: Context, options?: SimpleStreamOptions) => AssistantMessageEventStream;
  state: PlaybookState;
} {
  const queue: PlaybookAction[] = [];
  for (const turn of turns) {
    queue.push(...turn.actions);
  }

  const state: PlaybookState = {
    consumed: 0,
    remaining: queue.length,
    consumedActions: [],
    pendingCallbacks: new Map(),
  };

  let toolCallCounter = 0;

  const streamFn = (
    _model: Model<any>,
    _context: Context,
    _options?: SimpleStreamOptions,
  ): AssistantMessageEventStream => {
    const stream = createAssistantMessageEventStream();
    const action = queue.shift();

    if (!action) {
      const diagnostic = formatPlaybookDiagnostic('exhausted', state);
      const fallback: AssistantMessage = {
        role: 'assistant',
        content: [{ type: 'text', text: `[PLAYBOOK EXHAUSTED] ${diagnostic}` }],
        api: 'openai-responses',
        provider: 'test',
        model: 'playbook',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.now(),
      };
      queueMicrotask(() => {
        stream.push({ type: 'done', reason: 'stop', message: fallback });
      });
      return stream;
    }

    state.consumed++;
    state.remaining = queue.length;
    state.consumedActions.push(action);

    if (action.type === 'call') toolCallCounter++;
    const message = createAssistantMessage(action, toolCallCounter);

    // Register .chain() callback keyed by tool call ID
    if (action.type === 'call' && action.thenCallback) {
      const tcContent = message.content.find((c) => c.type === 'toolCall');
      const tcId = tcContent && 'id' in tcContent ? (tcContent as any).id : action.toolName!;
      state.pendingCallbacks.set(tcId, action.thenCallback);
    }

    queueMicrotask(() => {
      stream.push({
        type: 'done',
        reason: message.stopReason === 'toolUse' ? 'toolUse' : 'stop',
        message,
      });
    });

    return stream;
  };

  return { streamFn, state };
}

/** Asserts all playbook actions were consumed. Throws with diagnostic if not. */
export function assertPlaybookConsumed(state: PlaybookState, allActions: PlaybookAction[]): void {
  if (state.remaining > 0) {
    const remaining = allActions.slice(state.consumed);
    throw new Error(formatPlaybookDiagnostic('remaining', state, remaining));
  }
}
