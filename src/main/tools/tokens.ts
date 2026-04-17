import { StringEnum } from '@mariozechner/pi-ai';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { defineTool } from '@mariozechner/pi-coding-agent';
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
    const result = await connector.addMode(collectionId, name);
    // Bridge wraps: { success, newMode: { modeId, name }, collection }
    modeIds[name] = result.newMode?.modeId || result.modeId || result.id;
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
    const varResult = await connector.createVariable(v.name, collectionId, v.type);
    // Bridge wraps: { success, variable: { id, name, ... } }
    const variable = varResult.variable ?? varResult;
    const varId = variable.id || variable.variableId;
    for (const [modeName, value] of Object.entries(v.values)) {
      const modeId = modeIds[modeName];
      if (!modeId) {
        throw new Error(
          `Mode "${modeName}" not found in collection. Available modes: ${Object.keys(modeIds).join(', ')}`,
        );
      }
      await connector.updateVariable(varId, modeId, value);
    }
    created.push({ name: v.name, id: varId });
  }
  return created;
}

async function reconcileExistingModes(
  connector: ToolDeps['connector'],
  existingCollection: any,
  collectionId: string,
  requestedModes: string[],
): Promise<Record<string, string>> {
  const existingModes: Array<{ modeId: string; name: string }> = existingCollection.modes ?? [];
  const existingModeMap: Record<string, string> = {};
  for (const m of existingModes) existingModeMap[m.name] = m.modeId;

  const requestedSet = new Set(requestedModes);
  const unmatchedExisting = existingModes.filter((m) => !requestedSet.has(m.name));
  let renameIdx = 0;
  for (const modeName of requestedModes) {
    if (existingModeMap[modeName]) continue;
    if (renameIdx < unmatchedExisting.length) {
      const toRename = unmatchedExisting[renameIdx++]!;
      await connector.renameMode(collectionId, toRename.modeId, modeName);
      existingModeMap[modeName] = toRename.modeId;
      delete existingModeMap[toRename.name];
    } else {
      const modeResult = await connector.addMode(collectionId, modeName);
      existingModeMap[modeName] = modeResult.newMode?.modeId || modeResult.modeId || modeResult.id;
    }
  }
  return existingModeMap;
}

function resolveExistingVariables(existing: any, existingCollection: any, collectionId: string): any[] {
  // Two payload shapes:
  // 1. Real Desktop Bridge: flat top-level array with variableCollectionId
  // 2. Legacy/mock: embedded directly inside each collection object
  if (Array.isArray(existingCollection.variables) && existingCollection.variables.length > 0) {
    return existingCollection.variables;
  }
  const flatVars: any[] = existing?.variables ?? [];
  return flatVars.filter((v: any) => v.variableCollectionId === collectionId);
}

async function applyVariableValues(
  connector: ToolDeps['connector'],
  varId: string,
  values: Record<string, unknown>,
  modeMap: Record<string, string>,
): Promise<void> {
  for (const [modeName, value] of Object.entries(values)) {
    const modeId = modeMap[modeName];
    if (!modeId) {
      throw new Error(
        `Mode "${modeName}" not found in collection. Available modes: ${Object.keys(modeMap).join(', ')}`,
      );
    }
    await connector.updateVariable(varId, modeId, value);
  }
}

async function upsertVariables(
  connector: ToolDeps['connector'],
  existingVars: any[],
  collectionId: string,
  modeMap: Record<string, string>,
  requested: Array<{ name: string; type: string; values: Record<string, unknown> }>,
): Promise<Array<{ name: string; id: string }>> {
  const byName = new Map<string, any>();
  for (const ev of existingVars) byName.set(ev.name, ev);
  const created: Array<{ name: string; id: string }> = [];
  for (const v of requested) {
    const existingVar = byName.get(v.name);
    let varId: string;
    if (existingVar) {
      varId = existingVar.id || existingVar.variableId;
    } else {
      const variable = await connector.createVariable(v.name, collectionId, v.type);
      varId = variable.id || variable.variableId;
    }
    await applyVariableValues(connector, varId, v.values, modeMap);
    created.push({ name: v.name, id: varId });
  }
  return created;
}

