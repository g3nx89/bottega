import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  // Agent
  sendPrompt: (text: string) => ipcRenderer.invoke('agent:prompt', text),
  abort: () => ipcRenderer.invoke('agent:abort'),

  // Events from main → renderer
  onTextDelta: (cb: (text: string) => void) => {
    ipcRenderer.on('agent:text-delta', (_event, text) => cb(text));
  },
  onThinking: (cb: (text: string) => void) => {
    ipcRenderer.on('agent:thinking', (_event, text) => cb(text));
  },
  onToolStart: (cb: (toolName: string, toolCallId: string) => void) => {
    ipcRenderer.on('agent:tool-start', (_event, name, id) => cb(name, id));
  },
  onToolEnd: (cb: (toolName: string, toolCallId: string, success: boolean, result?: any) => void) => {
    ipcRenderer.on('agent:tool-end', (_event, name, id, success, result) => cb(name, id, success, result));
  },
  onAgentEnd: (cb: () => void) => {
    ipcRenderer.on('agent:end', () => cb());
  },
  onScreenshot: (cb: (base64: string) => void) => {
    ipcRenderer.on('agent:screenshot', (_event, base64) => cb(base64));
  },
  onUsage: (cb: (usage: { input: number; output: number; total: number }) => void) => {
    ipcRenderer.on('agent:usage', (_event, usage) => cb(usage));
  },
  onCompaction: (cb: (active: boolean) => void) => {
    ipcRenderer.on('agent:compaction', (_event, active) => cb(active));
  },
  onRetry: (cb: (active: boolean) => void) => {
    ipcRenderer.on('agent:retry', (_event, active) => cb(active));
  },

  // Prompt suggestions
  onSuggestions: (cb: (suggestions: string[]) => void) => {
    ipcRenderer.on('agent:suggestions', (_event, suggestions) => cb(suggestions));
  },

  // Figma status
  onFigmaConnected: (cb: (fileName: string) => void) => {
    ipcRenderer.on('figma:connected', (_event, name) => cb(name));
  },
  onFigmaDisconnected: (cb: () => void) => {
    ipcRenderer.on('figma:disconnected', () => cb());
  },

  // Session persistence
  resetSession: () => ipcRenderer.invoke('session:reset') as Promise<{ success: boolean; error?: string }>,
  getSessionMessages: () => ipcRenderer.invoke('session:get-messages') as Promise<any[]>,
  onSessionRestored: (cb: (messages: any[]) => void) => {
    ipcRenderer.on('session:restored', (_event, messages) => cb(messages));
  },
  onSessionRestoreFailed: (cb: (info: { fileKey: string; fileName: string }) => void) => {
    ipcRenderer.on('session:restore-failed', (_event, info) => cb(info));
  },

  // Window pin (always-on-top)
  togglePin: () => ipcRenderer.invoke('window:toggle-pin') as Promise<boolean>,
  isPinned: () => ipcRenderer.invoke('window:is-pinned') as Promise<boolean>,

  // Window opacity
  setOpacity: (opacity: number) => ipcRenderer.invoke('window:set-opacity', opacity),

  // Thinking level
  setThinking: (level: string) => ipcRenderer.invoke('agent:set-thinking', level),

  // Auth & Model
  getModels: () => ipcRenderer.invoke('auth:get-models'),
  getContextSizes: () => ipcRenderer.invoke('auth:get-context-sizes'),
  setApiKey: (provider: string, key: string) => ipcRenderer.invoke('auth:set-key', provider, key),
  switchModel: (config: { provider: string; modelId: string }) => ipcRenderer.invoke('auth:switch-model', config),

  // Image generation settings
  getImageGenConfig: () => ipcRenderer.invoke('imagegen:get-config'),
  setImageGenConfig: (config: { apiKey?: string; model?: string }) => ipcRenderer.invoke('imagegen:set-config', config),

  // Compression profiles & cache
  compressionGetProfiles: () => ipcRenderer.invoke('compression:get-profiles'),
  compressionGetProfile: () => ipcRenderer.invoke('compression:get-profile'),
  compressionSetProfile: (profile: string) => ipcRenderer.invoke('compression:set-profile', profile),
  compressionInvalidateCaches: () => ipcRenderer.invoke('compression:invalidate-caches'),

  // OAuth login
  getAuthStatus: () => ipcRenderer.invoke('auth:get-auth-status'),
  login: (provider: string) => ipcRenderer.invoke('auth:login', provider),
  loginRespond: (response: string) => ipcRenderer.invoke('auth:login-respond', response),
  loginCancel: () => ipcRenderer.invoke('auth:login-cancel'),
  logout: (provider: string) => ipcRenderer.invoke('auth:logout', provider),
  onLoginEvent: (cb: (event: any) => void) => {
    ipcRenderer.on('auth:login-event', (_event, data) => cb(data));
  },

  // Figma plugin
  checkFigmaPlugin: () => ipcRenderer.invoke('plugin:check') as Promise<{ installed: boolean }>,
  installFigmaPlugin: () =>
    ipcRenderer.invoke('plugin:install') as Promise<{ success: boolean; path?: string; error?: string }>,

  // Auto-update
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
});
