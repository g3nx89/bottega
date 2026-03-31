/**
 * Event collector for Bottega test harness.
 *
 * Passively records all agent session events and provides query helpers
 * for assertions in playbook-based tests.
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent';

// ── Record Types ────────────────────────────────────────────

export interface ToolCallRecord {
  step: number;
  toolName: string;
  input: Record<string, unknown>;
}

export interface ToolResultRecord {
  step: number;
  toolName: string;
  toolCallId: string;
  text: string;
  content: Array<{ type: string; text?: string }>;
  isError: boolean;
  mocked: boolean;
}

// ── Mutation tool names (tools that go through OperationQueue) ──

const MUTATION_TOOLS = new Set([
  'figma_execute',
  'figma_set_fills',
  'figma_set_strokes',
  'figma_set_text',
  'figma_set_image_fill',
  'figma_resize',
  'figma_move',
  'figma_create_child',
  'figma_clone',
  'figma_delete',
  'figma_rename',
  'figma_render_jsx',
  'figma_create_icon',
  'figma_bind_variable',
  'figma_instantiate',
  'figma_set_instance_properties',
  'figma_arrange_component_set',
  'figma_setup_tokens',
  'figma_set_annotations',
  'figma_generate_image',
  'figma_edit_image',
  'figma_restore_image',
  'figma_generate_icon',
  'figma_generate_pattern',
  'figma_generate_story',
  'figma_generate_diagram',
]);

// ── Events Interface ────────────────────────────────────────

export interface BottegaTestEvents {
  /** All raw session events */
  all: AgentSessionEvent[];
  /** Tool call records (name + params) */
  toolCalls: ToolCallRecord[];
  /** Tool result records (output + mocked flag) */
  toolResults: ToolResultRecord[];
  /** Assistant messages */
  messages: AgentMessage[];

  /** Filter tool calls by name */
  toolCallsFor(name: string): ToolCallRecord[];
  /** Filter tool results by name */
  toolResultsFor(name: string): ToolResultRecord[];
  /** Ordered list of tool names as called */
  toolSequence(): string[];
  /** Only mutation tools (those that go through OperationQueue) */
  mutationTools(): ToolCallRecord[];
  /** Tool results that were modified by compression extension (shorter than input) */
  compressedResults(): ToolResultRecord[];
  /** Tool results with errors */
  errorResults(): ToolResultRecord[];
}

// ── Factory ─────────────────────────────────────────────────

export function createEventCollector(): BottegaTestEvents {
  const all: AgentSessionEvent[] = [];
  const toolCalls: ToolCallRecord[] = [];
  const toolResults: ToolResultRecord[] = [];
  const messages: AgentMessage[] = [];

  return {
    all,
    toolCalls,
    toolResults,
    messages,

    toolCallsFor(name: string): ToolCallRecord[] {
      return toolCalls.filter((tc) => tc.toolName === name);
    },

    toolResultsFor(name: string): ToolResultRecord[] {
      return toolResults.filter((tr) => tr.toolName === name);
    },

    toolSequence(): string[] {
      return toolCalls.map((tc) => tc.toolName);
    },

    mutationTools(): ToolCallRecord[] {
      return toolCalls.filter((tc) => MUTATION_TOOLS.has(tc.toolName));
    },

    compressedResults(): ToolResultRecord[] {
      return toolResults.filter((tr) => {
        // Compressed results are short success responses from mutation tools
        if (tr.isError || !MUTATION_TOOLS.has(tr.toolName)) return false;
        // Compression replaces verbose JSON with compact "OK node=..." format
        return tr.text.startsWith('OK ') || tr.text.startsWith('"OK ');
      });
    },

    errorResults(): ToolResultRecord[] {
      return toolResults.filter((tr) => tr.isError);
    },
  };
}
