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
});
