/**
 * Unit & integration tests for single-instance lock and port-in-use detection.
 *
 * These tests cover the two safety features added to the app startup:
 * 1. Single instance lock (handleSecondInstance from startup-guards.ts)
 * 2. Port-in-use notification (isPortConflict from startup-guards.ts)
 * 3. Centralized messages (messages.ts)
 */

import net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FigmaWebSocketServer } from '../../../src/figma/websocket-server.js';
import * as messages from '../../../src/main/messages.js';
import {
  MSG_PORT_IN_USE_BODY,
  MSG_PORT_IN_USE_TITLE,
  MSG_STARTUP_ERROR_BODY,
  MSG_STARTUP_ERROR_TITLE,
} from '../../../src/main/messages.js';
import { handleSecondInstance, isPortConflict } from '../../../src/main/startup-guards.js';

// Mock logger to suppress output
vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() }),
  logger: { flush: vi.fn((cb: () => void) => cb()) },
  logFilePath: '/tmp/test.log',
  sessionUid: 'test-session',
}));

// =============================================================================
// Unit: WebSocket server EADDRINUSE behavior
// =============================================================================

describe('WebSocket server port conflict', () => {
  let serverA: FigmaWebSocketServer;
  let serverB: FigmaWebSocketServer;

  afterEach(async () => {
    try {
      await serverB?.stop();
    } catch {}
    try {
      await serverA?.stop();
    } catch {}
  });

  it('rejects with EADDRINUSE when port is already occupied by another WS server', async () => {
    serverA = new FigmaWebSocketServer({ port: 0 });
    await serverA.start();
    const port = serverA.address()!.port;

    serverB = new FigmaWebSocketServer({ port });

    try {
      await serverB.start();
      expect.unreachable('Expected start() to throw');
    } catch (err: any) {
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe('EADDRINUSE');
    }
  });

  it('rejects with EADDRINUSE when port is occupied by a plain TCP server', async () => {
    const tcpServer = net.createServer();
    const port = await new Promise<number>((resolve, reject) => {
      tcpServer.listen(0, 'localhost', () => {
        const addr = tcpServer.address();
        if (addr && typeof addr !== 'string') {
          resolve(addr.port);
        } else {
          reject(new Error('Failed to get port'));
        }
      });
    });

    try {
      serverA = new FigmaWebSocketServer({ port });

      try {
        await serverA.start();
        expect.unreachable('Expected start() to throw');
      } catch (err: any) {
        expect(err).toBeInstanceOf(Error);
        expect(err.code).toBe('EADDRINUSE');
      }
    } finally {
      await new Promise<void>((resolve) => tcpServer.close(() => resolve()));
    }
  });

  it('starts successfully when port is free', async () => {
    serverA = new FigmaWebSocketServer({ port: 0 });
    await serverA.start();

    expect(serverA.isStarted()).toBe(true);
    expect(serverA.address()).not.toBeNull();
    expect(serverA.address()!.port).toBeGreaterThan(0);
  });

  it('error object from EADDRINUSE has the standard shape', async () => {
    serverA = new FigmaWebSocketServer({ port: 0 });
    await serverA.start();
    const port = serverA.address()!.port;

    serverB = new FigmaWebSocketServer({ port });

    try {
      await serverB.start();
      expect.unreachable('Expected start() to throw');
    } catch (err: any) {
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe('EADDRINUSE');
      expect(err.syscall).toBeDefined();
    }
  });
});

// =============================================================================
// Unit: handleSecondInstance (real imported function)
// =============================================================================

describe('handleSecondInstance', () => {
  it('restores minimized window and focuses it', () => {
    const restoreFn = vi.fn();
    const focusFn = vi.fn();

    const mockWindow = {
      isMinimized: () => true,
      restore: restoreFn,
      focus: focusFn,
    } as any;

    handleSecondInstance(mockWindow);

    expect(restoreFn).toHaveBeenCalledOnce();
    expect(focusFn).toHaveBeenCalledOnce();
  });

  it('only focuses non-minimized window (no restore)', () => {
    const restoreFn = vi.fn();
    const focusFn = vi.fn();

    const mockWindow = {
      isMinimized: () => false,
      restore: restoreFn,
      focus: focusFn,
    } as any;

    handleSecondInstance(mockWindow);

    expect(restoreFn).not.toHaveBeenCalled();
    expect(focusFn).toHaveBeenCalledOnce();
  });

  it('handles null mainWindow gracefully', () => {
    expect(() => handleSecondInstance(null)).not.toThrow();
  });
});

