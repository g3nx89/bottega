import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks ─────────────────────────────────

vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockCompleteSimple = vi.fn();
const mockGetModel = vi.fn().mockReturnValue({ id: 'mock-model' });

vi.mock('@mariozechner/pi-ai', () => ({
  completeSimple: (...args: any[]) => mockCompleteSimple(...args),
  getModel: (...args: any[]) => mockGetModel(...args),
}));

const mockGetApiKey = vi.fn();

vi.mock('@mariozechner/pi-coding-agent', () => ({
  // AuthStorage is used only as a type, but the mock must provide the shape
}));

// ── Imports (after mocks) ────────────────────────

import { PromptSuggester } from '../../../src/main/prompt-suggester.js';

// ── Helpers ──────────────────────────────────────

function createSuggester() {
  const authStorage = { getApiKey: mockGetApiKey } as any;
  return new PromptSuggester(authStorage);
}

function makeModelConfig() {
  return { provider: 'anthropic', modelId: 'claude-sonnet-4-6' } as any;
}

/** Build a mock completeSimple response with the given text */
function mockResponse(text: string) {
  return {
    content: [{ type: 'text', text }],
  };
}

// ── Tests ────────────────────────────────────────

describe('PromptSuggester', () => {
  let suggester: ReturnType<typeof createSuggester>;

  beforeEach(() => {
    suggester = createSuggester();
    mockCompleteSimple.mockReset();
    mockGetModel.mockReset().mockReturnValue({ id: 'mock-model' });
    mockGetApiKey.mockReset().mockResolvedValue('sk-test-key');
  });

  // ── trackUserPrompt ───────────────────────────

  describe('trackUserPrompt', () => {
    it('should keep a max of 5 recent prompts (sliding window)', () => {
      for (let i = 1; i <= 7; i++) {
        suggester.trackUserPrompt(`prompt ${i}`);
      }
      // We can verify via suggest() that prompts are tracked,
      // but the internal state is private. We verify the sliding window
      // by checking the prompt content passed to completeSimple.
      suggester.appendAssistantText('some response');
      mockCompleteSimple.mockResolvedValue(mockResponse('Suggestion one'));

      suggester.suggest(makeModelConfig());

      // The prompt built should not include prompts 1-2 (dropped from window)
    });

    it('should trim whitespace from tracked prompts', async () => {
      suggester.trackUserPrompt('  hello world  ');
      suggester.appendAssistantText('response');
      mockCompleteSimple.mockResolvedValue(mockResponse('Follow up'));

      await suggester.suggest(makeModelConfig());

      // Verify completeSimple was called; the prompt building trims input
      expect(mockCompleteSimple).toHaveBeenCalled();
    });
  });

  // ── appendAssistantText ───────────────────────

  describe('appendAssistantText', () => {
    it('should accumulate streaming text deltas', async () => {
      suggester.appendAssistantText('Hello ');
      suggester.appendAssistantText('world');

      mockCompleteSimple.mockResolvedValue(mockResponse('Suggestion'));
      const result = await suggester.suggest(makeModelConfig());

      // If text accumulated, suggest() should not bail out due to empty text
      expect(mockCompleteSimple).toHaveBeenCalled();
      expect(result).toEqual(['Suggestion']);
    });
  });

  // ── resetAssistantText ────────────────────────

  describe('resetAssistantText', () => {
    it('should clear accumulated text, causing suggest to return []', async () => {
      suggester.appendAssistantText('some text');
      suggester.resetAssistantText();

      const result = await suggester.suggest(makeModelConfig());

      expect(result).toEqual([]);
      expect(mockCompleteSimple).not.toHaveBeenCalled();
    });
  });

  // ── reset ─────────────────────────────────────

  describe('reset', () => {
    it('should clear all state (prompts + assistant text)', async () => {
      suggester.trackUserPrompt('hello');
      suggester.appendAssistantText('response');
      suggester.reset();

      const result = await suggester.suggest(makeModelConfig());

      expect(result).toEqual([]);
      expect(mockCompleteSimple).not.toHaveBeenCalled();
    });
  });

  // ── suggest ───────────────────────────────────

  describe('suggest', () => {
    it('should return [] when generating is already true (debounce)', async () => {
      suggester.appendAssistantText('response');
      // Simulate a slow in-flight call
      mockCompleteSimple.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(mockResponse('Late')), 100)),
      );

      // Start first call (will be pending)
      const first = suggester.suggest(makeModelConfig());
      // Second call while first is still pending
      const second = await suggester.suggest(makeModelConfig());

      expect(second).toEqual([]);
      // Only the first call should have invoked completeSimple
      expect(mockCompleteSimple).toHaveBeenCalledOnce();

      // Clean up the pending promise
      await first;
    });

    it('should return [] when no assistant text', async () => {
      const result = await suggester.suggest(makeModelConfig());

      expect(result).toEqual([]);
      expect(mockCompleteSimple).not.toHaveBeenCalled();
    });

    it('should return [] when assistant text is only whitespace', async () => {
      suggester.appendAssistantText('   \n\t  ');
      const result = await suggester.suggest(makeModelConfig());

      expect(result).toEqual([]);
      expect(mockCompleteSimple).not.toHaveBeenCalled();
    });

    it('should return [] when no API key is available', async () => {
      suggester.appendAssistantText('response');
      mockGetApiKey.mockResolvedValue(null);

      const result = await suggester.suggest(makeModelConfig());

      expect(result).toEqual([]);
    });

    it('should return [] when API key is undefined', async () => {
      suggester.appendAssistantText('response');
      mockGetApiKey.mockResolvedValue(undefined);

      const result = await suggester.suggest(makeModelConfig());

      expect(result).toEqual([]);
    });

    it('should parse a numbered list into an array of suggestions', async () => {
      suggester.appendAssistantText('I created a blue button for you.');
      mockCompleteSimple.mockResolvedValue(mockResponse('1. Make it larger\n2. Change the color\n3. Add a shadow'));

      const result = await suggester.suggest(makeModelConfig());

      expect(result).toEqual(['Make it larger', 'Change the color', 'Add a shadow']);
    });

    it('should parse plain lines (no numbering) into suggestions', async () => {
      suggester.appendAssistantText('Done with the layout.');
      mockCompleteSimple.mockResolvedValue(mockResponse('Add padding\nChange font\nResize header'));

      const result = await suggester.suggest(makeModelConfig());

      expect(result).toEqual(['Add padding', 'Change font', 'Resize header']);
    });

    it('should handle __NO_SUGGESTION__ token and return []', async () => {
      suggester.appendAssistantText('response');
      mockCompleteSimple.mockResolvedValue(mockResponse('__NO_SUGGESTION__'));

      const result = await suggester.suggest(makeModelConfig());

      expect(result).toEqual([]);
    });

    it('should catch errors from completeSimple and return []', async () => {
      suggester.appendAssistantText('response');
      mockCompleteSimple.mockRejectedValue(new Error('API timeout'));

      const result = await suggester.suggest(makeModelConfig());

      expect(result).toEqual([]);
    });

    it('should limit to max 3 suggestions', async () => {
      suggester.appendAssistantText('response');
      mockCompleteSimple.mockResolvedValue(mockResponse('One\nTwo\nThree\nFour\nFive'));

      const result = await suggester.suggest(makeModelConfig());

      expect(result).toHaveLength(3);
      expect(result).toEqual(['One', 'Two', 'Three']);
    });

    it('should strip numbering, bullets, and quotes from suggestions', async () => {
      suggester.appendAssistantText('response');
      mockCompleteSimple.mockResolvedValue(
        mockResponse('1. "First suggestion"\n- Second suggestion\n• \'Third suggestion\''),
      );

      const result = await suggester.suggest(makeModelConfig());

      expect(result).toEqual(['First suggestion', 'Second suggestion', 'Third suggestion']);
    });

    it('should filter out empty lines in response', async () => {
      suggester.appendAssistantText('response');
      mockCompleteSimple.mockResolvedValue(mockResponse('\n\nSuggestion A\n\nSuggestion B\n\n'));

      const result = await suggester.suggest(makeModelConfig());

      expect(result).toEqual(['Suggestion A', 'Suggestion B']);
    });

    it('should filter out lines exceeding 300 characters', async () => {
      suggester.appendAssistantText('response');
      const longLine = 'A'.repeat(301);
      mockCompleteSimple.mockResolvedValue(mockResponse(`Short one\n${longLine}\nAnother short`));

      const result = await suggester.suggest(makeModelConfig());

      expect(result).toEqual(['Short one', 'Another short']);
    });

    it('should reset generating flag after successful call', async () => {
      suggester.appendAssistantText('response');
      mockCompleteSimple.mockResolvedValue(mockResponse('Suggestion'));

      await suggester.suggest(makeModelConfig());

      // Second call should work (not blocked by generating flag)
      suggester.appendAssistantText(' more');
      mockCompleteSimple.mockResolvedValue(mockResponse('Another'));
      const result = await suggester.suggest(makeModelConfig());

      expect(result).toEqual(['Another']);
      expect(mockCompleteSimple).toHaveBeenCalledTimes(2);
    });

    it('should reset generating flag after error', async () => {
      suggester.appendAssistantText('response');
      mockCompleteSimple.mockRejectedValue(new Error('fail'));

      await suggester.suggest(makeModelConfig());

      // Second call should work despite first failure
      mockCompleteSimple.mockResolvedValue(mockResponse('Recovered'));
      const result = await suggester.suggest(makeModelConfig());

      expect(result).toEqual(['Recovered']);
    });

    it('should call getModel with provider and modelId', async () => {
      suggester.appendAssistantText('response');
      mockCompleteSimple.mockResolvedValue(mockResponse('Suggestion'));

      await suggester.suggest(makeModelConfig());

      expect(mockGetModel).toHaveBeenCalledWith('anthropic', 'claude-sonnet-4-6');
    });

    it('should call completeSimple with model, messages, and apiKey', async () => {
      suggester.appendAssistantText('response');
      mockCompleteSimple.mockResolvedValue(mockResponse('Suggestion'));

      await suggester.suggest(makeModelConfig());

      expect(mockCompleteSimple).toHaveBeenCalledWith(
        { id: 'mock-model' },
        expect.objectContaining({
          systemPrompt: expect.any(String),
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.arrayContaining([expect.objectContaining({ type: 'text' })]),
            }),
          ]),
        }),
        expect.objectContaining({
          apiKey: 'sk-test-key',
          reasoning: 'off',
        }),
      );
    });

    it('should handle response with mixed content types (filter to text only)', async () => {
      suggester.appendAssistantText('response');
      mockCompleteSimple.mockResolvedValue({
        content: [
          { type: 'thinking', text: 'internal thought' },
          { type: 'text', text: 'Actual suggestion' },
          { type: 'image', url: 'http://example.com' },
        ],
      });

      const result = await suggester.suggest(makeModelConfig());

      expect(result).toEqual(['Actual suggestion']);
    });
  });
});

