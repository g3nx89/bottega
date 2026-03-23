import type { ScriptEvent } from './scripted-session.js';

/** Split text into text_delta events of given chunk size */
export function textDeltaEvents(text: string, chunkSize = 20): ScriptEvent[] {
  const events: ScriptEvent[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    events.push({
      type: 'message_update',
      data: { assistantMessageEvent: { type: 'text_delta', delta: text.slice(i, i + chunkSize) } },
    });
  }
  return events;
}

/** Thinking delta events */
export function thinkingDeltaEvents(text: string): ScriptEvent[] {
  return [
    {
      type: 'message_update',
      data: { assistantMessageEvent: { type: 'thinking_delta', delta: text } },
    },
  ];
}

/** Tool call start + end pair */
export function toolCallEvents(
  toolName: string,
  callId: string,
  opts: {
    params?: any;
    success?: boolean;
    result?: any;
    delayMs?: number;
  } = {},
): ScriptEvent[] {
  const success = opts.success ?? true;
  return [
    {
      type: 'tool_execution_start',
      data: { toolName, toolCallId: callId, toolParams: opts.params ?? {} },
    },
    {
      type: 'tool_execution_end',
      data: {
        toolName,
        toolCallId: callId,
        isError: !success,
        result: opts.result ?? {
          content: [{ type: 'text', text: JSON.stringify({ success }) }],
        },
      },
      delayMs: opts.delayMs,
    },
  ];
}

/** Screenshot tool call (returns image content) */
export function screenshotToolEvents(callId: string, base64Data: string): ScriptEvent[] {
  return [
    {
      type: 'tool_execution_start',
      data: { toolName: 'figma_screenshot', toolCallId: callId, toolParams: {} },
    },
    {
      type: 'tool_execution_end',
      data: {
        toolName: 'figma_screenshot',
        toolCallId: callId,
        isError: false,
        result: {
          content: [{ type: 'image', data: base64Data, mimeType: 'image/png' }],
        },
      },
    },
  ];
}

/** Message end with usage stats */
export function usageEvent(input: number, output: number): ScriptEvent[] {
  return [
    {
      type: 'message_end',
      data: { message: { usage: { input, output, totalTokens: input + output } } },
    },
  ];
}

/** Agent end event */
export function agentEndEvent(): ScriptEvent[] {
  return [{ type: 'agent_end' }];
}

/** Compaction start + end pair */
export function compactionEvents(delayMs = 0): ScriptEvent[] {
  return [{ type: 'auto_compaction_start' }, { type: 'auto_compaction_end', delayMs }];
}

/** Retry start + end pair */
export function retryEvents(delayMs = 0): ScriptEvent[] {
  return [{ type: 'auto_retry_start' }, { type: 'auto_retry_end', delayMs }];
}

/** Compose a full agent turn: thinking → text → tools → usage → end */
export function fullTurnScript(
  opts: {
    thinking?: string;
    text?: string;
    tools?: Array<{ name: string; callId?: string; result?: any; success?: boolean }>;
    screenshot?: string;
    usage?: { input: number; output: number };
  } = {},
): ScriptEvent[] {
  const events: ScriptEvent[] = [];

  if (opts.thinking) events.push(...thinkingDeltaEvents(opts.thinking));

  if (opts.tools) {
    for (const tool of opts.tools) {
      events.push(
        ...toolCallEvents(tool.name, tool.callId ?? `call-${tool.name}`, {
          success: tool.success,
          result: tool.result,
        }),
      );
    }
  }

  if (opts.screenshot) {
    events.push(...screenshotToolEvents('call-screenshot', opts.screenshot));
  }

  if (opts.text) events.push(...textDeltaEvents(opts.text));

  if (opts.usage) {
    events.push(...usageEvent(opts.usage.input, opts.usage.output));
  }

  events.push(...agentEndEvent());
  return events;
}