export function createTokenTools(deps: ToolDeps): ToolDefinition[] {
  const { connector, operationQueue } = deps;

  return [
    defineTool({
      name: 'figma_batch_bind_variable',
      label: 'Batch Bind Variable',
      description:
        'Bind multiple node properties to Figma variables (design tokens) in a single call. Much faster than calling figma_bind_variable repeatedly.',
      promptSnippet:
        'figma_batch_bind_variable: bind multiple nodes to design tokens at once (colors: fill/stroke, numeric: padding, spacing, etc.)',
      parameters: Type.Object({
        bindings: Type.Array(
          Type.Object({
            nodeId: Type.String({ description: 'Node ID' }),
            variableName: Type.String({ description: 'Variable name (e.g. "colors/primary")' }),
            property: StringEnum(
              [
                'fill',
                'stroke',
                'paddingTop',
                'paddingRight',
                'paddingBottom',
                'paddingLeft',
                'itemSpacing',
                'cornerRadius',
                'fontSize',
                'lineHeight',
                'strokeWeight',
              ] as const,
              { description: 'Property to bind' },
            ),
          }),
          { description: 'Array of variable bindings to apply', maxItems: 200 },
        ),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const results: Array<{
            nodeId: string;
            variableName: string;
            property: string;
            success: boolean;
            error?: string;
          }> = [];
          for (const binding of params.bindings) {
            try {
              await connector.bindVariable(binding.nodeId, binding.variableName, binding.property as any);
              results.push({
                nodeId: binding.nodeId,
                variableName: binding.variableName,
                property: binding.property,
                success: true,
              });
            } catch (err: any) {
              results.push({
                nodeId: binding.nodeId,
                variableName: binding.variableName,
                property: binding.property,
                success: false,
                error: err.message ?? String(err),
              });
            }
          }
          const succeeded = results.filter((r) => r.success).length;
          const failed = results.filter((r) => !r.success).length;
          return textResult({ succeeded, failed, total: results.length, results });
        });
      },
    }),
    defineTool({
      name: 'figma_setup_tokens',
      label: 'Setup Design Tokens',
      description:
        'Create or update a design token system: collection, modes, and variables with values. Idempotent — creates if new, updates if existing. Example: { collectionName: "Tokens", modes: ["Light", "Dark"], variables: [{ name: "colors/primary", type: "COLOR", values: { "Light": { r: 0.65, g: 0.35, b: 1 }, "Dark": { r: 0.8, g: 0.5, b: 1 } } }] }',
      promptSnippet:
        'figma_setup_tokens: create/update token collection. REQUIRED per variable: name, type, values (mode→value map). Example: variables: [{ name: "colors/primary", type: "COLOR", values: { "Light": { r:0.65, g:0.35, b:1 }, "Dark": { r:0.8, g:0.5, b:1 } } }]',
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
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        return operationQueue.execute(async () => {
          const existing = await connector.getVariables();
          const existingCollections: any[] = existing?.variableCollections ?? existing?.collections ?? [];
          const existingCollection = existingCollections.find((c: any) => c.name === params.collectionName);

          if (existingCollection) {
            const collectionId = existingCollection.id || existingCollection.collectionId;
            const modeMap = await reconcileExistingModes(connector, existingCollection, collectionId, params.modes);
            const existingVars = resolveExistingVariables(existing, existingCollection, collectionId);
            const variables = await upsertVariables(connector, existingVars, collectionId, modeMap, params.variables);
            return textResult({ collectionId, modeIds: modeMap, variables });
          }

          const collResult = await connector.createVariableCollection(params.collectionName);
          const collection = collResult.collection ?? collResult;
          const collectionId = collection.id || collection.collectionId;
          const modeIds = await createModes(connector, collectionId, params.modes, collection.defaultModeId);
          const variables = await createVariablesWithValues(connector, collectionId, params.variables, modeIds);
          return textResult({ collectionId, modeIds, variables });
        });
      },
    }),
  ];
}