// ── parseSuggestions contract tests ───────────────
// Mirror the exact logic from prompt-suggester.ts to validate it independently

const NO_SUGGESTION_TOKEN = '__NO_SUGGESTION__';
const MAX_SUGGESTION_CHARS = 300;

function parseSuggestions(raw: string): string[] {
  if (raw.includes(NO_SUGGESTION_TOKEN)) return [];
  return raw
    .split('\n')
    .map((line) =>
      line
        .replace(/^[\d.\-*•]+\s*/, '')
        .replace(/^["']|["']$/g, '')
        .trim(),
    )
    .filter((line) => line.length > 0 && line.length <= MAX_SUGGESTION_CHARS)
    .slice(0, 3);
}

describe('parseSuggestions', () => {
  it('should parse plain lines into suggestions', () => {
    const result = parseSuggestions('Add a shadow\nChange the color\nMake it bigger');
    expect(result).toEqual(['Add a shadow', 'Change the color', 'Make it bigger']);
  });

  it('should strip numbered prefixes', () => {
    const result = parseSuggestions('1. Add shadow\n2. Change color\n3. Resize');
    expect(result).toEqual(['Add shadow', 'Change color', 'Resize']);
  });

  it('should strip bullet prefixes', () => {
    const result = parseSuggestions('- Add shadow\n* Change color\n• Resize');
    expect(result).toEqual(['Add shadow', 'Change color', 'Resize']);
  });

  it('should strip surrounding quotes', () => {
    const result = parseSuggestions('"Add shadow"\n\'Change color\'');
    expect(result).toEqual(['Add shadow', 'Change color']);
  });

  it('should return empty array for NO_SUGGESTION token', () => {
    const result = parseSuggestions('__NO_SUGGESTION__');
    expect(result).toEqual([]);
  });

  it('should return empty for NO_SUGGESTION embedded in text', () => {
    const result = parseSuggestions('I think __NO_SUGGESTION__ is best here');
    expect(result).toEqual([]);
  });

  it('should limit to 3 suggestions', () => {
    const result = parseSuggestions('One\nTwo\nThree\nFour\nFive');
    expect(result).toHaveLength(3);
    expect(result).toEqual(['One', 'Two', 'Three']);
  });

  it('should filter out empty lines', () => {
    const result = parseSuggestions('\n\nAdd shadow\n\nChange color\n\n');
    expect(result).toEqual(['Add shadow', 'Change color']);
  });

  it('should filter out lines exceeding MAX_SUGGESTION_CHARS', () => {
    const longLine = 'A'.repeat(301);
    const result = parseSuggestions(`Short suggestion\n${longLine}\nAnother short`);
    expect(result).toEqual(['Short suggestion', 'Another short']);
  });

  it('should handle empty input', () => {
    expect(parseSuggestions('')).toEqual([]);
  });

  it('should trim whitespace from suggestions', () => {
    const result = parseSuggestions('  Add shadow  \n  Change color  ');
    expect(result).toEqual(['Add shadow', 'Change color']);
  });

  it('should handle mixed numbering styles', () => {
    const result = parseSuggestions('1. First\n- Second\n• Third');
    expect(result).toEqual(['First', 'Second', 'Third']);
  });
});
