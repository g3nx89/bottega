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
          // Check for existing collection (idempotent)
          const existing = await connector.getVariables();
          const existingCollections: any[] = existing?.variableCollections ?? existing?.collections ?? [];
          const existingCollection = existingCollections.find((c: any) => c.name === params.collectionName);

          if (existingCollection) {
            // Update existing collection
            const collectionId = existingCollection.id || existingCollection.collectionId;
            const existingModes: Array<{ modeId: string; name: string }> = existingCollection.modes ?? [];
            const existingModeMap: Record<string, string> = {};
            for (const m of existingModes) {
              existingModeMap[m.name] = m.modeId;
            }

            // Reconcile modes: rename Figma's default mode if it doesn't match requested names
            const requestedSet = new Set(params.modes as string[]);
            const unmatchedExisting = existingModes.filter((m) => !requestedSet.has(m.name));
            let renameIdx = 0;
            for (const modeName of params.modes) {
              if (existingModeMap[modeName]) continue; // already exists with correct name
              if (renameIdx < unmatchedExisting.length) {
                // Rename an unmatched existing mode (e.g. "Mode 1" → "Light")
                const toRename = unmatchedExisting[renameIdx++]!;
                await connector.renameMode(collectionId, toRename.modeId, modeName);
                existingModeMap[modeName] = toRename.modeId;
                delete existingModeMap[toRename.name];
              } else {
                // No more existing modes to rename — create new
                const modeResult = await connector.addMode(collectionId, modeName);
                // Bridge wraps: { success, newMode: { modeId, name }, collection }
                existingModeMap[modeName] = modeResult.newMode?.modeId || modeResult.modeId || modeResult.id;
              }
            }

            // Upsert variables.
            // Support two payload shapes:
            // 1. Real Desktop Bridge: variables are a flat top-level array with variableCollectionId
            // 2. Legacy/mock: variables are embedded directly inside each collection object
            const existingVars: any[] = (() => {
              if (Array.isArray(existingCollection.variables) && existingCollection.variables.length > 0) {
                // Embedded shape (legacy/mock)
                return existingCollection.variables;
              }
              // Flat shape (real Desktop Bridge)
              const flatVars: any[] = existing?.variables ?? [];
              return flatVars.filter((v: any) => v.variableCollectionId === collectionId);
            })();
            const created: Array<{ name: string; id: string }> = [];
            for (const v of params.variables) {
              const existingVar = existingVars.find((ev: any) => ev.name === v.name);
              if (existingVar) {
                // Update existing variable values
                const varId = existingVar.id || existingVar.variableId;
                for (const [modeName, value] of Object.entries(v.values)) {
                  const modeId = existingModeMap[modeName];
                  if (!modeId) {
                    throw new Error(
                      `Mode "${modeName}" not found in collection. Available modes: ${Object.keys(existingModeMap).join(', ')}`,
                    );
                  }
                  await connector.updateVariable(varId, modeId, value);
                }
                created.push({ name: v.name, id: varId });
              } else {
                // Create new variable
                const variable = await connector.createVariable(v.name, collectionId, v.type);
                const varId = variable.id || variable.variableId;
                for (const [modeName, value] of Object.entries(v.values)) {
                  const modeId = existingModeMap[modeName];
                  if (!modeId) {
                    throw new Error(
                      `Mode "${modeName}" not found in collection. Available modes: ${Object.keys(existingModeMap).join(', ')}`,
                    );
                  }
                  await connector.updateVariable(varId, modeId, value);
                }
                created.push({ name: v.name, id: varId });
              }
            }

            return textResult({ collectionId, modeIds: existingModeMap, variables: created });
          } else {
            // Create new collection
            const collResult = await connector.createVariableCollection(params.collectionName);
            // Bridge wraps: { success, collection: { id, modes, defaultModeId, ... } }
            const collection = collResult.collection ?? collResult;
            const collectionId = collection.id || collection.collectionId;
            const modeIds = await createModes(connector, collectionId, params.modes, collection.defaultModeId);
            const variables = await createVariablesWithValues(connector, collectionId, params.variables, modeIds);
            return textResult({ collectionId, modeIds, variables });
          }
        });
      },
    }),
  ];
}
