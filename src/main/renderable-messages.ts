/** A user chat turn. */
export interface UserTurn {
  role: 'user';
  text: string;
  images?: string[];
}

/** An assistant chat turn with optional tool calls and screenshots. */
export interface AssistantTurn {
  role: 'assistant';
  text: string;
  images?: string[];
  tools?: { name: string; id: string; success: boolean }[];
}

/** Discriminated union of renderable chat turns for the UI. */
export type RenderableTurn = UserTurn | AssistantTurn;

/** Whether a renderable turn has any visible content. */
function hasContent(turn: RenderableTurn): boolean {
  return !!(turn.text || ('tools' in turn && turn.tools?.length) || turn.images?.length);
}

/** Extract text from a Pi SDK message content array. */
function extractText(content: any[] | undefined): string {
  return (
    content
      ?.filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('') || ''
  );
}

/**
 * Extract renderable chat turns from Pi SDK AgentMessage[].
 * Two-pass: first collect tool results (success + screenshots), then build turns.
 */
const JUDGE_RETRY_MARKER = '[JUDGE_RETRY]';

export function extractRenderableMessages(messages: any[]): RenderableTurn[] {
  const turns: RenderableTurn[] = [];
  const toolResults = new Map<string, { success: boolean; screenshots: string[] }>();

  // Pass 1: index tool results
  for (const msg of messages) {
    if (msg.role === 'tool_result') {
      const screenshots: string[] = [];
      if (msg.content) {
        for (const c of msg.content) {
          if (c.type === 'image' && c.data) screenshots.push(c.data);
        }
      }
      toolResults.set(msg.toolCallId, { success: !msg.isError, screenshots });
    }
  }

  // Pass 2: build turns
  let currentAssistant: AssistantTurn | null = null;

  let inRetryZone = false;
  for (const msg of messages) {
    if (msg.role === 'user') {
      if (currentAssistant && hasContent(currentAssistant)) {
        turns.push(currentAssistant);
      }
      currentAssistant = null;
      const text = extractText(msg.content);
      // Skip judge retry prompts and their assistant responses
      if (text.startsWith(JUDGE_RETRY_MARKER)) {
        inRetryZone = true;
        continue;
      }
      // Non-retry user message ends the retry zone, but ignore tool results
      const isToolResult = msg.content?.some((c: any) => c.type === 'tool_result');
      if (!isToolResult) {
        inRetryZone = false;
      }
      const images = msg.content?.filter((c: any) => c.type === 'image' && c.data).map((c: any) => c.data) || [];
      if (text || images.length) turns.push({ role: 'user', text, ...(images.length ? { images } : {}) });
    } else if (msg.role === 'assistant') {
      // Skip all assistant messages within a judge retry zone
      if (inRetryZone) {
        currentAssistant = null;
        continue;
      }
      if (currentAssistant && hasContent(currentAssistant)) {
        turns.push(currentAssistant);
      }

      const text = extractText(msg.content);
      const tools: AssistantTurn['tools'] = [];
      const screenshots: string[] = [];

      if (msg.content) {
        for (const c of msg.content) {
          if (c.type === 'toolCall') {
            const result = toolResults.get(c.toolCallId);
            tools.push({ name: c.name, id: c.toolCallId, success: result?.success ?? true });
            if (result?.screenshots) screenshots.push(...result.screenshots);
          }
        }
      }

      currentAssistant = {
        role: 'assistant',
        text,
        ...(tools.length ? { tools } : {}),
        ...(screenshots.length ? { images: screenshots } : {}),
      };
    }
  }
  if (currentAssistant && hasContent(currentAssistant)) {
    turns.push(currentAssistant);
  }
  return turns;
}
