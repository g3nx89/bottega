/**
 * Logger for Figma Cowork
 *
 * Writes structured JSON logs to:
 *   - stdout (via pino-pretty in dev)
 *   - ~/Library/Logs/FigmaCowork/app.log (file, always JSON)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import pino from 'pino';

const logDir = path.join(os.homedir(), 'Library', 'Logs', 'FigmaCowork');
fs.mkdirSync(logDir, { recursive: true });

const logFile = path.join(logDir, 'app.log');

export const logger = pino(
  { level: process.env.LOG_LEVEL || 'info' },
  pino.transport({
    targets: [
      // stdout with pretty print
      { target: 'pino-pretty', level: 'info' },
      // file in JSON format for post-mortem analysis
      { target: 'pino/file', options: { destination: logFile }, level: 'debug' },
    ],
  }),
);

export const logFilePath = logFile;

export function createChildLogger(bindings: Record<string, unknown>): pino.Logger {
  return logger.child(bindings);
}
