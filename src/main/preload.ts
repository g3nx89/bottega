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
  onFigmaConnected: (cb: (fileKey: string) => void) => {
    ipcRenderer.on('figma:connected', (_event, key) => cb(key));
  },
  onFigmaDisconnected: (cb: () => void) => {
    ipcRenderer.on('figma:disconnected', () => cb());
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

  // OAuth login
  getAuthStatus: () => ipcRenderer.invoke('auth:get-auth-status'),
  login: (provider: string) => ipcRenderer.invoke('auth:login', provider),
  loginRespond: (response: string) => ipcRenderer.invoke('auth:login-respond', response),
  loginCancel: () => ipcRenderer.invoke('auth:login-cancel'),
  logout: (provider: string) => ipcRenderer.invoke('auth:logout', provider),
  onLoginEvent: (cb: (event: any) => void) => {
    ipcRenderer.on('auth:login-event', (_event, data) => cb(data));
  },
});