// =============================================================================
// Unit: isPortConflict (real imported function)
// =============================================================================

describe('isPortConflict', () => {
  it('returns true for EADDRINUSE errors', () => {
    const err: any = new Error('listen EADDRINUSE');
    err.code = 'EADDRINUSE';

    expect(isPortConflict(err)).toBe(true);
  });

  it('returns false for non-EADDRINUSE errors', () => {
    const err: any = new Error('connection refused');
    err.code = 'ECONNREFUSED';

    expect(isPortConflict(err)).toBe(false);
  });

  it('returns false for plain Error without code', () => {
    expect(isPortConflict(new Error('generic'))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isPortConflict(null)).toBe(false);
    expect(isPortConflict(undefined)).toBe(false);
    expect(isPortConflict('EADDRINUSE')).toBe(false);
    expect(isPortConflict(42)).toBe(false);
  });

  it('integrates with real EADDRINUSE from FigmaWebSocketServer', async () => {
    const serverA = new FigmaWebSocketServer({ port: 0 });
    await serverA.start();
    const port = serverA.address()!.port;

    const serverB = new FigmaWebSocketServer({ port });

    try {
      await serverB.start();
      expect.unreachable('Expected start() to throw');
    } catch (err) {
      expect(isPortConflict(err)).toBe(true);
    } finally {
      await serverA.stop();
    }
  });
});

// =============================================================================
// Unit: Centralized messages (messages.ts)
// =============================================================================

describe('User-facing messages', () => {
  it('MSG_PORT_IN_USE_BODY includes the port number', () => {
    const body = MSG_PORT_IN_USE_BODY(9280);
    expect(body).toContain('9280');
    expect(body).toContain('Bottega');
  });

  it('MSG_PORT_IN_USE_TITLE is a non-empty string', () => {
    expect(MSG_PORT_IN_USE_TITLE.length).toBeGreaterThan(0);
  });

  it('MSG_STARTUP_ERROR_BODY formats Error objects', () => {
    const body = MSG_STARTUP_ERROR_BODY(new Error('test failure'));
    expect(body).toContain('test failure');
    expect(body).toContain('Bottega');
  });

  it('MSG_STARTUP_ERROR_BODY handles non-Error values', () => {
    const body = MSG_STARTUP_ERROR_BODY('raw string');
    expect(body).toContain('raw string');
  });

  it('MSG_STARTUP_ERROR_TITLE is a non-empty string', () => {
    expect(MSG_STARTUP_ERROR_TITLE.length).toBeGreaterThan(0);
  });

  it('all exported constants are non-empty strings or functions returning non-empty strings', () => {
    for (const [key, value] of Object.entries(messages)) {
      if (typeof value === 'string') {
        expect(value.length, `${key} should be non-empty`).toBeGreaterThan(0);
      } else if (typeof value === 'function') {
        // Call with a dummy arg to verify it returns a non-empty string
        const result = (value as (...args: any[]) => string)('test-arg');
        expect(typeof result, `${key}() should return a string`).toBe('string');
        expect(result.length, `${key}() should return non-empty`).toBeGreaterThan(0);
      }
    }
  });

  it('all messages are in English (no Italian words)', () => {
    const italianPattern = /\b(porta|occupata|chiudi|riavvia|errore di avvio|riuscita|già|può|finché)\b/i;
    for (const [key, value] of Object.entries(messages)) {
      const str = typeof value === 'function' ? (value as (...args: any[]) => string)('test') : value;
      expect(str, `${key} contains Italian`).not.toMatch(italianPattern);
    }
  });
});
