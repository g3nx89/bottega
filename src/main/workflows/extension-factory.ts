/**
 * Pi SDK extension factory for workflow context injection.
 *
 * When an active workflow pack is present, injects a <workflow-context> block
 * into tool results so the agent is aware of current workflow state, governance,
 * and composed capability prompt fragments.
 */

import { createChildLogger } from '../../figma/logger.js';
import type { ComposedCapabilities } from './capability-composer.js';
import { loadReferenceDocs } from './reference-loader.js';
import type { DesignWorkflowContext, WorkflowPack } from './types.js';

const log = createChildLogger({ component: 'workflow-extension' });

export interface WorkflowState {
  context: DesignWorkflowContext;
  pack: WorkflowPack | null;
  composed: ComposedCapabilities | null;
}

function buildWorkflowContextBlock(state: WorkflowState, includeRefs = false): string {
  const { context, pack, composed } = state;

  const packLine = pack ? `Pack: ${pack.id}` : 'Pack: none';
  const modeLine = `Mode: ${context.interactionMode}`;
  const governanceLine = `Governance: ${context.governancePolicy}`;
  const dsLine = `DS: ${context.dsStatus}`;

  const lines: string[] = ['<workflow-context>', `${packLine} | ${modeLine}`, `${governanceLine} | ${dsLine}`];

  if (composed?.promptFragment) {
    lines.push(composed.promptFragment);
  }

  // Append reference docs only on first injection per pack (avoid repeating KB of docs every tool call)
  if (includeRefs) {
    const refIds = composed?.referenceDocIds ?? [];
    if (refIds.length > 0) {
      const refs = loadReferenceDocs(refIds);
      for (const [id, content] of refs) {
        lines.push(`\n[Reference: ${id}]\n${content.slice(0, 2000)}`);
      }
    }
  }

  lines.push('</workflow-context>');
  return lines.join('\n');
}

/**
 * Creates a Pi SDK extension factory for workflow context injection.
 *
 * @param getState - Returns current workflow state, or null if no active workflow.
 */
export function createWorkflowExtensionFactory(getState: () => WorkflowState | null) {
  let _lastInjectedPackId: string | null = null;
  let _refsInjectedForPack = false;

  const factory = (pi: { on: (event: string, handler: (event: any) => Promise<any> | any) => void }) => {
    pi.on('tool_result', async (event: any) => {
      try {
        const state = getState();

        // No active pack — pass through
        if (!state || !state.pack) {
          _lastInjectedPackId = null;
          _refsInjectedForPack = false;
          return null;
        }

        // Inject references only on the first tool_result for a given pack (not every call)
        const isNewPack = state.pack.id !== _lastInjectedPackId;
        if (isNewPack) {
          _lastInjectedPackId = state.pack.id;
          _refsInjectedForPack = false;
        }

        const contextBlock = buildWorkflowContextBlock(state, !_refsInjectedForPack);
        _refsInjectedForPack = true;
        const content = Array.isArray(event.content) ? event.content : [];
        return { content: [...content, { type: 'text', text: contextBlock }] };
      } catch (err) {
        log.warn({ err }, 'Workflow extension error');
        return null;
      }
    });
  };

  factory.reset = () => {
    // No stateful counter to reset — here for API symmetry with other extension factories
  };

  return factory;
}
