import { contextBridge, ipcRenderer } from 'electron';

/** Serializable slot info sent to renderer. */
interface SlotInfoDTO {
  id: string;
  fileKey: string | null;
  fileName: string | null;
  isStreaming: boolean;
  isConnected: boolean;
  modelConfig: { provider: string; modelId: string };
  queueLength: number;
  /** Last known input-token count — restores the context bar after app restart. B-026. */
  lastContextTokens?: number;
}

/** Queued prompt entry. */
interface QueuedPromptDTO {
  id: string;
  text: string;
  addedAt: number;
}

/** Figma REST API auth status — shared between get + subscribe contracts. */
interface FigmaAuthStatusDTO {
  connected: boolean;
  encrypted: boolean;
  userHandle?: string;
  lastValidatedAt?: string;
}

interface FigmaAuthSetResultDTO {
  success: boolean;
  userHandle?: string;
  error?: string;
  status?: number;
}

contextBridge.exposeInMainWorld('api', {
  // ── Agent (per-slot) ─────────────────────
  sendPrompt: (slotId: string, text: string) => ipcRenderer.invoke('agent:prompt', slotId, text),
  abort: (slotId: string) => ipcRenderer.invoke('agent:abort', slotId),

  // Events from main → renderer (all include slotId as first arg)
  onTextDelta: (cb: (slotId: string, text: string) => void) => {
    ipcRenderer.on('agent:text-delta', (_event, slotId, text) => cb(slotId, text));
  },
  onThinking: (cb: (slotId: string, text: string) => void) => {
    ipcRenderer.on('agent:thinking', (_event, slotId, text) => cb(slotId, text));
  },
  onToolStart: (cb: (slotId: string, toolName: string, toolCallId: string) => void) => {
    ipcRenderer.on('agent:tool-start', (_event, slotId, name, id) => cb(slotId, name, id));
  },
  onToolEnd: (cb: (slotId: string, toolName: string, toolCallId: string, success: boolean, result?: any) => void) => {
    ipcRenderer.on('agent:tool-end', (_event, slotId, name, id, success, result) =>
      cb(slotId, name, id, success, result),
    );
  },
  onAgentEnd: (cb: (slotId: string) => void) => {
    ipcRenderer.on('agent:end', (_event, slotId) => cb(slotId));
  },
  onScreenshot: (cb: (slotId: string, base64: string) => void) => {
    ipcRenderer.on('agent:screenshot', (_event, slotId, base64) => cb(slotId, base64));
  },
  onUsage: (cb: (slotId: string, usage: { input: number; output: number; total: number }) => void) => {
    ipcRenderer.on('agent:usage', (_event, slotId, usage) => cb(slotId, usage));
  },
  onCompaction: (cb: (slotId: string, active: boolean) => void) => {
    ipcRenderer.on('agent:compaction', (_event, slotId, active) => cb(slotId, active));
  },
  onRetry: (cb: (slotId: string, active: boolean) => void) => {
    ipcRenderer.on('agent:retry', (_event, slotId, active) => cb(slotId, active));
  },

  // Prompt suggestions (per-slot)
  onSuggestions: (cb: (slotId: string, suggestions: string[]) => void) => {
    ipcRenderer.on('agent:suggestions', (_event, slotId, suggestions) => cb(slotId, suggestions));
  },

  // Queued prompt auto-start notification
  onQueuedPromptStart: (cb: (slotId: string, text: string) => void) => {
    ipcRenderer.on('agent:queued-prompt-start', (_event, slotId, text) => cb(slotId, text));
  },

  // ── Task tracking (per-slot) ──────────────
  onTaskUpdated: (cb: (slotId: string, tasks: any[]) => void) => {
    ipcRenderer.on('task:updated', (_event, slotId, tasks) => cb(slotId, tasks));
  },
  onTaskCleared: (cb: (slotId: string, count: number) => void) => {
    ipcRenderer.on('task:cleared', (_event, slotId, count) => cb(slotId, count));
  },
  getTaskList: (slotId: string) => ipcRenderer.invoke('task:list', slotId),

  // ── Tab management ────────────────────────
  createTab: (fileKey?: string, fileName?: string) =>
    ipcRenderer.invoke('tab:create', fileKey, fileName) as Promise<{
      success: boolean;
      slot?: SlotInfoDTO;
      error?: string;
    }>,
  closeTab: (slotId: string) =>
    ipcRenderer.invoke('tab:close', slotId) as Promise<{ success: boolean; error?: string }>,
  activateTab: (slotId: string) => ipcRenderer.invoke('tab:activate', slotId) as Promise<{ success: boolean }>,
  listTabs: () => ipcRenderer.invoke('tab:list') as Promise<SlotInfoDTO[]>,
  onTabCreated: (cb: (slotInfo: SlotInfoDTO) => void) => {
    ipcRenderer.on('tab:created', (_event, info) => cb(info));
  },
  onTabRemoved: (cb: (slotId: string) => void) => {
    ipcRenderer.on('tab:removed', (_event, slotId) => cb(slotId));
  },
  onTabUpdated: (cb: (slotInfo: SlotInfoDTO) => void) => {
    ipcRenderer.on('tab:updated', (_event, info) => cb(info));
  },

  // ── Queue management (per-slot) ───────────
  queueRemove: (slotId: string, promptId: string) =>
    ipcRenderer.invoke('queue:remove', slotId, promptId) as Promise<boolean>,
  queueEdit: (slotId: string, promptId: string, newText: string) =>
    ipcRenderer.invoke('queue:edit', slotId, promptId, newText) as Promise<boolean>,
  queueClear: (slotId: string) => ipcRenderer.invoke('queue:clear', slotId) as Promise<number>,
  queueList: (slotId: string) => ipcRenderer.invoke('queue:list', slotId) as Promise<QueuedPromptDTO[]>,
  onQueueUpdated: (cb: (slotId: string, queue: QueuedPromptDTO[]) => void) => {
    ipcRenderer.on('queue:updated', (_event, slotId, queue) => cb(slotId, queue));
  },

  // ── Figma status ──────────────────────────
  onFigmaConnected: (cb: (fileName: string) => void) => {
    ipcRenderer.on('figma:connected', (_event, name) => cb(name));
  },
  onFigmaDisconnected: (cb: () => void) => {
    ipcRenderer.on('figma:disconnected', () => cb());
  },
  onFigmaVersionMismatch: (cb: (info: { pluginVersion: number; requiredVersion: number; message: string }) => void) => {
    ipcRenderer.on('figma:version-mismatch', (_event, info) => cb(info));
  },
  onPluginNeedsSetup: (cb: () => void) => {
    ipcRenderer.on('plugin:needs-setup', () => cb());
  },

  // ── Feedback ─────────────────────────────
  submitFeedback: (data: {
    slotId: string;
    sentiment: 'positive' | 'negative';
    issueType?: string;
    details?: string;
  }) => ipcRenderer.invoke('feedback:submit', data),

  // ── Session persistence (per-slot) ────────
  resetSession: (slotId: string) =>
    ipcRenderer.invoke('session:reset', slotId) as Promise<{ success: boolean; error?: string }>,
  resetSessionWithClear: (slotId: string) =>
    ipcRenderer.invoke('session:reset-with-clear', slotId) as Promise<{ success: boolean; error?: string }>,
  onChatCleared: (cb: (slotId: string) => void) => {
    ipcRenderer.on('session:chat-cleared', (_event, slotId) => cb(slotId));
  },
  getSessionMessages: (slotId: string) => ipcRenderer.invoke('session:get-messages', slotId) as Promise<any[]>,
  // ── Window controls (global) ──────────────
  togglePin: () => ipcRenderer.invoke('window:toggle-pin') as Promise<boolean>,
  isPinned: () => ipcRenderer.invoke('window:is-pinned') as Promise<boolean>,
  setOpacity: (opacity: number) => ipcRenderer.invoke('window:set-opacity', opacity),

  // ── Thinking level (per-slot) ─────────────
  setThinking: (slotId: string, level: string) =>
    ipcRenderer.invoke('agent:set-thinking', slotId, level) as Promise<{ level: string } | undefined>,
  getThinkingCapabilities: (slotId: string) =>
    ipcRenderer.invoke('agent:get-thinking-capabilities', slotId) as Promise<{
      family: 'anthropic' | 'openai' | 'google' | 'unknown';
      availableLevels: string[];
      supportsThinking: boolean;
      supportsXhigh: boolean;
      currentLevel: string;
    }>,

  // ── Auth & Model (global + per-slot) ──────
  getModels: () => ipcRenderer.invoke('auth:get-models'),
  getContextSizes: () => ipcRenderer.invoke('auth:get-context-sizes'),
  setApiKey: (provider: string, key: string) => ipcRenderer.invoke('auth:set-key', provider, key),
  switchModel: (slotId: string, config: { provider: string; modelId: string }) =>
    ipcRenderer.invoke('auth:switch-model', slotId, config),

  // ── Image generation settings (global) ────
  getImageGenConfig: () => ipcRenderer.invoke('imagegen:get-config'),
  setImageGenConfig: (config: { apiKey?: string; model?: string }) => ipcRenderer.invoke('imagegen:set-config', config),
  testImageGenKey: (candidate?: string) =>
    ipcRenderer.invoke('imagegen:test-key', candidate) as Promise<{ success: boolean; error?: string; code?: string }>,

  // ── Reset actions (global) ────────────────
  resetAuth: () => ipcRenderer.invoke('app:reset-auth') as Promise<{ ok: boolean; cancelled?: boolean }>,
  clearHistory: () => ipcRenderer.invoke('app:clear-history') as Promise<{ ok: boolean; cancelled?: boolean }>,
  factoryReset: () => ipcRenderer.invoke('app:factory-reset') as Promise<{ ok: boolean; cancelled?: boolean }>,

  // ── Subagent config (global) ──────────────
  // subagent:run + subagent:abort IPC were removed along with the orphan
  // Scout/Analyst/Auditor orchestrator pipeline; only config + judge events
  // remain. subagent:status is still emitted by the judge harness.
  getSubagentConfig: () => ipcRenderer.invoke('subagent:get-config'),
  setSubagentConfig: (config: any) => ipcRenderer.invoke('subagent:set-config', config),

  // ── Subagent events (per-slot) ───────────
  onSubagentStatus: (cb: (slotId: string, data: any) => void) => {
    ipcRenderer.on('subagent:status', (_event, slotId, data) => cb(slotId, data));
  },
  onJudgeRunning: (cb: (slotId: string) => void) => {
    ipcRenderer.on('judge:running', (_event, slotId) => cb(slotId));
  },
  onJudgeVerdict: (cb: (slotId: string, verdict: any, attempt: number, max: number) => void) => {
    ipcRenderer.on('judge:verdict', (_event, slotId, verdict, attempt, max) => cb(slotId, verdict, attempt, max));
  },
  onJudgeRetryStart: (cb: (slotId: string, attempt: number, max: number) => void) => {
    ipcRenderer.on('judge:retry-start', (_event, slotId, attempt, max) => cb(slotId, attempt, max));
  },

  // ── Judge control ──────────────────────────
  setJudgeOverride: (slotId: string, enabled: boolean | null) =>
    ipcRenderer.invoke('judge:set-override', slotId, enabled),
  forceRerunJudge: (slotId: string) => ipcRenderer.invoke('judge:force-rerun', slotId),

  // ── Compression profiles & cache (global) ─
  compressionGetProfiles: () => ipcRenderer.invoke('compression:get-profiles'),
  compressionGetProfile: () => ipcRenderer.invoke('compression:get-profile'),
  compressionSetProfile: (profile: string) => ipcRenderer.invoke('compression:set-profile', profile),
  compressionInvalidateCaches: () => ipcRenderer.invoke('compression:invalidate-caches'),

  // ── OAuth login (global) ──────────────────
  getAuthStatus: () => ipcRenderer.invoke('auth:get-auth-status'),
  login: (provider: string) => ipcRenderer.invoke('auth:login', provider),
  loginRespond: (response: string) => ipcRenderer.invoke('auth:login-respond', response),
  loginCancel: () => ipcRenderer.invoke('auth:login-cancel'),
  logout: (provider: string) => ipcRenderer.invoke('auth:logout', provider),
  setGoogleProject: (projectId: string) => ipcRenderer.invoke('auth:set-google-project', projectId),
  getGoogleProject: () => ipcRenderer.invoke('auth:get-google-project') as Promise<string>,
  onLoginEvent: (cb: (event: any) => void) => {
    ipcRenderer.on('auth:login-event', (_event, data) => cb(data));
  },

  // ── Figma REST API auth (Personal Access Token) ──
  getFigmaAuthStatus: () => ipcRenderer.invoke('figma-auth:get-status') as Promise<FigmaAuthStatusDTO>,
  setFigmaToken: (token: string) => ipcRenderer.invoke('figma-auth:set-token', token) as Promise<FigmaAuthSetResultDTO>,
  clearFigmaToken: () => ipcRenderer.invoke('figma-auth:clear') as Promise<{ success: boolean; error?: string }>,
  testFigmaToken: () =>
    ipcRenderer.invoke('figma-auth:test-token') as Promise<{
      success: boolean;
      error?: string;
      status?: number;
      userHandle?: string;
    }>,
  openFigmaPatDocs: () => ipcRenderer.invoke('figma-auth:open-pat-docs') as Promise<void>,
  onFigmaAuthStatusChanged: (cb: (status: FigmaAuthStatusDTO) => void) => {
    ipcRenderer.on('figma-auth:status-changed', (_event, data: FigmaAuthStatusDTO) => cb(data));
  },

  // ── F11: model probe / status — all use shared IpcResult envelope. ─
  probeModel: (provider: string, modelId: string) =>
    ipcRenderer.invoke('auth:probe-model', provider, modelId) as Promise<
      | { success: true; data: { status: string; httpStatus?: number; cacheHit: boolean; durationMs: number } }
      | { success: false; error: string; code?: string }
    >,
  testConnection: (displayGroup: string) =>
    ipcRenderer.invoke('auth:test-connection', displayGroup) as Promise<
      | { success: true; data: { status: string; httpStatus?: number; modelId: string } }
      | { success: false; error: string; code?: string }
    >,
  getModelStatus: () => ipcRenderer.invoke('auth:get-model-status') as Promise<Record<string, string>>,
  getRecentErrors: () =>
    ipcRenderer.invoke('diagnostics:get-recent-errors') as Promise<
      {
        ts: string;
        event: string;
        provider: string;
        modelId: string;
        httpStatus?: number | null;
        reason?: string;
        message: string;
      }[]
    >,
  forceRefresh: (displayGroup: string) =>
    ipcRenderer.invoke('auth:force-refresh', displayGroup) as Promise<
      { success: true; data: { outcome: string } } | { success: false; error: string; code?: string }
    >,
  onStreamError: (
    cb: (slotId: string, payload: { httpStatus: number | null; retriable: boolean; lastPrompt: string }) => void,
  ) => {
    ipcRenderer.on('agent:stream-error', (_event, slotId: string, payload) => cb(slotId, payload));
  },
  onAutoFallback: (cb: (slotId: string, payload: { from: string; to: string; reason: string }) => void) => {
    ipcRenderer.on('agent:auto-fallback', (_event, slotId: string, payload) => cb(slotId, payload));
  },
  onImageGenError: (cb: (slotId: string, toolName: string, error: string) => void) => {
    ipcRenderer.on('agent:image-gen-error', (_event, slotId: string, toolName: string, error: string) =>
      cb(slotId, toolName, error),
    );
  },
  onFigmaTokenLost: (cb: () => void) => {
    ipcRenderer.on('figma:token_lost', () => cb());
  },
  onKeychainUnavailable: (cb: (payload: { reason?: string }) => void) => {
    ipcRenderer.on('keychain:unavailable', (_event, data: { reason?: string }) => cb(data));
  },
  onPostUpgrade: (
    cb: (payload: {
      previousVersion: string;
      currentVersion: string;
      regressions: { provider: string; previousType: string }[];
    }) => void,
  ) => {
    ipcRenderer.on('app:post-upgrade', (_event, data) => cb(data));
  },

  // ── Usage tracking ────────────────────────
  trackSuggestionClicked: (index: number) => ipcRenderer.invoke('usage:suggestion-clicked', index),

  // ── Diagnostics (global) ──────────────────
  getSupportCode: () => ipcRenderer.invoke('diagnostics:get-support-code') as Promise<string>,
  exportDiagnostics: () =>
    ipcRenderer.invoke('diagnostics:export') as Promise<{
      success: boolean;
      canceled?: boolean;
      path?: string;
      error?: string;
    }>,
  copyDiagnosticsInfo: () => ipcRenderer.invoke('diagnostics:copy-info') as Promise<string>,
  getDiagnosticsConfig: () => ipcRenderer.invoke('diagnostics:get-config') as Promise<{ sendDiagnostics: boolean }>,
  setDiagnosticsConfig: (config: { sendDiagnostics: boolean }) =>
    ipcRenderer.invoke('diagnostics:set-config', config) as Promise<{ success: boolean; requiresRestart: boolean }>,

  // ── Figma plugin (global) ─────────────────
  checkFigmaPlugin: () => ipcRenderer.invoke('plugin:check') as Promise<{ installed: boolean }>,
  installFigmaPlugin: () =>
    ipcRenderer.invoke('plugin:install') as Promise<{
      success: boolean;
      path?: string;
      error?: string;
      autoRegistered?: boolean;
      alreadyRegistered?: boolean;
      figmaRunning?: boolean;
    }>,

  // ── Canvas management (safe, always available) ──
  clearPage: (fileKey?: string) => ipcRenderer.invoke('figma:clear-page', fileKey) as Promise<any>,
  figmaExecute: (code: string, timeoutMs?: number, fileKey?: string) =>
    ipcRenderer.invoke('figma:execute', code, timeoutMs, fileKey) as Promise<any>,

  // ── Auto-update (global) ──────────────────
  getAppVersion: () => ipcRenderer.invoke('update:get-version') as Promise<string>,
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateAvailable: (cb: (info: { version: string; releaseNotes: string }) => void) => {
    ipcRenderer.on('update:available', (_event, info) => cb(info));
  },
  onUpdateDownloaded: (cb: (version: string) => void) => {
    ipcRenderer.on('update:downloaded', (_event, version) => cb(version));
  },
  onUpdateProgress: (cb: (percent: number) => void) => {
    ipcRenderer.on('update:progress', (_event, percent) => cb(percent));
  },
  onUpdateError: (cb: (message: string) => void) => {
    ipcRenderer.on('update:error', (_event, message) => cb(message));
  },

  // ── Agent test oracle (conditional, never in production) ──
  // The `process.env.BOTTEGA_AGENT_TEST` literal is replaced at build time by
  // esbuild's `define` (see scripts/build.mjs). Setting the env var on a
  // packaged release at launch will NOT activate this branch — you must
  // rebuild with `BOTTEGA_AGENT_TEST=1 npm run build`. The main process adds
  // a second `!app.isPackaged` defense for the IPC handlers themselves.
  ...(process.env.BOTTEGA_AGENT_TEST
    ? {
        __testFigmaExecute: (code: string, timeoutMs?: number, fileKey?: string) =>
          ipcRenderer.invoke('test:figma-execute', code, timeoutMs, fileKey),
        __testGetMetrics: () => ipcRenderer.invoke('test:get-metrics'),
        __testResetMetrics: () => ipcRenderer.invoke('test:reset-metrics'),
      }
    : {}),
});
