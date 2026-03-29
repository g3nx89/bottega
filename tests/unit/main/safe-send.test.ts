import { describe, expect, it, vi } from 'vitest';
import { safeSend } from '../../../src/main/safe-send.js';

describe('safeSend', () => {
  function createMockWebContents(destroyed: boolean) {
    return {
      isDestroyed: vi.fn().mockReturnValue(destroyed),
      send: vi.fn(),
    } as any;
  }

  it('should call wc.send() with correct channel and args when alive', () => {
    const wc = createMockWebContents(false);
    safeSend(wc, 'update:available', { version: '1.2.0' });

    expect(wc.isDestroyed).toHaveBeenCalledOnce();
    expect(wc.send).toHaveBeenCalledOnce();
    expect(wc.send).toHaveBeenCalledWith('update:available', { version: '1.2.0' });
  });

  it('should not call wc.send() when WebContents is destroyed', () => {
    const wc = createMockWebContents(true);
    safeSend(wc, 'update:checking');

    expect(wc.isDestroyed).toHaveBeenCalledOnce();
    expect(wc.send).not.toHaveBeenCalled();
  });

  it('should pass through multiple arguments correctly', () => {
    const wc = createMockWebContents(false);
    safeSend(wc, 'some:channel', 'arg1', 42, { key: 'val' }, [1, 2]);

    expect(wc.send).toHaveBeenCalledWith('some:channel', 'arg1', 42, { key: 'val' }, [1, 2]);
  });

  it('should pass through zero extra arguments', () => {
    const wc = createMockWebContents(false);
    safeSend(wc, 'update:not-available');

    expect(wc.send).toHaveBeenCalledWith('update:not-available');
  });

  it('should return undefined regardless of wc state', () => {
    const alive = createMockWebContents(false);
    const destroyed = createMockWebContents(true);

    expect(safeSend(alive, 'ch')).toBeUndefined();
    expect(safeSend(destroyed, 'ch')).toBeUndefined();
  });
});
