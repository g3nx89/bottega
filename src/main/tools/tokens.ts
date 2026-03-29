import { StringEnum } from '@mariozechner/pi-ai';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { type ToolDeps, textResult } from './index.js';

async function createModes(
  connector: ToolDeps['connector'],
  collectionId: string,
  modeNames: string[],
  defaultModeId?: string,
): Promise<Record<string, string>> {
  const modeIds: Record<string, string> = {};
  if (defaultModeId && modeNames[0]) {
    await connector.renameMode(collectionId, defaultModeId, modeNames[0]);
    modeIds[modeNames[0]] = defaultModeId;
  }
  for (let i = 1; i < modeNames.length; i++) {
    const name = modeNames[i]!;
    const mode = await connector.addMode(collectionId, name);
    modeIds[name] = mode.modeId || mode.id;
  }
  return modeIds;
}

async function createVariablesWithValues(
  connector: ToolDeps['connector'],
  collectionId: string,
  variables: Array<{ name: string; type: string; values: Record<string, unknown> }>,
  modeIds: Record<string, string>,
): Promise<Array<{ name: string; id: string }>> {
  const created: Array<{ name: string; id: string }> = [];
  for (const v of variables) {
    const variable = await connector.createVariable(v.name, collectionId, v.type);
    const varId = variable.id || variable.variableId;
    for (const [modeName, value] of Object.entries(v.values)) {
      const modeId = modeIds[modeName];
      if (modeId) await connector.updateVariable(varId, modeId, value);
    }
    created.push({ name: v.name, id: varId });
  }
  return created;
}

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
        variables: Type.Array(
          Type.Object({
            name: Type.String({ description: 'Variable name (e.g. "colors/primary")' }),
            type: StringEnum(['COLOR', 'FLOAT', 'STRING'] as const),
            values: Type.Record(Type.String(), Type.Any(), { description: 'Mode name → value mapping' }),
          }),
        ),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const collection = await connector.createVariableCollection(params.collectionName);
          const collectionId = collection.id || collection.collectionId;
          const modeIds = await createModes(connector, collectionId, params.modes, collection.defaultModeId);
          const variables = await createVariablesWithValues(connector, collectionId, params.variables, modeIds);
          return textResult({ collectionId, modeIds, variables });
        });
      },
    },
    {
      name: 'figma_lint',
      label: 'Lint Design',
      description:
        'Run design linting rules on a node or the entire page. Checks naming conventions, spacing consistency, and other design quality rules.',
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
