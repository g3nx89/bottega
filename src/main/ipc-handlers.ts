import { ipcMain, type BrowserWindow } from 'electron';
import { createFigmaAgent, AVAILABLE_MODELS, CONTEXT_SIZES, DEFAULT_MODEL, type AgentInfra, type ModelConfig } from './agent.js';
import { PromptSuggester } from './prompt-suggester.js';
import { createChildLogger } from '../figma/logger.js';

const log = createChildLogger({ component: 'ipc' });

export interface AgentSessionLike {
  prompt(text: string, options?: { streamingBehavior?: 'steer' | 'followUp' }): Promise<void>;
  abort(): Promise<void>;
  subscribe(callback: (event: any) => void): void;
}

export function setupIpcHandlers(
  initialSession: AgentSessionLike,
  mainWindow: BrowserWindow,
  infra: AgentInfra,
) {
  let session = initialSession;
  let isStreaming = false;
  let currentModelConfig: ModelConfig = DEFAULT_MODEL;

  // Prompt suggester — generates follow-up suggestions after each agent turn
  const suggester = new PromptSuggester(infra.authStorage, infra.modelRegistry);

  function subscribeToSession(s: AgentSessionLike) {
    s.subscribe((event: any) => {
      const wc = mainWindow.webContents;
      switch (event.type) {
        case 'message_update':
          if (event.assistantMessageEvent?.type === 'text_delta') {
            wc.send('agent:text-delta', event.assistantMessageEvent.delta);
            suggester.appendAssistantText(event.assistantMessageEvent.delta);
          }
          if (event.assistantMessageEvent?.type === 'thinking_delta') {
            wc.send('agent:thinking', event.assistantMessageEvent.delta);
          }
          break;
        case 'tool_execution_start':
          log.info({ tool: event.toolName, callId: event.toolCallId, params: event.toolParams }, 'Tool start');
          wc.send('agent:tool-start', event.toolName, event.toolCallId);
          break;
        case 'tool_execution_end': {
          const resultPreview = event.result?.content
            ? event.result.content.map((c: any) => ({
                type: c.type,
                ...(c.type === 'text' ? { text: (c.text || '').slice(0, 200) } : {}),
                ...(c.type === 'image' ? { hasData: !!c.data, dataLen: c.data?.length } : {}),
              }))
            : 'no content';
          log.info({
            tool: event.toolName,
            callId: event.toolCallId,
            isError: event.isError,
            resultContent: resultPreview,
          }, 'Tool end');
          wc.send('agent:tool-end', event.toolName, event.toolCallId, !event.isError, event.result);
          if (event.toolName === 'figma_screenshot' && !event.isError && event.result?.content) {
            const imageContent = event.result.content.find((c: any) => c.type === 'image');
            if (imageContent) {
              log.info({ dataLen: imageContent.data?.length }, 'Screenshot image forwarded to renderer');
              wc.send('agent:screenshot', imageContent.data);
            } else {
              log.warn({ content: resultPreview }, 'Screenshot tool succeeded but no image content found');
            }
          }
          break;
        }
        case 'message_end': {
          // Forward token usage for context bar
          const msg = event.message;
          if (msg?.usage) {
            wc.send('agent:usage', { input: msg.usage.input, output: msg.usage.output, total: msg.usage.totalTokens });
          }
          break;
        }
        case 'agent_end':
          isStreaming = false;
          wc.send('agent:end');
          // Generate suggestions asynchronously — don't block the UI
          suggester.suggest(currentModelConfig).then(suggestions => {
            if (suggestions.length > 0) {
              wc.send('agent:suggestions', suggestions);
            }
            suggester.resetAssistantText();
          });
          break;
        case 'auto_compaction_start':
          wc.send('agent:compaction', true);
          break;
        case 'auto_compaction_end':
          wc.send('agent:compaction', false);
          break;
        case 'auto_retry_start':
          wc.send('agent:retry', true);
          break;
        case 'auto_retry_end':
          wc.send('agent:retry', false);
          break;
      }
    });
  }

  // Subscribe to initial session
  subscribeToSession(session);

  // ── Agent prompt/abort ─────────────────
  ipcMain.handle('agent:prompt', async (_event, text: string) => {
    suggester.trackUserPrompt(text);
    suggester.resetAssistantText();
    if (isStreaming) {
      await session.prompt(text, { streamingBehavior: 'followUp' });
    } else {
      isStreaming = true;
      await session.prompt(text);
    }
  });

  ipcMain.handle('agent:abort', async () => {
    await session.abort();
    isStreaming = false;
  });

  // ── Window controls ────────────────────
  ipcMain.handle('window:toggle-pin', () => {
    const next = !mainWindow.isAlwaysOnTop();
    mainWindow.setAlwaysOnTop(next, 'floating');
    return next;
  });

  ipcMain.handle('window:is-pinned', () => {
    return mainWindow.isAlwaysOnTop();
  });

  ipcMain.handle('window:set-opacity', (_event, opacity: number) => {
    mainWindow.setOpacity(Math.max(0.1, Math.min(1, opacity)));
  });

  // ── Auth & Model management ────────────

  ipcMain.handle('auth:get-models', () => {
    return AVAILABLE_MODELS;
  });

  ipcMain.handle('auth:get-context-sizes', () => {
    return CONTEXT_SIZES;
  });

  ipcMain.handle('auth:get-providers', () => {
    // Return which providers have keys configured
    const providers = ['anthropic', 'openai', 'google'];
    const configured: Record<string, boolean> = {};
    for (const p of providers) {
      configured[p] = infra.authStorage.hasAuth(p);
    }
    return configured;
  });

  ipcMain.handle('auth:set-key', (_event, provider: string, apiKey: string) => {
    if (apiKey) {
      infra.authStorage.set(provider, { type: 'api_key', key: apiKey });
      log.info({ provider }, 'API key saved');
    } else {
      infra.authStorage.remove(provider);
      log.info({ provider }, 'API key removed');
    }
    return true;
  });

  ipcMain.handle('auth:has-key', (_event, provider: string) => {
    return infra.authStorage.hasAuth(provider);
  });

  ipcMain.handle('agent:set-thinking', (_event, level: string) => {
    (session as any).setThinkingLevel?.(level);
    log.info({ level }, 'Thinking level changed');
  });

  ipcMain.handle('auth:switch-model', async (_event, config: ModelConfig) => {
    log.info({ provider: config.provider, model: config.modelId }, 'Switching model');
    try {
      // Abort current session if streaming
      if (isStreaming) {
        await session.abort();
        isStreaming = false;
      }

      // Create new session with new model
      const result = await createFigmaAgent(infra, config);
      session = result.session as unknown as AgentSessionLike;
      subscribeToSession(session);
      currentModelConfig = config;
      suggester.reset();
      log.info({ provider: config.provider, model: config.modelId }, 'Model switched');
      return { success: true };
    } catch (err: any) {
      log.error({ err }, 'Failed to switch model');
      return { success: false, error: err.message };
    }
  });
}
