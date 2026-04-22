import type { IFigmaConnector } from '../../figma/figma-connector.js';
import { createChildLogger } from '../../figma/logger.js';
import type { RewindManager } from './manager.js';

const log = createChildLogger({ component: 'rewind-extension' });

type PiHook = (event: string, handler: (event: unknown) => Promise<unknown> | unknown) => void;

export interface RewindExtensionDeps {
  isEnabled: () => boolean;
  getConnector: () => IFigmaConnector | null;
  getFileKey: () => string;
  getSlotId: () => string;
  manager: RewindManager;
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function createRewindExtensionFactory(deps: RewindExtensionDeps) {
  const guard = (eventName: string, fn: () => unknown | Promise<unknown>) => {
    if (!deps.isEnabled()) return undefined;
    try {
      const result = fn();
      if (result instanceof Promise) {
        return result.catch((err) => {
          log.warn({ err, slotId: deps.getSlotId() }, `rewind: ${eventName} handler failed`);
        });
      }
      return result;
    } catch (err) {
      log.warn({ err, slotId: deps.getSlotId() }, `rewind: ${eventName} handler failed`);
      return undefined;
    }
  };

  return (pi: { on: PiHook }) => {
    pi.on('session_start', () =>
      guard('session_start', async () => {
        const connector = deps.getConnector();
        if (!connector) return;
        await deps.manager.onSessionStart(deps.getSlotId(), deps.getFileKey(), connector);
      }),
    );

    pi.on('agent_start', () =>
      guard('agent_start', () => {
        deps.manager.onAgentStart(deps.getSlotId(), deps.getFileKey());
      }),
    );

    pi.on('tool_call', (event: unknown) =>
      guard('tool_call', () => {
        const connector = deps.getConnector();
        if (!connector) return;
        const payload = readObject(event);
        const toolName = typeof payload.toolName === 'string' ? payload.toolName : '';
        const toolCallId = typeof payload.toolCallId === 'string' ? payload.toolCallId : '';
        const input = readObject(payload.input);
        if (!toolName || !toolCallId) return;
        deps.manager.onToolCall(deps.getSlotId(), toolCallId, toolName, input, connector);
      }),
    );

    pi.on('tool_result', (event: unknown) =>
      guard('tool_result', () => {
        const payload = readObject(event);
        const toolCallId = typeof payload.toolCallId === 'string' ? payload.toolCallId : '';
        if (!toolCallId) return;
        const result =
          payload.result ??
          (Array.isArray(payload.content)
            ? { content: payload.content, isError: payload.isError === true }
            : undefined);
        deps.manager.onToolResult(deps.getSlotId(), toolCallId, result);
      }),
    );

    pi.on('agent_end', () =>
      guard('agent_end', async () => {
        await deps.manager.onAgentEnd(deps.getSlotId());
      }),
    );
  };
}
