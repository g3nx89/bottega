/**
 * Logger for Figma Companion
 */

import pino from 'pino';

export const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export function createChildLogger(bindings: Record<string, unknown>): pino.Logger {
  return logger.child(bindings);
}
