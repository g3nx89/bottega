/**
 * Typed fixture data mirroring REAL Desktop Bridge response shapes.
 * Source: src/figma/websocket-connector.ts — getVariables(), getLocalComponents(), lintDesign()
 */

/** Real shape from WebSocketConnector.getVariables() — flat variables + separate collections */
export const GET_VARIABLES_RESPONSE = {
  success: true,
  timestamp: 1711929600000,
  fileMetadata: { fileName: 'Design System', fileKey: 'abc123' },
  variables: [
    {
      id: 'VariableID:1:1',
      name: 'colors/primary',
      key: 'key1',
      resolvedType: 'COLOR',
      valuesByMode: { '1:0': { r: 0.65, g: 0.35, b: 1, a: 1 } },
      variableCollectionId: 'VariableCollectionID:1:0',
      scopes: ['ALL_FILLS'],
      codeSyntax: {},
      description: '',
      hiddenFromPublishing: false,
    },
    {
      id: 'VariableID:1:2',
      name: 'spacing/md',
      key: 'key2',
      resolvedType: 'FLOAT',
      valuesByMode: { '1:0': 16 },
      variableCollectionId: 'VariableCollectionID:1:0',
      scopes: ['GAP'],
      codeSyntax: {},
      description: '',
      hiddenFromPublishing: false,
    },
  ],
  variableCollections: [
    {
      id: 'VariableCollectionID:1:0',
      name: 'Tokens',
      key: 'colkey1',
      modes: [{ modeId: '1:0', name: 'Light' }],
      defaultModeId: '1:0',
      variableIds: ['VariableID:1:1', 'VariableID:1:2'],
    },
  ],
};

/** Real shape from connector.getLocalComponents() */
export const GET_LOCAL_COMPONENTS_RESPONSE = [
  {
    name: 'Button',
    key: 'comp1',
    type: 'COMPONENT',
    componentSetName: 'Button Set',
    componentProperties: { label: { type: 'TEXT', defaultValue: 'Click me' } },
  },
];

/** Real shape from connector.lintDesign() */
export const LINT_DESIGN_RESPONSE = {
  success: true,
  categories: { naming: [], spacing: [], colors: [] },
  summary: { total: 0, errors: 0, warnings: 0 },
};

/** Empty DS response (no variables, no collections) */
export const GET_VARIABLES_EMPTY_RESPONSE = {
  success: true,
  timestamp: 1711929600000,
  fileMetadata: { fileName: 'New File', fileKey: 'xyz789' },
  variables: [],
  variableCollections: [],
};
