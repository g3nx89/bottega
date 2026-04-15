/**
 * Coverage for the auth-adapter + provider-resolution helpers added to
 * agent.ts this session.
 *
 * - `authCandidatesFor(provider)`: returns every storage slot that could
 *   legitimately hold a credential for the given SDK provider (handles the
 *   display-group vs oauth-id split via OAUTH_PROVIDER_MAP).
 * - `buildAuthAdapter(authStorage)`: wraps Pi SDK's AuthStorage so
 *   ModelProbe sees credentials from any equivalent slot AND so Pi SDK's
 *   env-var fallback (e.g. OPENAI_API_KEY from parent shell) is explicitly
 *   ignored — only credentials saved via Settings UI count.
 * - `resolveSdkModelId(modelId)`: strips Bottega-synthetic id suffixes
 *   (currently `claude-opus-4-6-1m` → `claude-opus-4-6`) so getModel() sees
 *   a real Pi SDK id while Bottega keeps separate context-window metadata.
 */

import { describe, expect, it, vi } from 'vitest';
import { authCandidatesFor, buildAuthAdapter, resolveSdkModelId } from '../../../src/main/agent.js';

describe('authCandidatesFor', () => {
  it('includes both the display group and its OAuth id for google', () => {
    const candidates = authCandidatesFor('google');
    expect(candidates).toContain('google');
    expect(candidates).toContain('google-gemini-cli');
  });

  it('includes both the OAuth id and its display group when queried by OAuth id', () => {
    const candidates = authCandidatesFor('google-gemini-cli');
    expect(candidates).toContain('google-gemini-cli');
    expect(candidates).toContain('google');
  });

  it('includes openai + openai-codex for openai-codex queries', () => {
    const candidates = authCandidatesFor('openai-codex');
    expect(candidates).toContain('openai-codex');
    expect(candidates).toContain('openai');
  });

  it('returns just the provider when no OAuth twin exists (anthropic)', () => {
    const candidates = authCandidatesFor('anthropic');
    expect(candidates).toEqual(['anthropic']);
  });

  it('deduplicates when provider equals its OAuth id (anthropic → anthropic)', () => {
    expect(new Set(authCandidatesFor('anthropic')).size).toBe(authCandidatesFor('anthropic').length);
  });

  it('falls back to the bare provider for unknown inputs', () => {
    expect(authCandidatesFor('nonsense-provider')).toEqual(['nonsense-provider']);
  });
});

describe('buildAuthAdapter', () => {
  function makeStorage(slots: Record<string, { type: 'api_key' | 'oauth'; token?: string }>) {
    return {
      get: vi.fn((provider: string) => slots[provider]),
      getApiKey: vi.fn(async (provider: string) => slots[provider]?.token ?? null),
    } as any;
  }

  describe('getCredentialType', () => {
    it('returns oauth when any candidate has an oauth credential', () => {
      const storage = makeStorage({ 'google-gemini-cli': { type: 'oauth', token: 'tok' } });
      const adapter = buildAuthAdapter(storage);
      expect(adapter.getCredentialType('google')).toBe('oauth');
    });

    it('returns api_key when only api_key credentials exist across candidates', () => {
      const storage = makeStorage({ google: { type: 'api_key', token: 'AIza' } });
      const adapter = buildAuthAdapter(storage);
      expect(adapter.getCredentialType('google')).toBe('api_key');
    });

    it('prefers oauth over api_key when both candidates are populated', () => {
      const storage = makeStorage({
        'google-gemini-cli': { type: 'oauth', token: 'tok' },
        google: { type: 'api_key', token: 'AIza' },
      });
      const adapter = buildAuthAdapter(storage);
      expect(adapter.getCredentialType('google')).toBe('oauth');
    });

    it('returns none when no candidate slot has a credential', () => {
      const storage = makeStorage({});
      const adapter = buildAuthAdapter(storage);
      expect(adapter.getCredentialType('openai-codex')).toBe('none');
    });
  });

  describe('getApiKey — env-var filtering', () => {
    it('returns the key when the candidate has a stored credential', async () => {
      const storage = makeStorage({ anthropic: { type: 'api_key', token: 'sk-ant' } });
      const adapter = buildAuthAdapter(storage);
      await expect(adapter.getApiKey('anthropic')).resolves.toBe('sk-ant');
    });

    it('ignores env-var fallbacks: returns null when no candidate has get()', async () => {
      // Simulate Pi SDK returning a key via getApiKey() (e.g. OPENAI_API_KEY
      // env var) even though get() has no stored credential.
      const storage = {
        get: vi.fn(() => undefined),
        getApiKey: vi.fn(async () => 'sk-proj-from-env'),
      } as any;
      const adapter = buildAuthAdapter(storage);
      await expect(adapter.getApiKey('openai-codex')).resolves.toBeNull();
    });

    it('walks candidates and returns the first populated one', async () => {
      const storage = makeStorage({ openai: { type: 'api_key', token: 'sk-a' } });
      const adapter = buildAuthAdapter(storage);
      // provider='openai-codex' → candidates ['openai-codex', 'openai']
      await expect(adapter.getApiKey('openai-codex')).resolves.toBe('sk-a');
    });
  });
});

describe('resolveSdkModelId', () => {
  it('strips the -1m synthetic suffix for claude-opus-4-6', () => {
    expect(resolveSdkModelId('claude-opus-4-6-1m')).toBe('claude-opus-4-6');
  });

  it('passes other model ids through unchanged', () => {
    expect(resolveSdkModelId('claude-opus-4-6')).toBe('claude-opus-4-6');
    expect(resolveSdkModelId('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
    expect(resolveSdkModelId('gemini-3-flash')).toBe('gemini-3-flash');
    expect(resolveSdkModelId('gpt-5.4')).toBe('gpt-5.4');
  });
});
