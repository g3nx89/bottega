/**
 * Type definitions for Figma Companion
 */

/**
 * Console log entry captured from Figma plugin
 */
export interface ConsoleLogEntry {
  timestamp: number;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  message: string;
  args: any[];
  stackTrace?: StackTrace;
  source: 'plugin' | 'figma' | 'page' | 'unknown';
  workerUrl?: string;
}

/**
 * Stack trace information
 */
export interface StackTrace {
  callFrames: CallFrame[];
}

/**
 * Individual stack frame
 */
export interface CallFrame {
  functionName: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
}

/**
 * Screenshot metadata
 */
export interface Screenshot {
  id: string;
  timestamp: number;
  path: string;
  format: 'png' | 'jpeg';
  width: number;
  height: number;
  selector?: string;
  base64?: string;
  metadata?: ScreenshotMetadata;
}

/**
 * Additional screenshot metadata
 */
export interface ScreenshotMetadata {
  pluginName?: string;
  pluginId?: string;
  figmaFileKey?: string;
}

/**
 * Plugin context information
 */
export interface PluginContext {
  pluginId?: string;
  pluginName?: string;
  isRunning: boolean;
  lastReloadTime?: number;
}

/**
 * JSX tree node — used by figma-use JSX renderer
 */
export interface TreeNode {
  type: string;
  props: Record<string, unknown>;
  children: (TreeNode | string)[];
  key?: string | number | null;
}
