import { Type } from '@sinclair/typebox';
import { StringEnum } from '@mariozechner/pi-ai';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { type ToolDeps, textResult } from './index.js';

export function createTokenTools(deps: ToolDeps): ToolDefinition[] {
  const { connector, operationQueue } = deps;

  return [
    {
      name: 'figma_setup_tokens',
      label: 'Setup Design Tokens',
      description: 'Create a complete design token system: collection, modes, and variables with values.',
      promptSnippet: 'figma_setup_tokens: create a design token collection with modes and variables in one call',
      parameters: Type.Object({
        collectionName: Type.String({ description: 'Name for the variable collection' }),
        modes: Type.Array(Type.String(), { description: 'Mode names (e.g. ["Light", "Dark"])' }),
        variables: Type.Array(Type.Object({
          name: Type.String({ description: 'Variable name (e.g. "colors/primary")' }),
          type: StringEnum(['COLOR', 'FLOAT', 'STRING'] as const),
          values: Type.Record(Type.String(), Type.Any(), { description: 'Mode name → value mapping' }),
        })),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          // 1. Create collection
          const collection = await connector.createVariableCollection(params.collectionName);
          const collectionId = collection.id || collection.collectionId;

          // 2. Add modes (first mode is created automatically)
          const modeIds: Record<string, string> = {};
          if (collection.defaultModeId) {
            // Rename default mode to first mode name
            await connector.renameMode(collectionId, collection.defaultModeId, params.modes[0]);
            modeIds[params.modes[0]] = collection.defaultModeId;
          }
          for (let i = 1; i < params.modes.length; i++) {
            const mode = await connector.addMode(collectionId, params.modes[i]);
            modeIds[params.modes[i]] = mode.modeId || mode.id;
          }

          // 3. Create variables and set values per mode
          const createdVars: any[] = [];
          for (const v of params.variables) {
            const variable = await connector.createVariable(v.name, collectionId, v.type);
            const varId = variable.id || variable.variableId;

            for (const [modeName, value] of Object.entries(v.values)) {
              const modeId = modeIds[modeName];
              if (modeId) {
                await connector.updateVariable(varId, modeId, value);
              }
            }
            createdVars.push({ name: v.name, id: varId });
          }

          return textResult({ collectionId, modeIds, variables: createdVars });
        });
      },
    },
    {
      name: 'figma_lint',
      label: 'Lint Design',
      description: 'Run design linting rules on a node or the entire page. Checks naming conventions, spacing consistency, and other design quality rules.',
      promptSnippet: 'figma_lint: check design quality (naming, spacing, consistency)',
      parameters: Type.Object({
        nodeId: Type.Optional(Type.String({ description: 'Node ID to lint. If omitted, lints entire page.' })),
        rules: Type.Optional(Type.Array(Type.String(), { description: 'Specific rule names to check' })),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        const result = await connector.lintDesign(params.nodeId, params.rules);
        return textResult(result);
      },
    },
  ];
}
