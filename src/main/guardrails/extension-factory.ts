/**
 * Guardrails Pi SDK extension factory.
 *
 * Wires a `tool_call` handler that: (1) decides if the tool is a mutation,
 * (2) evaluates the built-in rules, (3) if a rule matches and has not
 * already been approved this turn, asks the renderer for confirmation,
 * (4) blocks the tool with { block: true, reason } on denial/timeout.
 *
 * Deps are injected per-slot so the same factory closure can be reused
 * across sessions while still pointing at the right ScopedConnector,
 * slot id, and webContents of the active BrowserWindow.
 */

import type { IFigmaConnector } from '../../figma/figma-connector.js';
import { createChildLogger } from '../../figma/logger.js';
import { isMutation } from '../tool-meta.js';
import { requestConfirm } from './confirm-bus.js';
import { evaluateRules } from './rules.js';
import { createState, isAlreadyApproved, onAgentStart, rememberDecision } from './state.js';
import type { RuleId } from './types.js';

const log = createChildLogger({ component: 'guardrails' });

type PiHook = (event: string, handler: (event: any) => Promise<any> | any) => void;

export interface GuardrailsMetrics {
  recordGuardrailsEvaluated(ruleId: RuleId | 'none'): void;
  recordGuardrailsBlocked(ruleId: RuleId): void;
  recordGuardrailsAllowed(ruleId: RuleId): void;
  recordGuardrailsProbeFailed?(): void;
}

export interface GuardrailsDeps {
  isEnabled: () => boolean;
  getWebContents: () => Electron.WebContents | null;
  getConnector: () => IFigmaConnector | null;
  getFileKey: () => string;
  getSlotId: () => string;
  metrics?: GuardrailsMetrics;
  signal?: AbortSignal;
}

export function createGuardrailsExtensionFactory(deps: GuardrailsDeps) {
  return (pi: { on: PiHook }) => {
    const state = createState();

    // Dedup scope = user request (agent_start → agent_end) rather than Pi SDK
    // turn (single assistant response). The LLM often emits tool calls across
    // multiple iterations while pursuing one user ask, and asking again for
    // every iteration of the same rule would be noisy.
    pi.on('agent_start', (_ev: any) => {
      onAgentStart(state);
    });

    pi.on('tool_call', async (event: any) => {
      try {
        if (!deps.isEnabled()) return;
        const toolName: string = event?.toolName;
        if (!toolName || !isMutation(toolName)) return;

        const input: Record<string, unknown> =
          event?.input && typeof event.input === 'object' ? (event.input as Record<string, unknown>) : {};

        const match = await evaluateRules(toolName, input, {
          connector: deps.getConnector(),
          fileKey: deps.getFileKey(),
          onProbeFailed: () => deps.metrics?.recordGuardrailsProbeFailed?.(),
        });
        deps.metrics?.recordGuardrailsEvaluated(match?.ruleId ?? 'none');
        if (!match) return;

        if (isAlreadyApproved(state, match.ruleId)) {
          deps.metrics?.recordGuardrailsAllowed(match.ruleId);
          log.debug(
            { guardrails: { ruleId: match.ruleId, toolName, decision: 'auto-allowed' } },
            'Guardrails auto-allowed (dedup within turn)',
          );
          return;
        }

        log.info(
          { guardrails: { ruleId: match.ruleId, toolName, label: match.affectedLabel } },
          'Guardrails requesting confirm',
        );
        const decision = await requestConfirm(deps.getWebContents(), { slotId: deps.getSlotId(), match }, deps.signal);
        rememberDecision(state, match.ruleId, decision);

        if (decision === 'block') {
          deps.metrics?.recordGuardrailsBlocked(match.ruleId);
          log.info({ guardrails: { ruleId: match.ruleId, toolName, decision: 'block' } }, 'Guardrails BLOCKED');
          return {
            block: true,
            reason: `Bloccato da Guardrails (${match.ruleId}): ${match.description}`,
          };
        }

        deps.metrics?.recordGuardrailsAllowed(match.ruleId);
        log.info({ guardrails: { ruleId: match.ruleId, toolName, decision: 'allow' } }, 'Guardrails ALLOWED');
      } catch (err) {
        // Fail-closed: an unexpected exception in the extension must NOT silently
        // allow the tool to proceed — that would violate the confirm-bus contract
        // ("fail-closed on any error"). A thrown rule or connector shape change
        // would otherwise let destructive mutations through without a prompt.
        log.error({ err, toolName: event?.toolName }, 'Guardrails handler threw; failing closed');
        return {
          block: true,
          reason: 'Bloccato da Guardrails: errore interno del sistema di protezione, controlla i log.',
        };
      }
    });
  };
}
