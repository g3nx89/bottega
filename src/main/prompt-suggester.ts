/**
 * Prompt Suggester — generates follow-up prompt suggestions after each agent turn.
 *
 * Inspired by pi-prompt-suggester (https://github.com/guwidoe/pi-prompt-suggester).
 * Adapted for the Electron GUI: instead of ghost text in a TUI editor,
 * suggestions are forwarded via IPC and rendered as clickable chips.
 */
import { completeSimple, getModel } from '@mariozechner/pi-ai';
import type { AuthStorage } from '@mariozechner/pi-coding-agent';
import { createChildLogger } from '../figma/logger.js';
import { type ModelConfig, resolveSdkModelId, safeReloadAuth } from './agent.js';

const log = createChildLogger({ component: 'suggester' });

const NO_SUGGESTION_TOKEN = '__NO_SUGGESTION__';
const MAX_ASSISTANT_CHARS = 3000;
const MAX_RECENT_PROMPTS = 5;
const MAX_SUGGESTION_CHARS = 300;

/** Build the suggestion prompt — adapted from pi-prompt-suggester's template */
function buildSuggestionPrompt(assistantText: string, recentUserPrompts: string[]): string {
  const prompts = recentUserPrompts.slice(0, MAX_RECENT_PROMPTS);
  return `You suggest likely follow-up prompts in a Figma design pair-programming session.
The user describes design changes in natural language, and an AI agent operates on Figma.

Return exactly 3 short suggestions, one per line, no numbering, no bullets, no quotes.
Each suggestion should be a plausible next user message.
If no plausible suggestions exist, return exactly ${NO_SUGGESTION_TOKEN}.

RecentUserMessages:
${prompts.length > 0 ? prompts.map((p) => `- ${p}`).join('\n') : '(none)'}

LatestAssistantMessage:
\`\`\`
${(assistantText || '(empty)').slice(0, MAX_ASSISTANT_CHARS)}
\`\`\`

Guidance:
- Stay close to the user's recent style and current trajectory.
- Treat RecentUserMessages as the strongest signal.
- If the assistant proposed a next step and it fits, one suggestion can be a short affirmation like "Go ahead" or "Yes, proceed".
- Make suggestions short, actionable, and varied (don't repeat the same idea).
- Keep each suggestion under ${MAX_SUGGESTION_CHARS} characters. Prefer fewer words.
- Write suggestions in the same language the user has been using.`;
}

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

export class PromptSuggester {
  private recentUserPrompts: string[] = [];
  private lastAssistantText = '';
  private generating = false;

  constructor(private authStorage: AuthStorage) {}

  /** Track a user prompt for context */
  trackUserPrompt(text: string): void {
    this.recentUserPrompts.push(text.trim());
    // Keep a sliding window
    if (this.recentUserPrompts.length > MAX_RECENT_PROMPTS) {
      this.recentUserPrompts.shift();
    }
  }

  /** Accumulate assistant text as it streams */
  appendAssistantText(delta: string): void {
    this.lastAssistantText += delta;
  }

  /** Reset for new assistant turn */
  resetAssistantText(): void {
    this.lastAssistantText = '';
  }

  /** Clear conversation tracking (e.g. on model switch) */
  reset(): void {
    this.recentUserPrompts = [];
    this.lastAssistantText = '';
  }

  /** Generate suggestions after agent_end. Returns [] on failure or no suggestions. */
  async suggest(modelConfig: ModelConfig): Promise<string[]> {
    if (this.generating) return [];
    // B-009: Generate suggestions even when assistant text is empty (degraded turns).
    // Use recent user prompts as context — there's always a follow-up to suggest.
    if (!this.lastAssistantText.trim() && this.recentUserPrompts.length === 0) return [];

    this.generating = true;
    try {
      const model = getModel(modelConfig.provider as any, resolveSdkModelId(modelConfig.modelId) as any);
      // B-020: Reload auth storage to pick up refreshed OAuth tokens
      safeReloadAuth(this.authStorage);
      const apiKey = await this.authStorage.getApiKey(modelConfig.provider);
      if (!apiKey) {
        log.warn({ provider: modelConfig.provider }, 'No API key for suggester model');
        return [];
      }

      const prompt = buildSuggestionPrompt(this.lastAssistantText, this.recentUserPrompts);
      const response = await completeSimple(
        model,
        {
          systemPrompt: 'You suggest follow-up prompts. Return only the suggestions, nothing else.',
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }], timestamp: Date.now() }],
        },
        {
          apiKey,
          reasoning: 'off',
        } as any,
      );

      const text = response.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n')
        .trim();

      const suggestions = parseSuggestions(text);
      log.info({ count: suggestions.length, preview: suggestions[0]?.slice(0, 60) }, 'Suggestions generated');
      return suggestions;
    } catch (err: any) {
      log.warn({ err: err.message }, 'Suggestion generation failed');
      return [];
    } finally {
      this.generating = false;
    }
  }
}
