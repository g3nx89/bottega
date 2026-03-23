import type { WebContents } from 'electron';

/** Prevents crashes when the renderer exits before main finishes cleanup. */
export function safeSend(wc: WebContents, channel: string, ...args: any[]): void {
  if (wc.isDestroyed()) return;
  wc.send(channel, ...args);
}
