/**
 * Pre-send gate logic extracted from ipc-handlers.ts agent:prompt handler.
 *
 * Encapsulates F4 (auth mismatch telemetry) + F12 (cached probe gate). Pure
 * decision — no side effects on the session; callers handle the UX response.
 */

import { MSG_NO_CREDENTIALS } from './messages.js';
import { hashApiKey, type ModelProbe } from './model-probe.js';

export type SendGateDecision =
  | { type: 'proceed'; apiKey: string }
  | { type: 'blocked'; reason: 'auth_red' | 'probe_red'; message: string; probeStatus?: string };

export interface SendGateDeps {
  authStorage: {
    getApiKey(provider: string): Promise<string | undefined | null>;
    get(provider: string): { type: 'api_key' | 'oauth' } | undefined;
  };
  modelProbe?: Pick<ModelProbe, 'getCached'>;
  tracker?: {
    trackModelAuthMismatch(data: {
      modelId: string;
      sdkProvider: string;
      authType: 'none' | 'api_key' | 'oauth' | null;
      attemptedAction: 'switch' | 'send';
      slotId?: string;
    }): void;
    trackSendBlocked(data: {
      provider: string;
      modelId: string;
      reason: 'auth_red' | 'probe_red' | 'unknown';
      slotId?: string;
    }): void;
  };
}

/**
 * Run F4 + F12 gates. Returns `proceed` with the apiKey for callers to use,
 * or `blocked` with a user-facing message + telemetry already emitted.
 */
export async function checkSendPreconditions(
  deps: SendGateDeps,
  slot: { id: string; modelConfig: { provider: string; modelId: string } },
): Promise<SendGateDecision> {
  const { provider, modelId } = slot.modelConfig;
  const apiKey = await deps.authStorage.getApiKey(provider);
  if (!apiKey) {
    // F4 mismatch + F12 send-blocked telemetry, then return blocked.
    const creds = deps.authStorage.get(provider);
    deps.tracker?.trackModelAuthMismatch({
      modelId,
      sdkProvider: provider,
      authType: creds?.type ?? null,
      attemptedAction: 'send',
      slotId: slot.id,
    });
    deps.tracker?.trackSendBlocked({ provider, modelId, reason: 'auth_red', slotId: slot.id });
    return { type: 'blocked', reason: 'auth_red', message: MSG_NO_CREDENTIALS };
  }

  // F12 cache-only lookup. Never triggers a network probe here — send-path stays fast.
  // ModelProbe optional for minimal test harnesses; production always supplies it.
  const cached = deps.modelProbe?.getCached(provider, modelId, hashApiKey(apiKey));
  if (cached && (cached.status === 'unauthorized' || cached.status === 'forbidden' || cached.status === 'not_found')) {
    deps.tracker?.trackSendBlocked({ provider, modelId, reason: 'probe_red', slotId: slot.id });
    return {
      type: 'blocked',
      reason: 'probe_red',
      probeStatus: cached.status,
      message: `Model ${modelId} is not available (${cached.status}). Open Settings to re-login or switch model.`,
    };
  }

  return { type: 'proceed', apiKey };
}
