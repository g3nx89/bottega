import { describe, expect, it } from 'vitest';
import { extractRenderableMessages, type RenderableTurn } from '../../../src/main/renderable-messages.js';

/** Type guard for assistant turns (have tools/images from tool results). */
function isAssistant(turn: RenderableTurn): turn is Extract<RenderableTurn, { role: 'assistant' }> {
  return turn.role === 'assistant';
}

describe('extractRenderableMessages', () => {
  it('should return empty array for empty messages', () => {
    expect(extractRenderableMessages([])).toEqual([]);
  });

  it('should return empty array for null/undefined content', () => {
    expect(extractRenderableMessages([{ role: 'user' }])).toEqual([]);
    expect(extractRenderableMessages([{ role: 'user', content: [] }])).toEqual([]);
  });

  it('should extract a simple user message', () => {
    const messages = [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }];
    expect(extractRenderableMessages(messages)).toEqual([{ role: 'user', text: 'Hello' }]);
  });

  it('should correctly wire Pi SDK toolResult → toolCall via id (camelCase role + id field)', () => {
    // Shape produced by the real Pi SDK: role="toolResult", toolCall.id, content image has data.
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'draw a square' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: "I'll do it." },
          { type: 'toolCall', id: 'call-abc', name: 'figma_render_jsx', arguments: {} },
          { type: 'toolCall', id: 'call-def', name: 'figma_screenshot', arguments: {} },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'call-abc',
        toolName: 'figma_render_jsx',
        isError: false,
        content: [{ type: 'text', text: 'ok' }],
      },
      {
        role: 'toolResult',
        toolCallId: 'call-def',
        toolName: 'figma_screenshot',
        isError: false,
        content: [{ type: 'image', data: 'base64-png', mimeType: 'image/png' }],
      },
    ];
    const turns = extractRenderableMessages(messages);
    expect(turns).toHaveLength(2);
    const assistant = turns[1];
    expect(isAssistant(assistant)).toBe(true);
    if (!isAssistant(assistant)) return;
    // Critical: each tool gets a distinct, defined id so the DOM lookup in
    // completeToolCard can find exactly one card per tool.
    expect(assistant.tools).toEqual([
      { name: 'figma_render_jsx', id: 'call-abc', success: true },
      { name: 'figma_screenshot', id: 'call-def', success: true },
    ]);
    expect(assistant.images).toEqual(['base64-png']);
  });

  it('should still accept legacy snake_case role + toolCallId (back-compat for old session files)', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      {
        role: 'assistant',
        content: [{ type: 'toolCall', toolCallId: 'legacy-1', name: 'figma_status', arguments: {} }],
      },
      {
        role: 'tool_result',
        toolCallId: 'legacy-1',
        isError: false,
        content: [{ type: 'text', text: 'ok' }],
      },
    ];
    const turns = extractRenderableMessages(messages);
    const assistant = turns[1];
    expect(isAssistant(assistant)).toBe(true);
    if (!isAssistant(assistant)) return;
    expect(assistant.tools?.[0]).toEqual({ name: 'figma_status', id: 'legacy-1', success: true });
  });

  it('should extract user message with images', () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look at this' },
          { type: 'image', data: 'base64img' },
        ],
      },
    ];
    expect(extractRenderableMessages(messages)).toEqual([
      { role: 'user', text: 'Look at this', images: ['base64img'] },
    ]);
  });

  it('should extract a simple assistant text response', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Hello! How can I help?' }] },
    ];
    const turns = extractRenderableMessages(messages);
    expect(turns).toHaveLength(2);
    expect(turns[1]).toEqual({ role: 'assistant', text: 'Hello! How can I help?' });
  });

  it('should concatenate multiple text blocks in assistant message', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Part 1. ' },
          { type: 'text', text: 'Part 2.' },
        ],
      },
    ];
    const turns = extractRenderableMessages(messages);
    expect(turns[0].text).toBe('Part 1. Part 2.');
  });

  it('should extract tool calls with their results', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'Take a screenshot' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Taking a screenshot...' },
          { type: 'toolCall', name: 'figma_screenshot', toolCallId: 'tc-1', input: {} },
        ],
      },
      {
        role: 'tool_result',
        toolCallId: 'tc-1',
        isError: false,
        content: [
          { type: 'text', text: 'Screenshot captured' },
          { type: 'image', data: 'screenshot-base64' },
        ],
      },
    ];
    const turns = extractRenderableMessages(messages);
    expect(turns).toHaveLength(2);
    expect(turns[1]).toEqual({
      role: 'assistant',
      text: 'Taking a screenshot...',
      tools: [{ name: 'figma_screenshot', id: 'tc-1', success: true }],
      images: ['screenshot-base64'],
    });
  });

  it('should mark failed tool calls as unsuccessful', () => {
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'toolCall', name: 'figma_execute', toolCallId: 'tc-2', input: {} }],
      },
      {
        role: 'tool_result',
        toolCallId: 'tc-2',
        isError: true,
        content: [{ type: 'text', text: 'Error: node not found' }],
      },
    ];
    const turns = extractRenderableMessages(messages);
    expect(turns).toHaveLength(1);
    expect(isAssistant(turns[0]) && turns[0].tools![0].success).toBe(false);
  });

  it('should handle tool call without matching result (defaults to success)', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Running...' },
          { type: 'toolCall', name: 'figma_status', toolCallId: 'tc-orphan', input: {} },
        ],
      },
    ];
    const turns = extractRenderableMessages(messages);
    expect(isAssistant(turns[0]) && turns[0].tools![0].success).toBe(true);
  });

  it('should handle multiple tool calls in one assistant message', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', name: 'figma_get_selection', toolCallId: 'tc-a', input: {} },
          { type: 'toolCall', name: 'figma_screenshot', toolCallId: 'tc-b', input: {} },
        ],
      },
      { role: 'tool_result', toolCallId: 'tc-a', isError: false, content: [{ type: 'text', text: 'ok' }] },
      {
        role: 'tool_result',
        toolCallId: 'tc-b',
        isError: false,
        content: [{ type: 'image', data: 'img-data' }],
      },
    ];
    const turns = extractRenderableMessages(messages);
    expect(turns).toHaveLength(1);
    const t = turns[0];
    expect(isAssistant(t) && t.tools).toHaveLength(2);
    expect(t.images).toEqual(['img-data']);
  });

  it('should handle consecutive user messages', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'First' }] },
      { role: 'user', content: [{ type: 'text', text: 'Second' }] },
    ];
    const turns = extractRenderableMessages(messages);
    expect(turns).toHaveLength(2);
    expect(turns[0].text).toBe('First');
    expect(turns[1].text).toBe('Second');
  });

  it('should handle consecutive assistant messages', () => {
    const messages = [
      { role: 'assistant', content: [{ type: 'text', text: 'Response 1' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Response 2' }] },
    ];
    const turns = extractRenderableMessages(messages);
    expect(turns).toHaveLength(2);
    expect(turns[0].text).toBe('Response 1');
    expect(turns[1].text).toBe('Response 2');
  });

  it('should filter out empty assistant turns (no text, no tools, no images)', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
      { role: 'assistant', content: [] }, // empty
      { role: 'user', content: [{ type: 'text', text: 'Hello?' }] },
    ];
    const turns = extractRenderableMessages(messages);
    expect(turns).toHaveLength(2);
    expect(turns.every((t) => t.role === 'user')).toBe(true);
  });

  it('should skip tool_result and custom messages in output', () => {
    const messages = [
      { role: 'tool_result', toolCallId: 'tc-1', content: [{ type: 'text', text: 'result' }] },
      { role: 'custom', customType: 'notification', content: 'hello' },
    ];
    expect(extractRenderableMessages(messages)).toEqual([]);
  });

  it('should skip ALL assistant messages from a multi-step judge retry', () => {
    const messages = [
      // Normal turn
      { role: 'user', content: [{ type: 'text', text: 'Make a button' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Done!' }] },
      // Judge retry (multi-step: text + tool + text)
      { role: 'user', content: [{ type: 'text', text: '[JUDGE_RETRY]\nFix alignment' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Fixing...' },
          { type: 'toolCall', name: 'figma_set_fills', toolCallId: 'tc-retry-1', input: {} },
        ],
      },
      {
        role: 'tool_result',
        toolCallId: 'tc-retry-1',
        isError: false,
        content: [{ type: 'text', text: 'ok' }],
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Now taking a screenshot...' },
          { type: 'toolCall', name: 'figma_screenshot', toolCallId: 'tc-retry-2', input: {} },
        ],
      },
      {
        role: 'tool_result',
        toolCallId: 'tc-retry-2',
        isError: false,
        content: [{ type: 'image', data: 'retry-img' }],
      },
      { role: 'assistant', content: [{ type: 'text', text: 'Fixed the alignment.' }] },
      // Next real user message — should NOT be skipped
      { role: 'user', content: [{ type: 'text', text: 'Looks great!' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Thanks!' }] },
    ];
    const turns = extractRenderableMessages(messages);
    // Should only have: user "Make a button", assistant "Done!", user "Looks great!", assistant "Thanks!"
    expect(turns).toHaveLength(4);
    expect(turns[0].text).toBe('Make a button');
    expect(turns[1].text).toBe('Done!');
    expect(turns[2].text).toBe('Looks great!');
    expect(turns[3].text).toBe('Thanks!');
  });

  it('should skip legacy "## Criterion:" judge prompts persisted in old sessions', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'Make a card' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Done!' }] },
      // Legacy contamination: judge prompt and verdict that older builds
      // accidentally wrote into the main session file.
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '## Criterion: Alignment\nEvaluate layout precision using the provided data.\n\nEvaluate using: ...',
          },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '{"pass": true, "finding": "All aligned", "evidence": "...", "actionItems": []}' },
        ],
      },
      { role: 'user', content: [{ type: 'text', text: 'Make it blue' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
    ];
    const turns = extractRenderableMessages(messages);
    expect(turns).toHaveLength(4);
    expect(turns[0].text).toBe('Make a card');
    expect(turns[1].text).toBe('Done!');
    expect(turns[2].text).toBe('Make it blue');
    expect(turns[3].text).toBe('Done.');
  });

  it('should handle a realistic multi-turn conversation', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'Create a button' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: "I'll create a button for you." },
          { type: 'toolCall', name: 'figma_create_child', toolCallId: 'tc-1', input: {} },
        ],
      },
      { role: 'tool_result', toolCallId: 'tc-1', isError: false, content: [{ type: 'text', text: 'Created' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: "Here's a screenshot of the result." },
          { type: 'toolCall', name: 'figma_screenshot', toolCallId: 'tc-2', input: {} },
        ],
      },
      {
        role: 'tool_result',
        toolCallId: 'tc-2',
        isError: false,
        content: [{ type: 'image', data: 'final-screenshot' }],
      },
      { role: 'user', content: [{ type: 'text', text: 'Make it purple' }] },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Done! The button is now purple.' }],
      },
    ];
    const turns = extractRenderableMessages(messages);
    expect(turns).toHaveLength(5); // user, assistant+tool, assistant+screenshot, user, assistant
    expect(turns[0]).toEqual({ role: 'user', text: 'Create a button' });
    const t1 = turns[1];
    expect(isAssistant(t1) && t1.tools).toHaveLength(1);
    expect(isAssistant(t1) && t1.tools![0].name).toBe('figma_create_child');
    expect(turns[2].images).toEqual(['final-screenshot']);
    expect(turns[3]).toEqual({ role: 'user', text: 'Make it purple' });
    expect(turns[4].text).toBe('Done! The button is now purple.');
  });
});
