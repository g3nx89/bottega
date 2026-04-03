import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLintTools } from '../../../src/main/tools/lint.js';
import { createTokenTools } from '../../../src/main/tools/tokens.js';
import { createTestToolDeps } from '../../helpers/mock-connector.js';

// Mock logger
vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

describe('Token Tools', () => {
  let deps: ReturnType<typeof createTestToolDeps>;
  let tools: any[];

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createTestToolDeps();
    tools = createTokenTools(deps);

    // Default mock setup for token operations
    deps.connector.createVariableCollection.mockResolvedValue({
      id: 'coll-1',
      collectionId: 'coll-1',
      defaultModeId: 'mode-default',
    });
    deps.connector.addMode.mockResolvedValue({ modeId: 'mode-2', id: 'mode-2' });
    deps.connector.createVariable.mockResolvedValue({ id: 'var-1', variableId: 'var-1' });
    deps.connector.updateVariable.mockResolvedValue({ success: true });
    deps.connector.renameMode.mockResolvedValue({ success: true });
  });

  // ── figma_setup_tokens ──────────────────────────────────────────────

  describe('figma_setup_tokens', () => {
    const getTool = () => tools.find((t) => t.name === 'figma_setup_tokens');

    const baseParams = {
      collectionName: 'Design Tokens',
      modes: ['Light', 'Dark'],
      variables: [{ name: 'colors/primary', type: 'COLOR', values: { Light: '#0000FF', Dark: '#8888FF' } }],
    };

    it('creates collection with correct name', async () => {
      const tool = getTool();

      await tool.execute('call-1', baseParams, undefined, undefined, undefined);

      expect(deps.connector.createVariableCollection).toHaveBeenCalledWith('Design Tokens');
    });

    it('renames default mode to first mode name', async () => {
      const tool = getTool();

      await tool.execute('call-2', baseParams, undefined, undefined, undefined);

      expect(deps.connector.renameMode).toHaveBeenCalledWith('coll-1', 'mode-default', 'Light');
    });

    it('adds additional modes via addMode for modes[1..n]', async () => {
      const tool = getTool();
      const params = {
        ...baseParams,
        modes: ['Light', 'Dark', 'HighContrast'],
      };

      deps.connector.addMode
        .mockResolvedValueOnce({ modeId: 'mode-2', id: 'mode-2' })
        .mockResolvedValueOnce({ modeId: 'mode-3', id: 'mode-3' });

      await tool.execute('call-3', params, undefined, undefined, undefined);

      expect(deps.connector.addMode).toHaveBeenCalledTimes(2);
      expect(deps.connector.addMode).toHaveBeenCalledWith('coll-1', 'Dark');
      expect(deps.connector.addMode).toHaveBeenCalledWith('coll-1', 'HighContrast');
    });

    it('creates variables with correct name, collectionId, and type', async () => {
      const tool = getTool();
      const params = {
        ...baseParams,
        variables: [
          { name: 'colors/primary', type: 'COLOR', values: { Light: '#0000FF' } },
          { name: 'spacing/base', type: 'FLOAT', values: { Light: 8 } },
        ],
      };

      deps.connector.createVariable
        .mockResolvedValueOnce({ id: 'var-1', variableId: 'var-1' })
        .mockResolvedValueOnce({ id: 'var-2', variableId: 'var-2' });

      await tool.execute('call-4', params, undefined, undefined, undefined);

      expect(deps.connector.createVariable).toHaveBeenCalledTimes(2);
      expect(deps.connector.createVariable).toHaveBeenCalledWith('colors/primary', 'coll-1', 'COLOR');
      expect(deps.connector.createVariable).toHaveBeenCalledWith('spacing/base', 'coll-1', 'FLOAT');
    });

    it('updates variable values per mode', async () => {
      const tool = getTool();

      await tool.execute('call-5', baseParams, undefined, undefined, undefined);

      expect(deps.connector.updateVariable).toHaveBeenCalledWith('var-1', 'mode-default', '#0000FF');
      expect(deps.connector.updateVariable).toHaveBeenCalledWith('var-1', 'mode-2', '#8888FF');
    });

    it('full orchestration with 2 modes and 2 variables produces correct call sequence', async () => {
      const tool = getTool();
      const params = {
        collectionName: 'Tokens',
        modes: ['Light', 'Dark'],
        variables: [
          { name: 'colors/bg', type: 'COLOR', values: { Light: '#FFFFFF', Dark: '#000000' } },
          { name: 'spacing/sm', type: 'FLOAT', values: { Light: 4, Dark: 4 } },
        ],
      };

      deps.connector.createVariable
        .mockResolvedValueOnce({ id: 'var-bg', variableId: 'var-bg' })
        .mockResolvedValueOnce({ id: 'var-sp', variableId: 'var-sp' });

      await tool.execute('call-6', params, undefined, undefined, undefined);

      // 1. Collection created
      expect(deps.connector.createVariableCollection).toHaveBeenCalledWith('Tokens');
      // 2. Default mode renamed
      expect(deps.connector.renameMode).toHaveBeenCalledWith('coll-1', 'mode-default', 'Light');
      // 3. Second mode added
      expect(deps.connector.addMode).toHaveBeenCalledWith('coll-1', 'Dark');
      // 4. Variables created
      expect(deps.connector.createVariable).toHaveBeenCalledWith('colors/bg', 'coll-1', 'COLOR');
      expect(deps.connector.createVariable).toHaveBeenCalledWith('spacing/sm', 'coll-1', 'FLOAT');
      // 5. Values set per mode (2 vars x 2 modes = 4 calls)
      expect(deps.connector.updateVariable).toHaveBeenCalledTimes(4);
      expect(deps.connector.updateVariable).toHaveBeenCalledWith('var-bg', 'mode-default', '#FFFFFF');
      expect(deps.connector.updateVariable).toHaveBeenCalledWith('var-bg', 'mode-2', '#000000');
      expect(deps.connector.updateVariable).toHaveBeenCalledWith('var-sp', 'mode-default', 4);
      expect(deps.connector.updateVariable).toHaveBeenCalledWith('var-sp', 'mode-2', 4);
    });

    it('returns textResult with collectionId, modeIds, and variables', async () => {
      const tool = getTool();

      const result = await tool.execute('call-7', baseParams, undefined, undefined, undefined);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual({
        collectionId: 'coll-1',
        modeIds: { Light: 'mode-default', Dark: 'mode-2' },
        variables: [{ name: 'colors/primary', id: 'var-1' }],
      });
      expect(result.details).toEqual({});
    });

    it('error from createVariableCollection propagates', async () => {
      const tool = getTool();
      deps.connector.createVariableCollection.mockRejectedValue(new Error('Collection limit reached'));

      await expect(tool.execute('call-8', baseParams, undefined, undefined, undefined)).rejects.toThrow(
        'Collection limit reached',
      );
    });

    it('uses OperationQueue for serialization', async () => {
      const tool = getTool();
      const executeSpy = vi.spyOn(deps.operationQueue, 'execute');

      await tool.execute('call-9', baseParams, undefined, undefined, undefined);

      expect(executeSpy).toHaveBeenCalledTimes(1);
      expect(executeSpy).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  // ── figma_lint ──────────────────────────────────────────────────────

  describe('figma_lint', () => {
    const getTool = () => {
      const tool = createLintTools(deps).find((t) => t.name === 'figma_lint');
      if (!tool) throw new Error('figma_lint not found');
      return tool;
    };

    it('calls connector.lintDesign with nodeId and rules', async () => {
      const tool = getTool();
      deps.connector.lintDesign.mockResolvedValue({ issues: [], count: 0 });

      await tool.execute('call-10', { nodeId: '1:42', rules: ['naming'] }, undefined, undefined, undefined as any);

      expect(deps.connector.lintDesign).toHaveBeenCalledWith('1:42', ['naming']);
    });

    it('handles optional params — both nodeId and rules can be undefined', async () => {
      const tool = getTool();
      deps.connector.lintDesign.mockResolvedValue({ issues: [] });

      await tool.execute('call-11', {}, undefined, undefined, undefined as any);

      expect(deps.connector.lintDesign).toHaveBeenCalledWith(undefined, undefined);
    });

    it('does NOT use OperationQueue (read operation)', async () => {
      const tool = getTool();
      const executeSpy = vi.spyOn(deps.operationQueue, 'execute');
      deps.connector.lintDesign.mockResolvedValue({ issues: [] });

      await tool.execute('call-12', {}, undefined, undefined, undefined as any);

      expect(executeSpy).not.toHaveBeenCalled();
    });
  });
});
