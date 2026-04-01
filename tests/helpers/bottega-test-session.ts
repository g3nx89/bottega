/**
 * BottegaTestSession — playbook-driven agent testing without LLM calls.
 *
 * Creates a real Pi SDK AgentSession with:
 * - Playbook streamFn replacing the LLM
 * - Bottega's actual tools (with mocked deps)
 * - Real compression extension (hook chain preserved)
 * - Event collection for assertions
 *
 * Inspired by @marcfargas/pi-test-harness, adapted for Bottega's architecture.
 */

import os from 'node:os';
import { getModel } from '@mariozechner/pi-ai';
import {
  type AgentSessionEvent,
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from '@mariozechner/pi-coding-agent';
import { CompressionConfigManager, type CompressionProfile } from '../../src/main/compression/compression-config.js';
import { createCompressionExtensionFactory } from '../../src/main/compression/extension-factory.js';
import { CompressionMetricsCollector } from '../../src/main/compression/metrics.js';
import { createFigmaTools, type ToolDeps } from '../../src/main/tools/index.js';
import {
  type BottegaTestEvents,
  createEventCollector,
  type ToolCallRecord,
  type ToolResultRecord,
} from './event-collector.js';
import { createTestToolDeps } from './mock-connector.js';
import { assertPlaybookConsumed, createPlaybookStreamFn, type PlaybookState, type Turn } from './playbook.js';

// ── Types ───────────────────────────────────────────────────

export type MockToolHandler =
  | string
  | { content: Array<{ type: string; text: string }>; isError?: boolean }
  | ((
      params: Record<string, unknown>,
    ) => string | { content: Array<{ type: string; text: string }>; isError?: boolean });

export interface BottegaTestSessionOptions {
  /** Override specific tool deps (rest auto-mocked via createTestToolDeps) */
  toolDeps?: Partial<ToolDeps>;
  /** Mock specific tools — return canned responses instead of executing */
  mockTools?: Record<string, MockToolHandler>;
  /** Compression profile (default: 'balanced') */
  compressionProfile?: CompressionProfile;
  /** System prompt override */
  systemPrompt?: string;
  /** Abort test on real tool throw (default: true) */
  propagateErrors?: boolean;
}

export interface BottegaTestSession {
  /** Run a conversation script */
  run(...turns: Turn[]): Promise<void>;
  /** Collected events */
  events: BottegaTestEvents;
  /** Playbook consumption state */
  playbook: { consumed: number; remaining: number };
  /** Compression metrics */
  compressionMetrics: CompressionMetricsCollector;
  /** Compression config manager (for profile assertions) */
  configManager: CompressionConfigManager;
  /** Tool deps used (for assertion on mock calls) */
  deps: ToolDeps;
  /** Cleanup */
  dispose(): void;
}

// ── Mock tool normalization ─────────────────────────────────

function normalizeMockResult(
  handler: MockToolHandler,
  params: Record<string, unknown>,
): { content: Array<{ type: string; text: string }>; isError?: boolean } {
  let raw: string | { content: Array<{ type: string; text: string }>; isError?: boolean };
  if (typeof handler === 'string') {
    raw = handler;
  } else if (typeof handler === 'function') {
    raw = handler(params);
  } else {
    raw = handler;
  }
  if (typeof raw === 'string') {
    return { content: [{ type: 'text', text: raw }] };
  }
  return raw;
}

// ── Factory ─────────────────────────────────────────────────

export async function createBottegaTestSession(options: BottegaTestSessionOptions = {}): Promise<BottegaTestSession> {
  const propagateErrors = options.propagateErrors ?? true;

  // 1. Assemble tool deps (real OperationQueue + mocked everything else)
  const baseDeps = createTestToolDeps();
  const deps: ToolDeps = {
    ...baseDeps,
    fileKey: 'test-file-key',
    ...options.toolDeps,
  } as ToolDeps;

  // 2. Create Bottega's actual tools
  const bottegaTools = createFigmaTools(deps);

  // 3. Compression infrastructure (real)
  const configManager = new CompressionConfigManager();
  if (options.compressionProfile) {
    configManager.setProfile(options.compressionProfile);
  }
  const compressionMetrics = new CompressionMetricsCollector('test-session', 'playbook', 1_000_000);
  const compressionExtensionFactory = createCompressionExtensionFactory(configManager, compressionMetrics);

  // 4. Resource loader with compression extension
  const resourceLoader = new DefaultResourceLoader({
    cwd: os.tmpdir(),
    systemPrompt: options.systemPrompt ?? 'You are a test agent.',
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    extensionFactories: [compressionExtensionFactory],
  });
  await resourceLoader.reload();

  // 5. Create a real Pi SDK model reference (never actually called — playbook replaces streamFn)
  // Set dummy API key if missing — the model is never invoked (playbook replaces streamFn),
  // but getModel() validates the key exists at construction time.
  const hadKey = !!process.env.ANTHROPIC_API_KEY;
  if (!hadKey) process.env.ANTHROPIC_API_KEY = 'test-key-not-used';
  const model = getModel('anthropic', 'claude-sonnet-4-6');
  if (!hadKey) delete process.env.ANTHROPIC_API_KEY;

  // 6. Create real agent session
  const sessionManager = SessionManager.inMemory();
  const settingsManager = SettingsManager.inMemory();

  const { session } = await createAgentSession({
    cwd: os.tmpdir(),
    model,
    tools: [], // no built-in coding tools
    customTools: bottegaTools,
    resourceLoader,
    sessionManager,
    settingsManager,
  });

  // 7. Bypass auth checks
  const agent = (session as any).agent;
  const origModelRegistry = (session as any)._modelRegistry;
  if (origModelRegistry) {
    origModelRegistry.getApiKeyAndHeaders = async () => ({ ok: true, apiKey: 'test-key', headers: {} });
  }

  // 8. Event collection
  const events = createEventCollector();
  let currentStep = 0;

  session.subscribe((event: AgentSessionEvent) => {
    events.all.push(event);

    if (event.type === 'tool_execution_start') {
      const record: ToolCallRecord = {
        step: currentStep,
        toolName: event.toolName,
        input: (event as any).args ?? {},
      };
      events.toolCalls.push(record);
    }

    if (event.type === 'tool_execution_end') {
      const resultText =
        event.result?.content
          ?.filter((c: any) => c.type === 'text')
          ?.map((c: any) => c.text)
          ?.join('\n') ?? '';

      const record: ToolResultRecord = {
        step: currentStep,
        toolName: event.toolName,
        toolCallId: (event as any).toolCallId ?? '',
        text: resultText,
        content: event.result?.content ?? [],
        isError: !!event.isError,
        mocked: false, // Updated by wrapper for mocked tools
      };
      events.toolResults.push(record);
    }

    if (event.type === 'message_end') {
      events.messages.push((event as any).message);
    }
  });

  // 9. Playbook state
  let playbookState: PlaybookState | null = null;

  // 10. Capture original tools for wrapping
  const originalTools: ToolDefinition[] = [...(agent.state.tools as ToolDefinition[])];

  const testSession: BottegaTestSession = {
    events,
    compressionMetrics,
    configManager,
    deps,

    get playbook() {
      return {
        consumed: playbookState?.consumed ?? 0,
        remaining: playbookState?.remaining ?? 0,
      };
    },

    async run(...turns: Turn[]): Promise<void> {
      // Create playbook streamFn and replace model
      const { streamFn, state } = createPlaybookStreamFn(turns);
      playbookState = state;
      agent.streamFn = streamFn;

      // Wrap ALL tools for callback firing + mock interception
      const mockTools = options.mockTools ?? {};
      const wrappedTools = originalTools.map((tool) => {
        const mockHandler = mockTools[tool.name];

        if (mockHandler) {
          // Mocked tool — replace execute entirely
          return {
            ...tool,
            execute: async (
              toolCallId: string,
              params: Record<string, unknown>,
              _signal?: AbortSignal,
              _onUpdate?: any,
              _ctx?: any,
            ) => {
              const result = normalizeMockResult(mockHandler, params);

              // Fire .chain() callback
              fireThenCallback(state, toolCallId, {
                step: state.consumed,
                toolName: tool.name,
                toolCallId,
                text: result.content
                  .filter((c) => c.type === 'text')
                  .map((c) => c.text)
                  .join('\n'),
                content: result.content,
                isError: result.isError ?? false,
                mocked: true,
              });

              // Mark the event-collector result as mocked (it gets recorded
              // via session.subscribe *after* execute returns, so we defer).
              queueMicrotask(() => {
                const lastResult = events.toolResults.findLast((r) => r.toolName === tool.name);
                if (lastResult) lastResult.mocked = true;
              });

              return { content: result.content, details: {} };
            },
          } as ToolDefinition;
        }

        // Non-mocked tool — wrap execute for .chain() callback support
        const originalExecute = tool.execute;
        return {
          ...tool,
          execute: async (
            toolCallId: string,
            params: Record<string, unknown>,
            signal?: AbortSignal,
            onUpdate?: any,
            ctx?: any,
          ) => {
            try {
              const result = await originalExecute.call(tool, toolCallId, params, signal, onUpdate, ctx);
              const text = (result.content ?? [])
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text)
                .join('\n');

              // Fire .chain() callback with actual result
              fireThenCallback(state, toolCallId, {
                step: state.consumed,
                toolName: tool.name,
                toolCallId,
                text,
                content: result.content ?? [],
                isError: false,
                mocked: false,
              });

              return result;
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);

              fireThenCallback(state, toolCallId, {
                step: state.consumed,
                toolName: tool.name,
                toolCallId,
                text: errMsg,
                content: [{ type: 'text', text: errMsg }],
                isError: true,
                mocked: false,
              });

              if (propagateErrors) throw err;

              return {
                content: [{ type: 'text' as const, text: errMsg }],
                details: {},
                isError: true,
              };
            }
          },
        } as ToolDefinition;
      });
      agent.setTools(wrappedTools);

      // Run each turn
      for (const turn of turns) {
        currentStep = state.consumed;
        try {
          await session.prompt(turn.prompt);
          await agent.waitForIdle();
        } catch (err) {
          if (propagateErrors) throw err;
        }
      }

      // Auto-assert playbook fully consumed
      const allActions = turns.flatMap((t) => t.actions);
      assertPlaybookConsumed(state, allActions);
    },

    dispose(): void {
      session.dispose();
    },
  };

  return testSession;
}

// ── Helpers ─────────────────────────────────────────────────

function fireThenCallback(state: PlaybookState, toolCallId: string, record: ToolResultRecord): void {
  const callback = state.pendingCallbacks.get(toolCallId) ?? state.pendingCallbacks.get(record.toolName);
  const key = state.pendingCallbacks.has(toolCallId) ? toolCallId : record.toolName;
  if (callback) {
    state.pendingCallbacks.delete(key);
    try {
      callback(record);
    } catch {
      // Swallow callback errors — they'll surface as assertion failures in the test
    }
  }
}
