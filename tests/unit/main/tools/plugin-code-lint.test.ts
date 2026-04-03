/**
 * Plugin code string safety tests.
 *
 * Parses the generated plugin code strings and verifies safety patterns:
 * - Correct async IIFE wrapper
 * - No direct figma.currentPage assignment (use setCurrentPageAsync)
 * - User text escaped via JSON.stringify (no injection)
 * - Hex regex accepts only 6-char hex
 * - BIND_VARIABLE structure: COLOR lookup is inside fill/stroke branches
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDiscoveryTools } from '../../../../src/main/tools/discovery.js';
import { createDsPageTools } from '../../../../src/main/tools/ds-page.js';
import { createTestToolDeps } from '../../../helpers/mock-connector.js';

describe('plugin code string safety', () => {
  let deps: ReturnType<typeof createTestToolDeps>;

  beforeEach(() => {
    deps = createTestToolDeps();
    deps.connector.executeCodeViaUI.mockResolvedValue(
      JSON.stringify({ success: true, sectionId: '1:1', sectionName: '[DS::colors]' }),
    );
  });

  describe('ds-page plugin code', () => {
    it('starts with "return (async" for bridge await', async () => {
      const tools = createDsPageTools(deps);
      const tool = tools.find((t: any) => t.name === 'figma_update_ds_page')!;
      await tool.execute(
        'c1',
        { section: 'colors', action: 'create', text: 'test' },
        undefined,
        undefined,
        undefined as any,
      );
      const code: string = deps.connector.executeCodeViaUI.mock.calls[0][0];
      expect(code.trimStart().startsWith('return (async')).toBe(true);
    });

    it('uses setCurrentPageAsync not direct assignment', async () => {
      const tools = createDsPageTools(deps);
      const tool = tools.find((t: any) => t.name === 'figma_update_ds_page')!;
      await tool.execute(
        'c1',
        { section: 'colors', action: 'create', text: 'test' },
        undefined,
        undefined,
        undefined as any,
      );
      const code: string = deps.connector.executeCodeViaUI.mock.calls[0][0];
      expect(code).toContain('setCurrentPageAsync');
      expect(code).not.toMatch(/figma\.currentPage\s*=/);
    });

    it('escapes user text via JSON.stringify', async () => {
      const tools = createDsPageTools(deps);
      const tool = tools.find((t: any) => t.name === 'figma_update_ds_page')!;
      await tool.execute(
        'c1',
        { section: 'colors', action: 'create', text: 'test" + malicious()' },
        undefined,
        undefined,
        undefined as any,
      );
      const code: string = deps.connector.executeCodeViaUI.mock.calls[0][0];
      // The raw dangerous string should NOT appear unescaped
      expect(code).not.toContain('test" + malicious()');
    });

    it('hex regex accepts only 6-char hex', async () => {
      const tools = createDsPageTools(deps);
      const tool = tools.find((t: any) => t.name === 'figma_update_ds_page')!;
      await tool.execute(
        'c1',
        {
          section: 'colors',
          action: 'create',
          text: 'Colors',
          samples: [{ label: 'Red', value: '#FF0000' }],
        },
        undefined,
        undefined,
        undefined as any,
      );
      const code: string = deps.connector.executeCodeViaUI.mock.calls[0][0];
      expect(code).toContain('{6}');
      expect(code).not.toContain('{3,8}');
    });

    it('samples are embedded as JSON in generated code', async () => {
      const tools = createDsPageTools(deps);
      const tool = tools.find((t: any) => t.name === 'figma_update_ds_page')!;
      const samples = [
        { label: 'Primary', value: '#A259FF' },
        { label: 'Secondary', value: '#4A90D9' },
      ];
      await tool.execute(
        'c1',
        { section: 'colors', action: 'create', text: 'Brand Colors', samples },
        undefined,
        undefined,
        undefined as any,
      );
      const code: string = deps.connector.executeCodeViaUI.mock.calls[0][0];
      // Samples must appear serialized, not raw object references
      expect(code).toContain('Primary');
      expect(code).toContain('#A259FF');
      // Should be embedded via JSON.stringify, so label key present as JSON string
      expect(code).toContain('"label"');
    });

    it('section tag is JSON-escaped in generated code', async () => {
      const tools = createDsPageTools(deps);
      const tool = tools.find((t: any) => t.name === 'figma_update_ds_page')!;
      await tool.execute(
        'c1',
        { section: 'typography', action: 'update', text: 'Inter font family' },
        undefined,
        undefined,
        undefined as any,
      );
      const code: string = deps.connector.executeCodeViaUI.mock.calls[0][0];
      expect(code).toContain('[DS::typography]');
    });
  });

  describe('get-file-data plugin code', () => {
    it('starts with "return (async"', async () => {
      const tools = createDiscoveryTools(deps);
      const tool = tools.find((t: any) => t.name === 'figma_get_file_data')!;
      deps.connector.executeCodeViaUI.mockResolvedValue(JSON.stringify({ id: '0:0', type: 'PAGE', name: 'Page 1' }));
      await tool.execute('c1', {}, undefined, undefined, undefined as any);
      const code: string = deps.connector.executeCodeViaUI.mock.calls[0][0];
      expect(code.trimStart().startsWith('return (async')).toBe(true);
    });

    it('uses getNodeByIdAsync when nodeId provided', async () => {
      const tools = createDiscoveryTools(deps);
      const tool = tools.find((t: any) => t.name === 'figma_get_file_data')!;
      deps.connector.executeCodeViaUI.mockResolvedValue(JSON.stringify({ id: '1:2', type: 'FRAME' }));
      await tool.execute('c1', { nodeId: '1:2' }, undefined, undefined, undefined as any);
      const code: string = deps.connector.executeCodeViaUI.mock.calls[0][0];
      expect(code).toContain('getNodeByIdAsync');
    });

    it('uses figma.currentPage when no nodeId provided', async () => {
      const tools = createDiscoveryTools(deps);
      const tool = tools.find((t: any) => t.name === 'figma_get_file_data')!;
      deps.connector.executeCodeViaUI.mockResolvedValue(JSON.stringify({ id: '0:0', type: 'PAGE', name: 'Page 1' }));
      await tool.execute('c1', {}, undefined, undefined, undefined as any);
      const code: string = deps.connector.executeCodeViaUI.mock.calls[0][0];
      expect(code).toContain('figma.currentPage');
      expect(code).not.toContain('getNodeByIdAsync');
    });
  });

  describe('bridge BIND_VARIABLE structure', () => {
    it('COLOR lookup is inside fill/stroke branches, not before', () => {
      const codeJs = readFileSync(join(process.cwd(), 'figma-desktop-bridge/code.js'), 'utf-8');

      // Find the BIND_VARIABLE section
      const bindStart = codeJs.indexOf("msg.type === 'BIND_VARIABLE'");
      expect(bindStart).toBeGreaterThan(-1);

      const bindEnd = codeJs.indexOf('BIND_VARIABLE_RESULT', bindStart + 100);
      expect(bindEnd).toBeGreaterThan(bindStart);

      const bindSection = codeJs.substring(bindStart, bindEnd);

      // COLOR lookup should come AFTER the property === 'fill' check
      const fillCheckPos = bindSection.indexOf("property === 'fill'");
      const colorLookupPos = bindSection.indexOf("getLocalVariablesAsync('COLOR')");
      expect(fillCheckPos).toBeGreaterThan(-1);
      expect(colorLookupPos).toBeGreaterThan(-1);
      expect(colorLookupPos).toBeGreaterThan(fillCheckPos);
    });

    it('FLOAT lookup is inside the else branch (not fill/stroke)', () => {
      const codeJs = readFileSync(join(process.cwd(), 'figma-desktop-bridge/code.js'), 'utf-8');

      const bindStart = codeJs.indexOf("msg.type === 'BIND_VARIABLE'");
      const bindEnd = codeJs.indexOf('BIND_VARIABLE_RESULT', bindStart + 100);
      const bindSection = codeJs.substring(bindStart, bindEnd);

      // FLOAT lookup should come after fill/stroke checks (in the else branch)
      const fillCheckPos = bindSection.indexOf("property === 'fill'");
      const floatLookupPos = bindSection.indexOf("getLocalVariablesAsync('FLOAT')");
      expect(floatLookupPos).toBeGreaterThan(-1);
      expect(floatLookupPos).toBeGreaterThan(fillCheckPos);
    });

    it('BIND_VARIABLE_RESULT is emitted for both success and error paths', () => {
      const codeJs = readFileSync(join(process.cwd(), 'figma-desktop-bridge/code.js'), 'utf-8');

      const bindStart = codeJs.indexOf("msg.type === 'BIND_VARIABLE'");
      // Find the section after the handler start to include the full try/catch
      const nextHandlerStart = codeJs.indexOf('else if (msg.type ===', bindStart + 1);
      const bindSection = codeJs.substring(bindStart, nextHandlerStart > 0 ? nextHandlerStart : bindStart + 2000);

      const successCount = (bindSection.match(/BIND_VARIABLE_RESULT.*success: true/g) ?? []).length;
      const errorCount = (bindSection.match(/BIND_VARIABLE_RESULT.*success: false/g) ?? []).length;
      expect(successCount).toBeGreaterThanOrEqual(1);
      expect(errorCount).toBeGreaterThanOrEqual(1);
    });
  });
});
