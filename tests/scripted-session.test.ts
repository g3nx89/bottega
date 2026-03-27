import { describe, expect, it } from 'vitest';
import {
  agentEndEvent,
  compactionEvents,
  fullTurnScript,
  retryEvents,
  screenshotToolEvents,
  textDeltaEvents,
  thinkingDeltaEvents,
  toolCallEvents,
  usageEvent,
} from './helpers/script-fragments.js';
import { ScriptedSession } from './helpers/scripted-session.js';

describe('ScriptedSession', () => {
  it('should emit all events in order on prompt()', async () => {
    const script = [...textDeltaEvents('Hello'), ...agentEndEvent()];
    const session = new ScriptedSession(script);
    const events: any[] = [];
    session.subscribe((e) => events.push(e));

    await session.prompt('test');

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('message_update');
    expect(events[0].assistantMessageEvent.delta).toBe('Hello');
    expect(events[1].type).toBe('agent_end');
  });

  it('should record prompt history', async () => {
    const session = new ScriptedSession([...agentEndEvent()]);
    session.subscribe(() => {});

    await session.prompt('first');
    await session.prompt('second');

    expect(session.promptHistory).toEqual(['first', 'second']);
  });

  it('should stop emitting on abort()', async () => {
    const script = [
      ...textDeltaEvents('A'),
      { type: 'agent_end', delayMs: 100 }, // delay gives time to abort
    ];
    const session = new ScriptedSession(script);
    const events: any[] = [];
    session.subscribe((e) => events.push(e));

    const promptPromise = session.prompt('test');
    // Abort after first event emits but before the delayed one
    await new Promise((r) => setTimeout(r, 10));
    await session.abort();
    await promptPromise;

    expect(session.abortCount).toBe(1);
    // Should have emitted the first event but not the delayed one
    expect(events.length).toBeLessThanOrEqual(1);
  });

  it('should handle empty script gracefully', async () => {
    const session = new ScriptedSession([]);
    const events: any[] = [];
    session.subscribe((e) => events.push(e));

    await session.prompt('test');
    expect(events).toHaveLength(0);
    expect(session.promptHistory).toEqual(['test']);
  });

  it('should replay the same script on multiple prompts', async () => {
    const script = [...textDeltaEvents('Hi'), ...agentEndEvent()];
    const session = new ScriptedSession(script);
    const events: any[] = [];
    session.subscribe((e) => events.push(e));

    await session.prompt('first');
    await session.prompt('second');

    // Each prompt replays all events
    expect(events).toHaveLength(4); // 2 events × 2 prompts
  });

  it('should set isReplaying during execution', async () => {
    const script = [{ type: 'agent_end', delayMs: 50 }];
    const session = new ScriptedSession(script);
    session.subscribe(() => {});

    const promise = session.prompt('test');
    expect(session.isReplaying).toBe(true);
    await promise;
    expect(session.isReplaying).toBe(false);
  });

  it('should support multiple subscribers', async () => {
    const session = new ScriptedSession([...agentEndEvent()]);
    const events1: any[] = [];
    const events2: any[] = [];
    session.subscribe((e) => events1.push(e));
    session.subscribe((e) => events2.push(e));

    await session.prompt('test');

    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(1);
  });
});

describe('Script fragments', () => {
  it('textDeltaEvents splits text into chunks', () => {
    const events = textDeltaEvents('Hello World', 5);
    expect(events).toHaveLength(3); // "Hello", " Worl", "d"
    expect(events[0].data?.assistantMessageEvent.delta).toBe('Hello');
    expect(events[1].data?.assistantMessageEvent.delta).toBe(' Worl');
    expect(events[2].data?.assistantMessageEvent.delta).toBe('d');
  });

  it('thinkingDeltaEvents creates thinking event', () => {
    const events = thinkingDeltaEvents('hmm');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('message_update');
    expect(events[0].data?.assistantMessageEvent.type).toBe('thinking_delta');
  });

  it('toolCallEvents creates start+end pair', () => {
    const events = toolCallEvents('figma_resize', 'c1', { success: true, result: { ok: true } });
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('tool_execution_start');
    expect(events[0].data?.toolName).toBe('figma_resize');
    expect(events[1].type).toBe('tool_execution_end');
    expect(events[1].data?.isError).toBe(false);
  });

  it('toolCallEvents with failure sets isError true', () => {
    const events = toolCallEvents('figma_delete', 'c2', { success: false });
    expect(events[1].data?.isError).toBe(true);
  });

  it('screenshotToolEvents creates image content', () => {
    const events = screenshotToolEvents('s1', 'base64data');
    expect(events).toHaveLength(2);
    expect(events[1].data?.result.content[0].type).toBe('image');
    expect(events[1].data?.result.content[0].data).toBe('base64data');
  });

  it('usageEvent creates message_end with usage', () => {
    const events = usageEvent(100, 50);
    expect(events[0].data?.message.usage.input).toBe(100);
    expect(events[0].data?.message.usage.output).toBe(50);
    expect(events[0].data?.message.usage.totalTokens).toBe(150);
  });

  it('compactionEvents creates start+end pair', () => {
    const events = compactionEvents();
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('auto_compaction_start');
    expect(events[1].type).toBe('auto_compaction_end');
  });

  it('retryEvents creates start+end pair', () => {
    const events = retryEvents();
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('auto_retry_start');
    expect(events[1].type).toBe('auto_retry_end');
  });

  it('fullTurnScript composes a complete turn', () => {
    const script = fullTurnScript({
      thinking: 'Let me think...',
      text: 'Done!',
      tools: [{ name: 'figma_resize', success: true }],
      screenshot: 'img-data',
      usage: { input: 500, output: 200 },
    });

    const types = script.map((e) => e.type);
    expect(types).toContain('message_update'); // thinking + text
    expect(types).toContain('tool_execution_start');
    expect(types).toContain('tool_execution_end');
    expect(types).toContain('message_end');
    expect(types[types.length - 1]).toBe('agent_end');
  });

  it('fullTurnScript with minimal options', () => {
    const script = fullTurnScript();
    expect(script).toHaveLength(1); // just agent_end
    expect(script[0].type).toBe('agent_end');
  });
});
