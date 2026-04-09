// Figma Desktop Bridge - Bottega Plugin
// Bridges Figma plugin API to Bottega via WebSocket relay in the plugin UI window
// Supports: Variables, Components, Styles, and more
// Uses postMessage to communicate with UI, which relays commands over WebSocket

console.log('🌉 [Desktop Bridge] Plugin loaded and ready');

// Show minimal UI - compact status indicator
figma.showUI(__html__, { width: 140, height: 50, visible: true, themeColors: true });

// ============================================================================
// CONSOLE CAPTURE — Intercept console.* in the QuickJS sandbox and forward
// to ui.html via postMessage so the WebSocket bridge can relay them to the MCP
// server. This enables console monitoring without CDP.
// ============================================================================
(function() {
  var levels = ['log', 'info', 'warn', 'error', 'debug'];
  var originals = {};
  for (var i = 0; i < levels.length; i++) {
    originals[levels[i]] = console[levels[i]];
  }

  function safeSerialize(val) {
    if (val === null || val === undefined) return val;
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return val;
    try {
      // Attempt JSON round-trip for objects/arrays (catches circular refs)
      return JSON.parse(JSON.stringify(val));
    } catch (e) {
      return String(val);
    }
  }

  for (var i = 0; i < levels.length; i++) {
    (function(level) {
      console[level] = function() {
        // Call the original so output still appears in Figma DevTools
        originals[level].apply(console, arguments);

        // Serialize arguments safely
        var args = [];
        for (var j = 0; j < arguments.length; j++) {
          args.push(safeSerialize(arguments[j]));
        }

        // Build message text from all arguments
        var messageParts = [];
        for (var j = 0; j < arguments.length; j++) {
          messageParts.push(typeof arguments[j] === 'string' ? arguments[j] : String(arguments[j]));
        }

        figma.ui.postMessage({
          type: 'CONSOLE_CAPTURE',
          level: level,
          message: messageParts.join(' '),
          args: args,
          timestamp: Date.now()
        });
      };
    })(levels[i]);
  }
})();

// Immediately fetch and send variables data to UI
(async () => {
  try {
    console.log('🌉 [Desktop Bridge] Fetching variables...');

    // Get all local variables and collections
    const variables = await figma.variables.getLocalVariablesAsync();
    const collections = await figma.variables.getLocalVariableCollectionsAsync();

    console.log(`🌉 [Desktop Bridge] Found ${variables.length} variables in ${collections.length} collections`);

    // Format the data
    const variablesData = {
      success: true,
      timestamp: Date.now(),
      fileKey: figma.fileKey || null,
      variables: variables.map(v => ({
        id: v.id,
        name: v.name,
        key: v.key,
        resolvedType: v.resolvedType,
        valuesByMode: v.valuesByMode,
        variableCollectionId: v.variableCollectionId,
        scopes: v.scopes,
        codeSyntax: v.codeSyntax || {},
        description: v.description,
        hiddenFromPublishing: v.hiddenFromPublishing
      })),
      variableCollections: collections.map(c => ({
        id: c.id,
        name: c.name,
        key: c.key,
        modes: c.modes,
        defaultModeId: c.defaultModeId,
        variableIds: c.variableIds
      }))
    };

    // Send to UI via postMessage
    figma.ui.postMessage({
      type: 'VARIABLES_DATA',
      data: variablesData
    });

    console.log('🌉 [Desktop Bridge] Variables data sent to UI successfully');
    console.log('🌉 [Desktop Bridge] UI iframe now has variables data accessible via window.__figmaVariablesData');

  } catch (error) {
    console.error('🌉 [Desktop Bridge] Error fetching variables:', error);
    figma.ui.postMessage({
      type: 'ERROR',
      error: error.message || String(error)
    });
  }
})();

// Helper function to serialize a variable for response
function serializeVariable(v) {
  return {
    id: v.id,
    name: v.name,
    key: v.key,
    resolvedType: v.resolvedType,
    valuesByMode: v.valuesByMode,
    variableCollectionId: v.variableCollectionId,
    scopes: v.scopes,
    description: v.description,
    hiddenFromPublishing: v.hiddenFromPublishing
  };
}

// Helper function to serialize a collection for response
function serializeCollection(c) {
  return {
    id: c.id,
    name: c.name,
    key: c.key,
    modes: c.modes,
    defaultModeId: c.defaultModeId,
    variableIds: c.variableIds
  };
}

// Send progress update for long-running operations (resets WS timeout)
var BATCH_PROGRESS_INTERVAL = 5;

function sendProgress(requestId, percent, message, itemsProcessed, totalItems) {
  figma.ui.postMessage({
    type: 'OPERATION_PROGRESS',
    requestId: requestId,
    percent: percent,
    message: message,
    itemsProcessed: itemsProcessed,
    totalItems: totalItems,
    timestamp: Date.now()
  });
}

// Run a batch operation: loop, try/catch per item, progress every BATCH_PROGRESS_INTERVAL, yield to event loop
function runBatch(requestId, updates, resultType, verb, processFn) {
  (async () => {
    if (!updates || updates.length === 0) {
      figma.ui.postMessage({ type: resultType, requestId: requestId, success: true, data: { updated: 0, total: 0, results: [] } });
      return;
    }
    var results = [];
    var total = updates.length;
    for (var i = 0; i < total; i++) {
      try {
        await processFn(updates[i]);
        results.push({ nodeId: updates[i].nodeId, success: true });
      } catch (e) {
        results.push({ nodeId: updates[i].nodeId, success: false, error: e.message });
      }
      if ((i + 1) % BATCH_PROGRESS_INTERVAL === 0 || i === total - 1) {
        sendProgress(requestId, Math.round(((i + 1) / total) * 100), 'Updated ' + (i + 1) + '/' + total + ' ' + verb, i + 1, total);
      }
      if ((i + 1) % BATCH_PROGRESS_INTERVAL === 0 && i < total - 1) {
        await new Promise(function(r) { setTimeout(r, 0); });
      }
    }
    figma.ui.postMessage({ type: resultType, requestId: requestId, success: true, data: { updated: results.filter(function(r) { return r.success; }).length, total: total, results: results } });
  })();
}

// Helper to convert hex color to Figma RGB (0-1 range)
function hexToFigmaRGB(hex) {
  // Remove # if present
  hex = hex.replace(/^#/, '');

  // Validate hex characters BEFORE parsing (prevents NaN values)
  if (!/^[0-9A-Fa-f]+$/.test(hex)) {
    throw new Error('Invalid hex color: "' + hex + '" contains non-hex characters. Use only 0-9 and A-F.');
  }

  // Parse hex values
  var r, g, b, a = 1;

  if (hex.length === 3) {
    // #RGB format
    r = parseInt(hex[0] + hex[0], 16) / 255;
    g = parseInt(hex[1] + hex[1], 16) / 255;
    b = parseInt(hex[2] + hex[2], 16) / 255;
  } else if (hex.length === 4) {
    // #RGBA format (CSS4 shorthand)
    r = parseInt(hex[0] + hex[0], 16) / 255;
    g = parseInt(hex[1] + hex[1], 16) / 255;
    b = parseInt(hex[2] + hex[2], 16) / 255;
    a = parseInt(hex[3] + hex[3], 16) / 255;
  } else if (hex.length === 6) {
    // #RRGGBB format
    r = parseInt(hex.substring(0, 2), 16) / 255;
    g = parseInt(hex.substring(2, 4), 16) / 255;
    b = parseInt(hex.substring(4, 6), 16) / 255;
  } else if (hex.length === 8) {
    // #RRGGBBAA format
    r = parseInt(hex.substring(0, 2), 16) / 255;
    g = parseInt(hex.substring(2, 4), 16) / 255;
    b = parseInt(hex.substring(4, 6), 16) / 255;
    a = parseInt(hex.substring(6, 8), 16) / 255;
  } else {
    throw new Error('Invalid hex color format: "' + hex + '". Expected 3, 4, 6, or 8 hex characters (e.g., #RGB, #RGBA, #RRGGBB, #RRGGBBAA).');
  }

  return { r: r, g: g, b: b, a: a };
}

// ============================================================================
// JSX RENDER HELPERS - Used by CREATE_FROM_JSX handler
// ============================================================================

function parseColor(color) {
  if (!color) return null;
  if (typeof color === 'string' && color.startsWith('#')) return hexToFigmaRGB(color);
  if (typeof color === 'object' && 'r' in color) return color;
  return hexToFigmaRGB('#000000');
}

const TYPE_MAP = {
  frame: 'FRAME', view: 'FRAME', rectangle: 'RECTANGLE', rect: 'RECTANGLE',
  ellipse: 'ELLIPSE', text: 'TEXT', line: 'LINE', svg: 'SVG', image: 'IMAGE'
};

function expandShorthand(props, node) {
  if (!props) return;

  if (props.name !== undefined) node.name = String(props.name);
  if (props.opacity !== undefined && 'opacity' in node) node.opacity = props.opacity;

  // Background fill
  if (props.bg !== undefined && 'fills' in node) {
    var bgColor = parseColor(props.bg);
    if (bgColor) {
      node.fills = [{ type: 'SOLID', color: { r: bgColor.r, g: bgColor.g, b: bgColor.b }, opacity: bgColor.a !== undefined ? bgColor.a : 1 }];
    }
  }

  // Padding
  if ('p' in props && 'paddingTop' in node) {
    node.paddingTop = props.p;
    node.paddingRight = props.p;
    node.paddingBottom = props.p;
    node.paddingLeft = props.p;
  }
  if ('px' in props && 'paddingLeft' in node) {
    node.paddingLeft = props.px;
    node.paddingRight = props.px;
  }
  if ('py' in props && 'paddingTop' in node) {
    node.paddingTop = props.py;
    node.paddingBottom = props.py;
  }
  if ('pt' in props && 'paddingTop' in node) node.paddingTop = props.pt;
  if ('pr' in props && 'paddingRight' in node) node.paddingRight = props.pr;
  if ('pb' in props && 'paddingBottom' in node) node.paddingBottom = props.pb;
  if ('pl' in props && 'paddingLeft' in node) node.paddingLeft = props.pl;

  // Corner radius
  if (props.rounded !== undefined && 'cornerRadius' in node) node.cornerRadius = props.rounded;

  // Layout (flex)
  if (props.flex !== undefined && 'layoutMode' in node) {
    if (props.flex === 'row') {
      node.layoutMode = 'HORIZONTAL';
    } else if (props.flex === 'col') {
      node.layoutMode = 'VERTICAL';
    }
    node.primaryAxisSizingMode = 'AUTO';
    node.counterAxisSizingMode = 'AUTO';
  }

  // Gap / item spacing
  if (props.gap !== undefined && 'itemSpacing' in node) node.itemSpacing = props.gap;

  // Justify (primary axis alignment)
  if (props.justify !== undefined && 'primaryAxisAlignItems' in node) {
    var justifyMap = { start: 'MIN', center: 'CENTER', end: 'MAX', between: 'SPACE_BETWEEN' };
    node.primaryAxisAlignItems = justifyMap[props.justify] || 'MIN';
  }

  // Items (counter axis alignment)
  if (props.items !== undefined && 'counterAxisAlignItems' in node) {
    var itemsMap = { start: 'MIN', center: 'CENTER', end: 'MAX' };
    node.counterAxisAlignItems = itemsMap[props.items] || 'MIN';
  }

  // Width / height
  if (props.w !== undefined && 'resize' in node) {
    var curH = props.h !== undefined ? props.h : node.height;
    node.resize(props.w, curH || 1);
    if ('layoutSizingHorizontal' in node) node.layoutSizingHorizontal = 'FIXED';
  }
  if (props.h !== undefined && 'resize' in node) {
    var curW = props.w !== undefined ? props.w : node.width;
    node.resize(curW || 1, props.h);
    if ('layoutSizingVertical' in node) node.layoutSizingVertical = 'FIXED';
  }

  // Grow
  if (props.grow !== undefined && 'layoutGrow' in node) {
    node.layoutGrow = 1;
    if ('layoutSizingHorizontal' in node) node.layoutSizingHorizontal = 'FILL';
  }

  // Stroke
  if (props.stroke !== undefined && 'strokes' in node) {
    var strokeColor = parseColor(props.stroke);
    if (strokeColor) {
      node.strokes = [{ type: 'SOLID', color: { r: strokeColor.r, g: strokeColor.g, b: strokeColor.b } }];
    }
  }

  // Shadow / drop shadow effect
  if (props.shadow !== undefined && 'effects' in node) {
    node.effects = [{
      type: 'DROP_SHADOW',
      color: { r: 0, g: 0, b: 0, a: 0.25 },
      offset: { x: 0, y: 2 },
      radius: 4,
      spread: 0,
      visible: true,
      blendMode: 'NORMAL'
    }];
  }
}

async function createNodeFromTree(treeNode, parent) {
  var nodeType = TYPE_MAP[treeNode.type] || TYPE_MAP[(treeNode.type || '').toLowerCase()] || 'FRAME';
  var props = treeNode.props || {};
  var node;

  if (nodeType === 'SVG' && props.svg) {
    node = figma.createNodeFromSvg(props.svg);
  } else if (nodeType === 'TEXT') {
    await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
    node = figma.createText();
    var textContent = props.text || '';
    if (treeNode.children && treeNode.children.length > 0) {
      for (var ci = 0; ci < treeNode.children.length; ci++) {
        if (typeof treeNode.children[ci] === 'string') {
          textContent += treeNode.children[ci];
        }
      }
    }
    node.characters = textContent;
    if (props.fontSize) node.fontSize = props.fontSize;
    if (props.color) {
      var textColor = parseColor(props.color);
      if (textColor) node.fills = [{ type: 'SOLID', color: { r: textColor.r, g: textColor.g, b: textColor.b } }];
    }
  } else if (nodeType === 'RECTANGLE') {
    node = figma.createRectangle();
  } else if (nodeType === 'ELLIPSE') {
    node = figma.createEllipse();
  } else if (nodeType === 'LINE') {
    node = figma.createLine();
  } else {
    // FRAME (default)
    node = figma.createFrame();
    node.clipsContent = false;
  }

  // Apply shorthand props
  expandShorthand(props, node);

  // Append to parent
  if (parent && 'appendChild' in parent) {
    parent.appendChild(node);
  }

  // Recurse children (skip for text and SVG nodes)
  if (nodeType !== 'TEXT' && nodeType !== 'SVG' && treeNode.children) {
    for (var ri = 0; ri < treeNode.children.length; ri++) {
      var child = treeNode.children[ri];
      if (child && typeof child === 'object' && child.type) {
        await createNodeFromTree(child, node);
      }
    }
  }

  return node;
}

// Convert Figma 0-1 RGB color to #RRGGBB hex string
function figmaRGBToHex(c) {
  return '#' + Math.round(c.r * 255).toString(16).padStart(2, '0')
             + Math.round(c.g * 255).toString(16).padStart(2, '0')
             + Math.round(c.b * 255).toString(16).padStart(2, '0');
}

// Build a variable name lookup map from all local variables and collections.
// Used by DEEP_GET_COMPONENT and ANALYZE_COMPONENT_SET.
async function buildVarNameMap() {
  var map = {};
  try {
    var results = await Promise.all([
      figma.variables.getLocalVariablesAsync(),
      figma.variables.getLocalVariableCollectionsAsync()
    ]);
    var allVars = results[0];
    var allCollections = results[1];
    var collectionMap = {};
    for (var ci = 0; ci < allCollections.length; ci++) {
      collectionMap[allCollections[ci].id] = allCollections[ci].name;
    }
    for (var vi = 0; vi < allVars.length; vi++) {
      var v = allVars[vi];
      map[v.id] = {
        name: v.name,
        resolvedType: v.resolvedType,
        collection: collectionMap[v.variableCollectionId] || null,
        scopes: v.scopes || [],
        codeSyntax: v.codeSyntax || {}
      };
    }
  } catch (e) {
    console.log('🌉 [Desktop Bridge] Could not build variable map: ' + (e.message || e));
  }
  return map;
}

// Listen for requests from UI (e.g., component data requests, write operations)
figma.ui.onmessage = async (msg) => {

  // ============================================================================
  // EXECUTE_CODE - Arbitrary code execution (Power Tool)
  // ============================================================================
  if (msg.type === 'EXECUTE_CODE') {
    try {
      console.log('🌉 [Desktop Bridge] Executing code, length:', msg.code.length);

      // Use eval with async IIFE wrapper instead of AsyncFunction constructor
      // AsyncFunction is restricted in Figma's plugin sandbox, but eval works
      // See: https://developers.figma.com/docs/plugins/resource-links

      // Wrap user code in an async IIFE that returns a Promise
      // This allows async/await in user code while using eval
      var wrappedCode = "(async function() {\n" + msg.code + "\n})()";

      console.log('🌉 [Desktop Bridge] Wrapped code for eval');

      // Execute with timeout
      var timeoutMs = msg.timeout || 5000;
      var timeoutPromise = new Promise(function(_, reject) {
        setTimeout(function() {
          reject(new Error('Execution timed out after ' + timeoutMs + 'ms'));
        }, timeoutMs);
      });

      var codePromise;
      try {
        // eval returns the Promise from the async IIFE
        codePromise = eval(wrappedCode);
      } catch (syntaxError) {
        // Log the actual syntax error message
        var syntaxErrorMsg = syntaxError && syntaxError.message ? syntaxError.message : String(syntaxError);
        console.error('🌉 [Desktop Bridge] Syntax error in code:', syntaxErrorMsg);
        figma.ui.postMessage({
          type: 'EXECUTE_CODE_RESULT',
          requestId: msg.requestId,
          success: false,
          error: 'Syntax error: ' + syntaxErrorMsg
        });
        return;
      }

      var result = await Promise.race([
        codePromise,
        timeoutPromise
      ]);

      console.log('🌉 [Desktop Bridge] Code executed successfully, result type:', typeof result);

      // Analyze result for potential silent failures
      var resultAnalysis = {
        type: typeof result,
        isNull: result === null,
        isUndefined: result === undefined,
        isEmpty: false,
        warning: null
      };

      // Check for empty results that might indicate a failed search/operation
      if (Array.isArray(result)) {
        resultAnalysis.isEmpty = result.length === 0;
        if (resultAnalysis.isEmpty) {
          resultAnalysis.warning = 'Code returned an empty array. If you were searching for nodes, none were found.';
        }
      } else if (result !== null && typeof result === 'object') {
        var keys = Object.keys(result);
        resultAnalysis.isEmpty = keys.length === 0;
        if (resultAnalysis.isEmpty) {
          resultAnalysis.warning = 'Code returned an empty object. The operation may not have found what it was looking for.';
        }
        // Check for common "found nothing" patterns
        if (result.length === 0 || result.count === 0 || result.foundCount === 0 || (result.nodes && result.nodes.length === 0)) {
          resultAnalysis.warning = 'Code returned a result indicating nothing was found (count/length is 0).';
        }
      } else if (result === null) {
        resultAnalysis.warning = 'Code returned null. The requested node or resource may not exist.';
      } else if (result === undefined) {
        resultAnalysis.warning = 'Code returned undefined. Make sure your code has a return statement.';
      }

      if (resultAnalysis.warning) {
        console.warn('🌉 [Desktop Bridge] ⚠️ Result warning:', resultAnalysis.warning);
      }

      figma.ui.postMessage({
        type: 'EXECUTE_CODE_RESULT',
        requestId: msg.requestId,
        success: true,
        result: result,
        resultAnalysis: resultAnalysis,
        // Include file context so users know which file this executed against
        fileContext: {
          fileName: figma.root.name,
          fileKey: figma.fileKey || null
        }
      });

    } catch (error) {
      // Extract error message explicitly - don't rely on console.error serialization
      var errorName = error && error.name ? error.name : 'Error';
      var errorMsg = error && error.message ? error.message : String(error);
      var errorStack = error && error.stack ? error.stack : '';

      // Log error details as strings for reliable console output
      console.error('🌉 [Desktop Bridge] Code execution error: [' + errorName + '] ' + errorMsg);
      if (errorStack) {
        console.error('🌉 [Desktop Bridge] Stack:', errorStack);
      }

      figma.ui.postMessage({
        type: 'EXECUTE_CODE_RESULT',
        requestId: msg.requestId,
        success: false,
        error: errorName + ': ' + errorMsg
      });
    }
  }

  // ============================================================================
  // UPDATE_VARIABLE - Update a variable's value in a specific mode
  // ============================================================================
  else if (msg.type === 'UPDATE_VARIABLE') {
    try {
      console.log('🌉 [Desktop Bridge] Updating variable:', msg.variableId);

      var variable = await figma.variables.getVariableByIdAsync(msg.variableId);
      if (!variable) {
        throw new Error('Variable not found: ' + msg.variableId);
      }

      // Convert value based on variable type
      var value = msg.value;

      // Check if value is a variable alias (string starting with "VariableID:")
      if (typeof value === 'string' && value.startsWith('VariableID:')) {
        // Convert to VARIABLE_ALIAS format
        value = {
          type: 'VARIABLE_ALIAS',
          id: value
        };
        console.log('🌉 [Desktop Bridge] Converting to variable alias:', value.id);
      } else if (variable.resolvedType === 'COLOR' && typeof value === 'string') {
        // Convert hex string to Figma color
        value = hexToFigmaRGB(value);
      }

      // Set the value for the specified mode
      variable.setValueForMode(msg.modeId, value);

      console.log('🌉 [Desktop Bridge] Variable updated successfully');

      figma.ui.postMessage({
        type: 'UPDATE_VARIABLE_RESULT',
        requestId: msg.requestId,
        success: true,
        variable: serializeVariable(variable)
      });

    } catch (error) {
      console.error('🌉 [Desktop Bridge] Update variable error:', error);
      figma.ui.postMessage({
        type: 'UPDATE_VARIABLE_RESULT',
        requestId: msg.requestId,
        success: false,
        error: error.message || String(error)
      });
    }
  }

  // ============================================================================
  // CREATE_VARIABLE - Create a new variable in a collection
  // ============================================================================
  else if (msg.type === 'CREATE_VARIABLE') {
    try {
      console.log('🌉 [Desktop Bridge] Creating variable:', msg.name);

      // Get the collection
      var collection = await figma.variables.getVariableCollectionByIdAsync(msg.collectionId);
      if (!collection) {
        throw new Error('Collection not found: ' + msg.collectionId);
      }

      // Create the variable
      var variable = figma.variables.createVariable(msg.name, collection, msg.resolvedType);

      // Set initial values if provided
      if (msg.valuesByMode) {
        for (var modeId in msg.valuesByMode) {
          var value = msg.valuesByMode[modeId];
          // Convert hex colors
          if (msg.resolvedType === 'COLOR' && typeof value === 'string') {
            value = hexToFigmaRGB(value);
          }
          variable.setValueForMode(modeId, value);
        }
      }

      // Set description if provided
      if (msg.description) {
        variable.description = msg.description;
      }

      // Set scopes if provided
      if (msg.scopes) {
        variable.scopes = msg.scopes;
      }

      console.log('🌉 [Desktop Bridge] Variable created:', variable.id);

      figma.ui.postMessage({
        type: 'CREATE_VARIABLE_RESULT',
        requestId: msg.requestId,
        success: true,
        variable: serializeVariable(variable)
      });

    } catch (error) {
      console.error('🌉 [Desktop Bridge] Create variable error:', error);
      figma.ui.postMessage({
        type: 'CREATE_VARIABLE_RESULT',
        requestId: msg.requestId,
        success: false,
        error: error.message || String(error)
      });
    }
  }

  // ============================================================================
  // CREATE_VARIABLE_COLLECTION - Create a new variable collection
  // ============================================================================
  else if (msg.type === 'CREATE_VARIABLE_COLLECTION') {
    try {
      console.log('🌉 [Desktop Bridge] Creating collection:', msg.name);

      // Create the collection
      var collection = figma.variables.createVariableCollection(msg.name);

      // Rename the default mode if a name is provided
      if (msg.initialModeName && collection.modes.length > 0) {
        collection.renameMode(collection.modes[0].modeId, msg.initialModeName);
      }

      // Add additional modes if provided
      if (msg.additionalModes && msg.additionalModes.length > 0) {
        for (var i = 0; i < msg.additionalModes.length; i++) {
          collection.addMode(msg.additionalModes[i]);
        }
      }

      console.log('🌉 [Desktop Bridge] Collection created:', collection.id);

      figma.ui.postMessage({
        type: 'CREATE_VARIABLE_COLLECTION_RESULT',
        requestId: msg.requestId,
        success: true,
        collection: serializeCollection(collection)
      });

    } catch (error) {
      console.error('🌉 [Desktop Bridge] Create collection error:', error);
      figma.ui.postMessage({
        type: 'CREATE_VARIABLE_COLLECTION_RESULT',
        requestId: msg.requestId,
        success: false,
        error: error.message || String(error)
      });
    }
  }

  // ============================================================================
  // DELETE_VARIABLE - Delete a variable
  // ============================================================================
  else if (msg.type === 'DELETE_VARIABLE') {
    try {
      console.log('🌉 [Desktop Bridge] Deleting variable:', msg.variableId);

      var variable = await figma.variables.getVariableByIdAsync(msg.variableId);
      if (!variable) {
        throw new Error('Variable not found: ' + msg.variableId);
      }

      var deletedInfo = {
        id: variable.id,
        name: variable.name
      };

      variable.remove();

      console.log('🌉 [Desktop Bridge] Variable deleted');

      figma.ui.postMessage({
        type: 'DELETE_VARIABLE_RESULT',
        requestId: msg.requestId,
        success: true,
        deleted: deletedInfo
      });

    } catch (error) {
      console.error('🌉 [Desktop Bridge] Delete variable error:', error);
      figma.ui.postMessage({
        type: 'DELETE_VARIABLE_RESULT',
        requestId: msg.requestId,
        success: false,
        error: error.message || String(error)
      });
    }
  }

  // ============================================================================
  // DELETE_VARIABLE_COLLECTION - Delete a variable collection
  // ============================================================================
  else if (msg.type === 'DELETE_VARIABLE_COLLECTION') {
    try {
      console.log('🌉 [Desktop Bridge] Deleting collection:', msg.collectionId);

      var collection = await figma.variables.getVariableCollectionByIdAsync(msg.collectionId);
      if (!collection) {
        throw new Error('Collection not found: ' + msg.collectionId);
      }

      var deletedInfo = {
        id: collection.id,
        name: collection.name,
        variableCount: collection.variableIds.length
      };

      collection.remove();

      console.log('🌉 [Desktop Bridge] Collection deleted');

      figma.ui.postMessage({
        type: 'DELETE_VARIABLE_COLLECTION_RESULT',
        requestId: msg.requestId,
        success: true,
        deleted: deletedInfo
      });

    } catch (error) {
      console.error('🌉 [Desktop Bridge] Delete collection error:', error);
      figma.ui.postMessage({
        type: 'DELETE_VARIABLE_COLLECTION_RESULT',
        requestId: msg.requestId,
        success: false,
        error: error.message || String(error)
      });
    }
  }

  // ============================================================================
  // RENAME_VARIABLE - Rename a variable
  // ============================================================================
  else if (msg.type === 'RENAME_VARIABLE') {
    try {
      console.log('🌉 [Desktop Bridge] Renaming variable:', msg.variableId, 'to', msg.newName);

      var variable = await figma.variables.getVariableByIdAsync(msg.variableId);
      if (!variable) {
        throw new Error('Variable not found: ' + msg.variableId);
      }

      var oldName = variable.name;
      variable.name = msg.newName;

      console.log('🌉 [Desktop Bridge] Variable renamed from "' + oldName + '" to "' + msg.newName + '"');

      var serializedVar = serializeVariable(variable);
      serializedVar.oldName = oldName;
      figma.ui.postMessage({
        type: 'RENAME_VARIABLE_RESULT',
        requestId: msg.requestId,
        success: true,
        variable: serializedVar,
        oldName: oldName
      });

    } catch (error) {
      console.error('🌉 [Desktop Bridge] Rename variable error:', error);
      figma.ui.postMessage({
        type: 'RENAME_VARIABLE_RESULT',
        requestId: msg.requestId,
        success: false,
        error: error.message || String(error)
      });
    }
  }

  // ============================================================================
  // SET_VARIABLE_DESCRIPTION - Set description on a variable
  // ============================================================================
  else if (msg.type === 'SET_VARIABLE_DESCRIPTION') {
    try {
      console.log('🌉 [Desktop Bridge] Setting description on variable:', msg.variableId);

      var variable = await figma.variables.getVariableByIdAsync(msg.variableId);
      if (!variable) {
        throw new Error('Variable not found: ' + msg.variableId);
      }

      variable.description = msg.description || '';

      console.log('🌉 [Desktop Bridge] Variable description set successfully');

      figma.ui.postMessage({
        type: 'SET_VARIABLE_DESCRIPTION_RESULT',
        requestId: msg.requestId,
        success: true,
        variable: serializeVariable(variable)
      });

    } catch (error) {
      var errorMsg = error && error.message ? error.message : String(error);
      console.error('🌉 [Desktop Bridge] Set variable description error:', errorMsg);
      figma.ui.postMessage({
        type: 'SET_VARIABLE_DESCRIPTION_RESULT',
        requestId: msg.requestId,
        success: false,
        error: errorMsg
      });
    }
  }

  // ============================================================================
  // ADD_MODE - Add a mode to a variable collection
  // ============================================================================
  else if (msg.type === 'ADD_MODE') {
    try {
      console.log('🌉 [Desktop Bridge] Adding mode to collection:', msg.collectionId);

      var collection = await figma.variables.getVariableCollectionByIdAsync(msg.collectionId);
      if (!collection) {
        throw new Error('Collection not found: ' + msg.collectionId);
      }

      // Add the mode (returns the new mode ID)
      var newModeId = collection.addMode(msg.modeName);

      console.log('🌉 [Desktop Bridge] Mode "' + msg.modeName + '" added with ID:', newModeId);

      figma.ui.postMessage({
        type: 'ADD_MODE_RESULT',
        requestId: msg.requestId,
        success: true,
        collection: serializeCollection(collection),
        newMode: {
          modeId: newModeId,
          name: msg.modeName
        }
      });

    } catch (error) {
      console.error('🌉 [Desktop Bridge] Add mode error:', error);
      figma.ui.postMessage({
        type: 'ADD_MODE_RESULT',
        requestId: msg.requestId,
        success: false,
        error: error.message || String(error)
      });
    }
  }

  // ============================================================================
  // RENAME_MODE - Rename a mode in a variable collection
  // ============================================================================
  else if (msg.type === 'RENAME_MODE') {
    try {
      console.log('🌉 [Desktop Bridge] Renaming mode:', msg.modeId, 'in collection:', msg.collectionId);

      var collection = await figma.variables.getVariableCollectionByIdAsync(msg.collectionId);
      if (!collection) {
        throw new Error('Collection not found: ' + msg.collectionId);
      }

      // Find the current mode name
      var currentMode = collection.modes.find(function(m) { return m.modeId === msg.modeId; });
      if (!currentMode) {
        throw new Error('Mode not found: ' + msg.modeId);
      }

      var oldName = currentMode.name;
      collection.renameMode(msg.modeId, msg.newName);

      console.log('🌉 [Desktop Bridge] Mode renamed from "' + oldName + '" to "' + msg.newName + '"');

      var serializedCol = serializeCollection(collection);
      serializedCol.oldName = oldName;
      figma.ui.postMessage({
        type: 'RENAME_MODE_RESULT',
        requestId: msg.requestId,
        success: true,
        collection: serializedCol,
        oldName: oldName
      });

    } catch (error) {
      console.error('🌉 [Desktop Bridge] Rename mode error:', error);
      figma.ui.postMessage({
        type: 'RENAME_MODE_RESULT',
        requestId: msg.requestId,
        success: false,
        error: error.message || String(error)
      });
    }
  }

  // ============================================================================
  // REFRESH_VARIABLES - Re-fetch and send all variables data
  // ============================================================================
  else if (msg.type === 'REFRESH_VARIABLES') {
    try {
      console.log('🌉 [Desktop Bridge] Refreshing variables data...');

      var variables = await figma.variables.getLocalVariablesAsync();
      var collections = await figma.variables.getLocalVariableCollectionsAsync();

      var variablesData = {
        success: true,
        timestamp: Date.now(),
        fileKey: figma.fileKey || null,
        variables: variables.map(serializeVariable),
        variableCollections: collections.map(serializeCollection)
      };

      // Update the UI's cached data
      figma.ui.postMessage({
        type: 'VARIABLES_DATA',
        data: variablesData
      });

      // Also send as a response to the request
      figma.ui.postMessage({
        type: 'REFRESH_VARIABLES_RESULT',
        requestId: msg.requestId,
        success: true,
        data: variablesData
      });

      console.log('🌉 [Desktop Bridge] Variables refreshed:', variables.length, 'variables in', collections.length, 'collections');

    } catch (error) {
      console.error('🌉 [Desktop Bridge] Refresh variables error:', error);
      figma.ui.postMessage({
        type: 'REFRESH_VARIABLES_RESULT',
        requestId: msg.requestId,
        success: false,
        error: error.message || String(error)
      });
    }
  }

  // ============================================================================
  // GET_COMPONENT - Existing read operation
  // ============================================================================
  else if (msg.type === 'GET_COMPONENT') {
    try {
      console.log(`🌉 [Desktop Bridge] Fetching component: ${msg.nodeId}`);

      const node = await figma.getNodeByIdAsync(msg.nodeId);

      if (!node) {
        throw new Error(`Node not found: ${msg.nodeId}`);
      }

      if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET' && node.type !== 'INSTANCE') {
        throw new Error(`Node is not a component. Type: ${node.type}`);
      }

      // Detect if this is a variant (COMPONENT inside a COMPONENT_SET)
      // Note: Can't use optional chaining (?.) - Figma plugin sandbox doesn't support it
      const isVariant = node.type === 'COMPONENT' && node.parent && node.parent.type === 'COMPONENT_SET';

      // Extract component data including description fields and annotations
      const componentData = {
        success: true,
        timestamp: Date.now(),
        nodeId: msg.nodeId,
        component: {
          id: node.id,
          name: node.name,
          type: node.type,
          // Variants CAN have their own description
          description: node.description || null,
          descriptionMarkdown: node.descriptionMarkdown || null,
          visible: node.visible,
          locked: node.locked,
          // Dev Mode annotations
          annotations: node.annotations || [],
          // Flag to indicate if this is a variant
          isVariant: isVariant,
          // For component sets and non-variant components only (variants cannot access this)
          componentPropertyDefinitions: (node.type === 'COMPONENT_SET' || (node.type === 'COMPONENT' && !isVariant))
            ? node.componentPropertyDefinitions
            : undefined,
          // Get children info (lightweight) — skip unresolvable slot sublayers
          children: node.children ? node.children.reduce((acc, child) => {
            try {
              acc.push({ id: child.id, name: child.name, type: child.type });
            } catch (e) { /* slot sublayer or table cell — skip */ }
            return acc;
          }, []) : undefined
        }
      };

      console.log(`🌉 [Desktop Bridge] Component data ready. Has description: ${!!componentData.component.description}, annotations: ${componentData.component.annotations.length}`);

      // Send to UI
      figma.ui.postMessage({
        type: 'COMPONENT_DATA',
        requestId: msg.requestId, // Echo back the request ID
        data: componentData
      });

    } catch (error) {
      console.error(`🌉 [Desktop Bridge] Error fetching component:`, error);
      figma.ui.postMessage({
        type: 'COMPONENT_ERROR',
        requestId: msg.requestId,
        error: error.message || String(error)
      });
    }
  }

  // ============================================================================
  // GET_LOCAL_COMPONENTS - Get all local components for design system manifest
  // ============================================================================
  else if (msg.type === 'GET_LOCAL_COMPONENTS') {
    try {
      console.log('🌉 [Desktop Bridge] Fetching all local components for manifest...');

      // Find all component sets and standalone components in the file
      var components = [];
      var componentSets = [];

      // Helper to extract component data
      function extractComponentData(node, isPartOfSet) {
        var data = {
          key: node.key,
          nodeId: node.id,
          name: node.name,
          type: node.type,
          description: node.description || null,
          width: node.width,
          height: node.height
        };

        // Get property definitions for non-variant components
        if (!isPartOfSet && node.componentPropertyDefinitions) {
          data.properties = [];
          var propDefs = node.componentPropertyDefinitions;
          for (var propName in propDefs) {
            if (propDefs.hasOwnProperty(propName)) {
              var propDef = propDefs[propName];
              data.properties.push({
                name: propName,
                type: propDef.type,
                defaultValue: propDef.defaultValue
              });
            }
          }
        }

        return data;
      }

      // Helper to extract component set data with all variants
      function extractComponentSetData(node) {
        var variantAxes = {};
        var variants = [];

        // Parse variant properties from children names — skip unresolvable slot sublayers
        if (node.children) {
          node.children.forEach(function(child) {
            try {
              if (child.type === 'COMPONENT') {
                // Parse variant name (e.g., "Size=md, State=default")
                var variantProps = {};
                var parts = child.name.split(',').map(function(p) { return p.trim(); });
                parts.forEach(function(part) {
                  var kv = part.split('=');
                  if (kv.length === 2) {
                    var key = kv[0].trim();
                    var value = kv[1].trim();
                    variantProps[key] = value;

                    // Track all values for each axis
                    if (!variantAxes[key]) {
                      variantAxes[key] = [];
                    }
                    if (variantAxes[key].indexOf(value) === -1) {
                      variantAxes[key].push(value);
                    }
                  }
                });

                variants.push({
                  key: child.key,
                  nodeId: child.id,
                  name: child.name,
                  description: child.description || null,
                  variantProperties: variantProps,
                  width: child.width,
                  height: child.height
                });
              }
            } catch (e) { /* slot sublayer — skip */ }
          });
        }

        // Convert variantAxes object to array format
        var axes = [];
        for (var axisName in variantAxes) {
          if (variantAxes.hasOwnProperty(axisName)) {
            axes.push({
              name: axisName,
              values: variantAxes[axisName]
            });
          }
        }

        return {
          key: node.key,
          nodeId: node.id,
          name: node.name,
          type: 'COMPONENT_SET',
          description: node.description || null,
          variantAxes: axes,
          variants: variants,
          defaultVariant: variants.length > 0 ? variants[0] : null,
          properties: node.componentPropertyDefinitions ? Object.keys(node.componentPropertyDefinitions).map(function(propName) {
            var propDef = node.componentPropertyDefinitions[propName];
            return {
              name: propName,
              type: propDef.type,
              defaultValue: propDef.defaultValue
            };
          }) : []
        };
      }

      // Recursively search for components
      function findComponents(node) {
        if (!node) return;

        if (node.type === 'COMPONENT_SET') {
          componentSets.push(extractComponentSetData(node));
        } else if (node.type === 'COMPONENT') {
          // Only add standalone components (not variants inside component sets)
          if (!node.parent || node.parent.type !== 'COMPONENT_SET') {
            components.push(extractComponentData(node, false));
          }
        }

        // Recurse into children — skip unresolvable slot sublayers
        if (node.children) {
          node.children.forEach(function(child) {
            try { findComponents(child); } catch (e) { /* slot sublayer — skip */ }
          });
        }
      }

      // Load all pages first (required before accessing children)
      console.log('🌉 [Desktop Bridge] Loading all pages...');
      await figma.loadAllPagesAsync();

      // Process pages in batches with event loop yields to prevent UI freeze
      // This is critical for large design systems that could otherwise crash
      var pages = figma.root.children;
      var PAGE_BATCH_SIZE = 3;  // Process 3 pages at a time
      var totalPages = pages.length;

      console.log('🌉 [Desktop Bridge] Processing ' + totalPages + ' pages in batches of ' + PAGE_BATCH_SIZE + '...');

      for (var pageIndex = 0; pageIndex < totalPages; pageIndex += PAGE_BATCH_SIZE) {
        var batchEnd = Math.min(pageIndex + PAGE_BATCH_SIZE, totalPages);
        var batchPages = [];
        for (var j = pageIndex; j < batchEnd; j++) {
          batchPages.push(pages[j]);
        }

        // Process this batch of pages
        batchPages.forEach(function(page) {
          findComponents(page);
        });

        // Log progress for large files
        if (totalPages > PAGE_BATCH_SIZE) {
          console.log('🌉 [Desktop Bridge] Processed pages ' + (pageIndex + 1) + '-' + batchEnd + ' of ' + totalPages + ' (found ' + components.length + ' components so far)');
        }

        // Yield to event loop between batches to prevent UI freeze and allow cancellation
        if (batchEnd < totalPages) {
          await new Promise(function(resolve) { setTimeout(resolve, 0); });
        }
      }

      console.log('🌉 [Desktop Bridge] Found ' + components.length + ' components and ' + componentSets.length + ' component sets');

      figma.ui.postMessage({
        type: 'GET_LOCAL_COMPONENTS_RESULT',
        requestId: msg.requestId,
        success: true,
        data: {
          components: components,
          componentSets: componentSets,
          totalComponents: components.length,
          totalComponentSets: componentSets.length,
          // Include file metadata for context verification
          fileName: figma.root.name,
          fileKey: figma.fileKey || null,
          timestamp: Date.now()
        }
      });

    } catch (error) {
      var errorMsg = error && error.message ? error.message : String(error);
      console.error('🌉 [Desktop Bridge] Get local components error:', errorMsg);
      figma.ui.postMessage({
        type: 'GET_LOCAL_COMPONENTS_RESULT',
        requestId: msg.requestId,
        success: false,
        error: errorMsg
      });
    }
  }

  // ============================================================================
  // INSTANTIATE_COMPONENT - Create a component instance with overrides
  // ============================================================================
  else if (msg.type === 'INSTANTIATE_COMPONENT') {
    try {
      console.log('🌉 [Desktop Bridge] Instantiating component:', msg.componentKey || msg.nodeId);

      var component = null;
      var instance = null;

      // Try published library first (by key), then fall back to local component (by nodeId)
      if (msg.componentKey) {
        try {
          component = await figma.importComponentByKeyAsync(msg.componentKey);
        } catch (importError) {
          console.log('🌉 [Desktop Bridge] Not a published component, trying local...');
        }
      }

      // Fall back to local component by nodeId
      if (!component && msg.nodeId) {
        var node = await figma.getNodeByIdAsync(msg.nodeId);
        if (node) {
          if (node.type === 'COMPONENT') {
            component = node;
          } else if (node.type === 'COMPONENT_SET') {
            // For component sets, find the right variant or use default
            if (msg.variant && node.children && node.children.length > 0) {
              // Build variant name from properties (e.g., "Type=Simple, State=Default")
              var variantParts = [];
              for (var prop in msg.variant) {
                if (msg.variant.hasOwnProperty(prop)) {
                  variantParts.push(prop + '=' + msg.variant[prop]);
                }
              }
              var targetVariantName = variantParts.join(', ');
              console.log('🌉 [Desktop Bridge] Looking for variant:', targetVariantName);

              // Find matching variant
              for (var i = 0; i < node.children.length; i++) {
                var child = node.children[i];
                if (child.type === 'COMPONENT' && child.name === targetVariantName) {
                  component = child;
                  console.log('🌉 [Desktop Bridge] Found exact variant match');
                  break;
                }
              }

              // If no exact match, try partial match
              if (!component) {
                for (var i = 0; i < node.children.length; i++) {
                  var child = node.children[i];
                  if (child.type === 'COMPONENT') {
                    var matches = true;
                    for (var prop in msg.variant) {
                      if (msg.variant.hasOwnProperty(prop)) {
                        var expected = prop + '=' + msg.variant[prop];
                        if (child.name.indexOf(expected) === -1) {
                          matches = false;
                          break;
                        }
                      }
                    }
                    if (matches) {
                      component = child;
                      console.log('🌉 [Desktop Bridge] Found partial variant match:', child.name);
                      break;
                    }
                  }
                }
              }
            }

            // Default to first variant if no match
            if (!component && node.children && node.children.length > 0) {
              component = node.children[0];
              console.log('🌉 [Desktop Bridge] Using default variant:', component.name);
            }
          }
        }
      }

      if (!component) {
        // Build detailed error message with actionable guidance
        var errorParts = ['Component not found.'];

        if (msg.componentKey && !msg.nodeId) {
          errorParts.push('Component key "' + msg.componentKey + '" not found. Note: componentKey only works for components from published libraries. For local/unpublished components, you must provide nodeId instead.');
        } else if (msg.componentKey && msg.nodeId) {
          errorParts.push('Neither componentKey "' + msg.componentKey + '" nor nodeId "' + msg.nodeId + '" resolved to a valid component. The identifiers may be stale from a previous session.');
        } else if (msg.nodeId) {
          errorParts.push('NodeId "' + msg.nodeId + '" does not exist in this file. NodeIds are session-specific and become stale when Figma restarts or the file is closed.');
        } else {
          errorParts.push('No componentKey or nodeId was provided.');
        }

        errorParts.push('SOLUTION: Call figma_search_components to get fresh identifiers, then pass BOTH componentKey AND nodeId together for reliable instantiation.');

        throw new Error(errorParts.join(' '));
      }

      // Create the instance
      instance = component.createInstance();

      // Apply position if specified
      if (msg.position) {
        instance.x = msg.position.x || 0;
        instance.y = msg.position.y || 0;
      }

      // Apply size override if specified
      if (msg.size) {
        instance.resize(msg.size.width, msg.size.height);
      }

      // Apply property overrides
      if (msg.overrides) {
        for (var propName in msg.overrides) {
          if (msg.overrides.hasOwnProperty(propName)) {
            try {
              instance.setProperties({ [propName]: msg.overrides[propName] });
            } catch (propError) {
              console.warn('🌉 [Desktop Bridge] Could not set property ' + propName + ':', propError.message);
            }
          }
        }
      }

      // Apply variant selection if specified
      if (msg.variant) {
        try {
          instance.setProperties(msg.variant);
        } catch (variantError) {
          console.warn('🌉 [Desktop Bridge] Could not set variant:', variantError.message);
        }
      }

      // Append to parent if specified
      if (msg.parentId) {
        var parent = await figma.getNodeByIdAsync(msg.parentId);
        if (parent && 'appendChild' in parent) {
          parent.appendChild(instance);
        }
      }

      console.log('🌉 [Desktop Bridge] Component instantiated:', instance.id);

      figma.ui.postMessage({
        type: 'INSTANTIATE_COMPONENT_RESULT',
        requestId: msg.requestId,
        success: true,
        instance: {
          id: instance.id,
          name: instance.name,
          x: instance.x,
          y: instance.y,
          width: instance.width,
          height: instance.height
        }
      });

    } catch (error) {
      var errorMsg = error && error.message ? error.message : String(error);
      console.error('🌉 [Desktop Bridge] Instantiate component error:', errorMsg);
      figma.ui.postMessage({
        type: 'INSTANTIATE_COMPONENT_RESULT',
        requestId: msg.requestId,
        success: false,
        error: errorMsg
      });
    }
  }

  // ============================================================================
  // SET_NODE_DESCRIPTION - Set description on component/style
  // ============================================================================
  else if (msg.type === 'SET_NODE_DESCRIPTION') {
    try {
      console.log('🌉 [Desktop Bridge] Setting description on node:', msg.nodeId);

      var node = await figma.getNodeByIdAsync(msg.nodeId);
      if (!node) {
        throw new Error('Node not found: ' + msg.nodeId);
      }

      // Check if node supports description
      if (!('description' in node)) {
        throw new Error('Node type ' + node.type + ' does not support description');
      }

      // Set description (and markdown if supported)
      node.description = msg.description || '';
      if (msg.descriptionMarkdown && 'descriptionMarkdown' in node) {
        node.descriptionMarkdown = msg.descriptionMarkdown;
      }

      console.log('🌉 [Desktop Bridge] Description set successfully');

      figma.ui.postMessage({
        type: 'SET_NODE_DESCRIPTION_RESULT',
        requestId: msg.requestId,
        success: true,
        node: { id: node.id, name: node.name, description: node.description }
      });

    } catch (error) {
      var errorMsg = error && error.message ? error.message : String(error);
      console.error('🌉 [Desktop Bridge] Set description error:', errorMsg);
      figma.ui.postMessage({
        type: 'SET_NODE_DESCRIPTION_RESULT',
        requestId: msg.requestId,
        success: false,
        error: errorMsg
      });
    }
  }

  // ============================================================================
  // ADD_COMPONENT_PROPERTY - Add property to component
  // ============================================================================
  else if (msg.type === 'ADD_COMPONENT_PROPERTY') {
    try {
      console.log('🌉 [Desktop Bridge] Adding component property:', msg.propertyName, 'type:', msg.propertyType);

      var node = await figma.getNodeByIdAsync(msg.nodeId);
      if (!node) {
        throw new Error('Node not found: ' + msg.nodeId);
      }

      if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') {
        throw new Error('Node must be a COMPONENT or COMPONENT_SET. Got: ' + node.type);
      }

      // Check if it's a variant (can't add properties to variants)
      if (node.type === 'COMPONENT' && node.parent && node.parent.type === 'COMPONENT_SET') {
        throw new Error('Cannot add properties to variant components. Add to the parent COMPONENT_SET instead.');
      }

      // Build options if preferredValues provided
      var options = undefined;
      if (msg.preferredValues) {
        options = { preferredValues: msg.preferredValues };
      }

      // Use msg.propertyType (not msg.type which is the message type 'ADD_COMPONENT_PROPERTY')
      var propertyNameWithId = node.addComponentProperty(msg.propertyName, msg.propertyType, msg.defaultValue, options);

      console.log('🌉 [Desktop Bridge] Property added:', propertyNameWithId);

      figma.ui.postMessage({
        type: 'ADD_COMPONENT_PROPERTY_RESULT',
        requestId: msg.requestId,
        success: true,
        propertyName: propertyNameWithId
      });

    } catch (error) {
      var errorMsg = error && error.message ? error.message : String(error);
      console.error('🌉 [Desktop Bridge] Add component property error:', errorMsg);
      figma.ui.postMessage({
        type: 'ADD_COMPONENT_PROPERTY_RESULT',
        requestId: msg.requestId,
        success: false,
        error: errorMsg
      });
    }
  }

  // ============================================================================
  // EDIT_COMPONENT_PROPERTY - Edit existing component property
  // ============================================================================
  else if (msg.type === 'EDIT_COMPONENT_PROPERTY') {
    try {
      console.log('🌉 [Desktop Bridge] Editing component property:', msg.propertyName);

      var node = await figma.getNodeByIdAsync(msg.nodeId);
      if (!node) {
        throw new Error('Node not found: ' + msg.nodeId);
      }

      if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') {
        throw new Error('Node must be a COMPONENT or COMPONENT_SET. Got: ' + node.type);
      }

      var propertyNameWithId = node.editComponentProperty(msg.propertyName, msg.newValue);

      console.log('🌉 [Desktop Bridge] Property edited:', propertyNameWithId);

      figma.ui.postMessage({
        type: 'EDIT_COMPONENT_PROPERTY_RESULT',
        requestId: msg.requestId,
        success: true,
        propertyName: propertyNameWithId
      });

    } catch (error) {
      var errorMsg = error && error.message ? error.message : String(error);
      console.error('🌉 [Desktop Bridge] Edit component property error:', errorMsg);
      figma.ui.postMessage({
        type: 'EDIT_COMPONENT_PROPERTY_RESULT',
        requestId: msg.requestId,
        success: false,
        error: errorMsg
      });
    }
  }

  // ============================================================================
  // DELETE_COMPONENT_PROPERTY - Delete a component property
  // ============================================================================
  else if (msg.type === 'DELETE_COMPONENT_PROPERTY') {
    try {
      console.log('🌉 [Desktop Bridge] Deleting component property:', msg.propertyName);

      var node = await figma.getNodeByIdAsync(msg.nodeId);
      if (!node) {
        throw new Error('Node not found: ' + msg.nodeId);
      }

      if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') {
        throw new Error('Node must be a COMPONENT or COMPONENT_SET. Got: ' + node.type);
      }

      node.deleteComponentProperty(msg.propertyName);

      console.log('🌉 [Desktop Bridge] Property deleted');

      figma.ui.postMessage({
        type: 'DELETE_COMPONENT_PROPERTY_RESULT',
        requestId: msg.requestId,
        success: true
      });

    } catch (error) {
      var errorMsg = error && error.message ? error.message : String(error);
      console.error('🌉 [Desktop Bridge] Delete component property error:', errorMsg);
      figma.ui.postMessage({
        type: 'DELETE_COMPONENT_PROPERTY_RESULT',
        requestId: msg.requestId,
        success: false,
        error: errorMsg
      });
    }
  }

  // ============================================================================
  // RESIZE_NODE - Resize any node
  // ============================================================================
  else if (msg.type === 'RESIZE_NODE') {
    try {
      console.log('🌉 [Desktop Bridge] Resizing node:', msg.nodeId);

      var node = await figma.getNodeByIdAsync(msg.nodeId);
      if (!node) {
        throw new Error('Node not found: ' + msg.nodeId);
      }

      if (!('resize' in node)) {
        throw new Error('Node type ' + node.type + ' does not support resize');
      }

      if (msg.withConstraints) {
        node.resize(msg.width, msg.height);
      } else {
        node.resizeWithoutConstraints(msg.width, msg.height);
      }

      console.log('🌉 [Desktop Bridge] Node resized to:', msg.width, 'x', msg.height);

      figma.ui.postMessage({
        type: 'RESIZE_NODE_RESULT',
        requestId: msg.requestId,
        success: true,
        node: { id: node.id, name: node.name, width: node.width, height: node.height }
      });

    } catch (error) {
      var errorMsg = error && error.message ? error.message : String(error);
      console.error('🌉 [Desktop Bridge] Resize node error:', errorMsg);
      figma.ui.postMessage({
        type: 'RESIZE_NODE_RESULT',
        requestId: msg.requestId,
        success: false,
        error: errorMsg
      });
    }
  }

  // ============================================================================
  // MOVE_NODE - Move/position a node
  // ============================================================================
  else if (msg.type === 'MOVE_NODE') {
    try {
      console.log('🌉 [Desktop Bridge] Moving node:', msg.nodeId);

      var node = await figma.getNodeByIdAsync(msg.nodeId);
      if (!node) {
        throw new Error('Node not found: ' + msg.nodeId);
      }

      if (!('x' in node)) {
        throw new Error('Node type ' + node.type + ' does not support positioning');
      }

      node.x = msg.x;
      node.y = msg.y;

      console.log('🌉 [Desktop Bridge] Node moved to:', msg.x, ',', msg.y);

      figma.ui.postMessage({
        type: 'MOVE_NODE_RESULT',
        requestId: msg.requestId,
        success: true,
        node: { id: node.id, name: node.name, x: node.x, y: node.y }
      });

    } catch (error) {
      var errorMsg = error && error.message ? error.message : String(error);
      console.error('🌉 [Desktop Bridge] Move node error:', errorMsg);
      figma.ui.postMessage({
        type: 'MOVE_NODE_RESULT',
        requestId: msg.requestId,
        success: false,
        error: errorMsg
      });
    }
  }

  // ============================================================================
  // SET_NODE_FILLS - Set fills (colors) on a node
  // ============================================================================
  else if (msg.type === 'SET_NODE_FILLS') {
    try {
      console.log('🌉 [Desktop Bridge] Setting fills on node:', msg.nodeId);

      var node = await figma.getNodeByIdAsync(msg.nodeId);
      if (!node) {
        throw new Error('Node not found: ' + msg.nodeId);
      }

      if (!('fills' in node)) {
        throw new Error('Node type ' + node.type + ' does not support fills');
      }

      // Process fills - convert hex colors if needed
      var processedFills = msg.fills.map(function(fill) {
        if (fill.type === 'SOLID' && typeof fill.color === 'string') {
          // Convert hex to RGB
          var rgb = hexToFigmaRGB(fill.color);
          return {
            type: 'SOLID',
            color: { r: rgb.r, g: rgb.g, b: rgb.b },
            opacity: rgb.a !== undefined ? rgb.a : (fill.opacity !== undefined ? fill.opacity : 1)
          };
        }
        return fill;
      });

      node.fills = processedFills;

      console.log('🌉 [Desktop Bridge] Fills set successfully');

      figma.ui.postMessage({
        type: 'SET_NODE_FILLS_RESULT',
        requestId: msg.requestId,
        success: true,
        node: { id: node.id, name: node.name }
      });

    } catch (error) {
      var errorMsg = error && error.message ? error.message : String(error);
      console.error('🌉 [Desktop Bridge] Set fills error:', errorMsg);
      figma.ui.postMessage({
        type: 'SET_NODE_FILLS_RESULT',
        requestId: msg.requestId,
        success: false,
        error: errorMsg
      });
    }
  }

  // ============================================================================
  // SET_IMAGE_FILL - Set an image fill on one or more nodes
  // Receives raw image bytes (as Array) from ui.html which decodes base64
  // ============================================================================
  else if (msg.type === 'SET_IMAGE_FILL') {
    try {
      console.log('🌉 [Desktop Bridge] Setting image fill, bytes:', msg.imageBytes.length);

      // Convert the plain array back to Uint8Array
      var bytes = new Uint8Array(msg.imageBytes);

      // Create the image in Figma
      var image = figma.createImage(bytes);
      var imageHash = image.hash;

      var fill = {
        type: 'IMAGE',
        scaleMode: msg.scaleMode || 'FILL',
        imageHash: imageHash
      };

      // Resolve target nodes
      var nodeIds = msg.nodeIds || (msg.nodeId ? [msg.nodeId] : []);
      var updatedCount = 0;
      var updatedNodes = [];

      for (var i = 0; i < nodeIds.length; i++) {
        var node = await figma.getNodeByIdAsync(nodeIds[i]);
        if (node && 'fills' in node) {
          node.fills = [fill];
          updatedCount++;
          updatedNodes.push({ id: node.id, name: node.name });
        }
      }

      console.log('🌉 [Desktop Bridge] Image fill applied to', updatedCount, 'node(s), hash:', imageHash);

      figma.ui.postMessage({
        type: 'SET_IMAGE_FILL_RESULT',
        requestId: msg.requestId,
        success: true,
        imageHash: imageHash,
        updatedCount: updatedCount,
        nodes: updatedNodes
      });

    } catch (error) {
      var errorMsg = error && error.message ? error.message : String(error);
      console.error('🌉 [Desktop Bridge] Set image fill error:', errorMsg);
      figma.ui.postMessage({
        type: 'SET_IMAGE_FILL_RESULT',
        requestId: msg.requestId,
        success: false,
        error: errorMsg
      });
    }
  }

  // ============================================================================
  // SET_NODE_STROKES - Set strokes on a node
  // ============================================================================
  else if (msg.type === 'SET_NODE_STROKES') {
    try {
      console.log('🌉 [Desktop Bridge] Setting strokes on node:', msg.nodeId);

      var node = await figma.getNodeByIdAsync(msg.nodeId);
      if (!node) {
        throw new Error('Node not found: ' + msg.nodeId);
      }

      if (!('strokes' in node)) {
        throw new Error('Node type ' + node.type + ' does not support strokes');
      }

      // Process strokes - convert hex colors if needed
      var processedStrokes = msg.strokes.map(function(stroke) {
        if (stroke.type === 'SOLID' && typeof stroke.color === 'string') {
          var rgb = hexToFigmaRGB(stroke.color);
          return {
            type: 'SOLID',
            color: { r: rgb.r, g: rgb.g, b: rgb.b },
            opacity: rgb.a !== undefined ? rgb.a : (stroke.opacity !== undefined ? stroke.opacity : 1)
          };
        }
        return stroke;
      });

      node.strokes = processedStrokes;

      if (msg.strokeWeight !== undefined) {
        node.strokeWeight = msg.strokeWeight;
      }

      console.log('🌉 [Desktop Bridge] Strokes set successfully');

      figma.ui.postMessage({
        type: 'SET_NODE_STROKES_RESULT',
        requestId: msg.requestId,
        success: true,
        node: { id: node.id, name: node.name }
      });

    } catch (error) {
      var errorMsg = error && error.message ? error.message : String(error);
      console.error('🌉 [Desktop Bridge] Set strokes error:', errorMsg);
      figma.ui.postMessage({
        type: 'SET_NODE_STROKES_RESULT',
        requestId: msg.requestId,
        success: false,
        error: errorMsg
      });
    }
  }

  // ============================================================================
  // SET_NODE_OPACITY - Set opacity on a node
  // ============================================================================
  else if (msg.type === 'SET_NODE_OPACITY') {
    try {
      console.log('🌉 [Desktop Bridge] Setting opacity on node:', msg.nodeId);

      var node = await figma.getNodeByIdAsync(msg.nodeId);
      if (!node) {
        throw new Error('Node not found: ' + msg.nodeId);
      }

      if (!('opacity' in node)) {
        throw new Error('Node type ' + node.type + ' does not support opacity');
      }

      node.opacity = Math.max(0, Math.min(1, msg.opacity));

      console.log('🌉 [Desktop Bridge] Opacity set to:', node.opacity);

      figma.ui.postMessage({
        type: 'SET_NODE_OPACITY_RESULT',
        requestId: msg.requestId,
        success: true,
        node: { id: node.id, name: node.name, opacity: node.opacity }
      });

    } catch (error) {
      var errorMsg = error && error.message ? error.message : String(error);
      console.error('🌉 [Desktop Bridge] Set opacity error:', errorMsg);
      figma.ui.postMessage({
        type: 'SET_NODE_OPACITY_RESULT',
        requestId: msg.requestId,
        success: false,
        error: errorMsg
      });
    }
  }

  // ============================================================================
  // SET_NODE_CORNER_RADIUS - Set corner radius on a node
  // ============================================================================
  else if (msg.type === 'SET_NODE_CORNER_RADIUS') {
    try {
      console.log('🌉 [Desktop Bridge] Setting corner radius on node:', msg.nodeId);

      var node = await figma.getNodeByIdAsync(msg.nodeId);
      if (!node) {
        throw new Error('Node not found: ' + msg.nodeId);
      }

      if (!('cornerRadius' in node)) {
        throw new Error('Node type ' + node.type + ' does not support corner radius');
      }

      node.cornerRadius = msg.radius;

      console.log('🌉 [Desktop Bridge] Corner radius set to:', msg.radius);

      figma.ui.postMessage({
        type: 'SET_NODE_CORNER_RADIUS_RESULT',
        requestId: msg.requestId,
        success: true,
        node: { id: node.id, name: node.name, cornerRadius: node.cornerRadius }
      });

    } catch (error) {
      var errorMsg = error && error.message ? error.message : String(error);
      console.error('🌉 [Desktop Bridge] Set corner radius error:', errorMsg);
      figma.ui.postMessage({
        type: 'SET_NODE_CORNER_RADIUS_RESULT',
        requestId: msg.requestId,
        success: false,
        error: errorMsg
      });
    }
  }

  // ============================================================================
  // CLONE_NODE - Clone/duplicate a node
  // ============================================================================
  else if (msg.type === 'CLONE_NODE') {
    try {
      console.log('🌉 [Desktop Bridge] Cloning node:', msg.nodeId);

      var node = await figma.getNodeByIdAsync(msg.nodeId);
      if (!node) {
        throw new Error('Node not found: ' + msg.nodeId);
      }

      if (!('clone' in node)) {
        throw new Error('Node type ' + node.type + ' does not support cloning');
      }

      var clonedNode = node.clone();

      console.log('🌉 [Desktop Bridge] Node cloned:', clonedNode.id);

      figma.ui.postMessage({
        type: 'CLONE_NODE_RESULT',
        requestId: msg.requestId,
        success: true,
        node: { id: clonedNode.id, name: clonedNode.name, x: clonedNode.x, y: clonedNode.y }
      });

    } catch (error) {
      var errorMsg = error && error.message ? error.message : String(error);
      console.error('🌉 [Desktop Bridge] Clone node error:', errorMsg);
      figma.ui.postMessage({
        type: 'CLONE_NODE_RESULT',
        requestId: msg.requestId,
        success: false,
        error: errorMsg
      });
    }
  }

  // ============================================================================
  // DELETE_NODE - Delete a node
  // ============================================================================
  else if (msg.type === 'DELETE_NODE') {
    try {
      console.log('🌉 [Desktop Bridge] Deleting node:', msg.nodeId);

      var node = await figma.getNodeByIdAsync(msg.nodeId);
      if (!node) {
        throw new Error('Node not found: ' + msg.nodeId);
      }

      var deletedInfo = { id: node.id, name: node.name };

      node.remove();

      console.log('🌉 [Desktop Bridge] Node deleted');

      figma.ui.postMessage({
        type: 'DELETE_NODE_RESULT',
        requestId: msg.requestId,
        success: true,
        deleted: deletedInfo
      });

    } catch (error) {
      var errorMsg = error && error.message ? error.message : String(error);
      console.error('🌉 [Desktop Bridge] Delete node error:', errorMsg);
      figma.ui.postMessage({
        type: 'DELETE_NODE_RESULT',
        requestId: msg.requestId,
        success: false,
        error: errorMsg
      });
    }
  }

  // ============================================================================
  // RENAME_NODE - Rename a node
  // ============================================================================
  else if (msg.type === 'RENAME_NODE') {
    try {
      console.log('🌉 [Desktop Bridge] Renaming node:', msg.nodeId);

      var node = await figma.getNodeByIdAsync(msg.nodeId);
      if (!node) {
        throw new Error('Node not found: ' + msg.nodeId);
      }

      var oldName = node.name;
      node.name = msg.newName;

      console.log('🌉 [Desktop Bridge] Node renamed from "' + oldName + '" to "' + msg.newName + '"');

      figma.ui.postMessage({
        type: 'RENAME_NODE_RESULT',
        requestId: msg.requestId,
        success: true,
        node: { id: node.id, name: node.name, oldName: oldName }
      });

    } catch (error) {
      var errorMsg = error && error.message ? error.message : String(error);
      console.error('🌉 [Desktop Bridge] Rename node error:', errorMsg);
      figma.ui.postMessage({
        type: 'RENAME_NODE_RESULT',
        requestId: msg.requestId,
        success: false,
        error: errorMsg
      });
    }
  }

  // ============================================================================
  // SET_TEXT_CONTENT - Set text on a text node
  // ============================================================================
  else if (msg.type === 'SET_TEXT_CONTENT') {
    try {
      console.log('🌉 [Desktop Bridge] Setting text content on node:', msg.nodeId);

      var node = await figma.getNodeByIdAsync(msg.nodeId);
      if (!node) {
        throw new Error('Node not found: ' + msg.nodeId);
      }

      if (node.type !== 'TEXT') {
        throw new Error('Node must be a TEXT node. Got: ' + node.type);
      }

      // Load the font first
      await figma.loadFontAsync(node.fontName);

      node.characters = msg.text;

      // Apply font properties if specified
      if (msg.fontSize) {
        node.fontSize = msg.fontSize;
      }

      console.log('🌉 [Desktop Bridge] Text content set');

      figma.ui.postMessage({
        type: 'SET_TEXT_CONTENT_RESULT',
        requestId: msg.requestId,
        success: true,
        node: { id: node.id, name: node.name, characters: node.characters }
      });

    } catch (error) {
      var errorMsg = error && error.message ? error.message : String(error);
      console.error('🌉 [Desktop Bridge] Set text content error:', errorMsg);
      figma.ui.postMessage({
        type: 'SET_TEXT_CONTENT_RESULT',
        requestId: msg.requestId,
        success: false,
        error: errorMsg
      });
    }
  }

  // ============================================================================
  // CREATE_CHILD_NODE - Create a new child node
  // ============================================================================
  else if (msg.type === 'CREATE_CHILD_NODE') {
    try {
      console.log('🌉 [Desktop Bridge] Creating child node of type:', msg.nodeType);

      var parent = await figma.getNodeByIdAsync(msg.parentId);
      if (!parent) {
        throw new Error('Parent node not found: ' + msg.parentId);
      }

      if (!('appendChild' in parent)) {
        throw new Error('Parent node type ' + parent.type + ' does not support children');
      }

      var newNode;
      var props = msg.properties || {};

      switch (msg.nodeType) {
        case 'RECTANGLE':
          newNode = figma.createRectangle();
          break;
        case 'ELLIPSE':
          newNode = figma.createEllipse();
          break;
        case 'FRAME':
          newNode = figma.createFrame();
          break;
        case 'TEXT':
          newNode = figma.createText();
          // Load default font
          await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
          newNode.fontName = { family: 'Inter', style: 'Regular' };
          if (props.text) {
            newNode.characters = props.text;
          }
          break;
        case 'LINE':
          newNode = figma.createLine();
          break;
        case 'POLYGON':
          newNode = figma.createPolygon();
          break;
        case 'STAR':
          newNode = figma.createStar();
          break;
        case 'VECTOR':
          newNode = figma.createVector();
          break;
        default:
          throw new Error('Unsupported node type: ' + msg.nodeType);
      }

      // Apply common properties
      if (props.name) newNode.name = props.name;
      if (props.x !== undefined) newNode.x = props.x;
      if (props.y !== undefined) newNode.y = props.y;
      if (props.width !== undefined && props.height !== undefined) {
        newNode.resize(props.width, props.height);
      }

      // Apply fills if specified
      if (props.fills) {
        var processedFills = props.fills.map(function(fill) {
          if (fill.type === 'SOLID' && typeof fill.color === 'string') {
            var rgb = hexToFigmaRGB(fill.color);
            return {
              type: 'SOLID',
              color: { r: rgb.r, g: rgb.g, b: rgb.b },
              opacity: rgb.a !== undefined ? rgb.a : 1
            };
          }
          return fill;
        });
        newNode.fills = processedFills;
      }

      // Add to parent
      parent.appendChild(newNode);

      console.log('🌉 [Desktop Bridge] Child node created:', newNode.id);

      figma.ui.postMessage({
        type: 'CREATE_CHILD_NODE_RESULT',
        requestId: msg.requestId,
        success: true,
        node: {
          id: newNode.id,
          name: newNode.name,
          type: newNode.type,
          x: newNode.x,
          y: newNode.y,
          width: newNode.width,
          height: newNode.height
        }
      });

    } catch (error) {
      var errorMsg = error && error.message ? error.message : String(error);
      console.error('🌉 [Desktop Bridge] Create child node error:', errorMsg);
      figma.ui.postMessage({
        type: 'CREATE_CHILD_NODE_RESULT',
        requestId: msg.requestId,
        success: false,
        error: errorMsg
      });
    }
  }

  // ============================================================================
  // CAPTURE_SCREENSHOT - Capture node screenshot using plugin exportAsync
  // This captures the CURRENT plugin runtime state (not cloud state like REST API)
  // ============================================================================
  else if (msg.type === 'CAPTURE_SCREENSHOT') {
    try {
      console.log('🌉 [Desktop Bridge] Capturing screenshot for node:', msg.nodeId);

      var node = msg.nodeId ? await figma.getNodeByIdAsync(msg.nodeId) : figma.currentPage;
      if (!node) {
        throw new Error('Node not found: ' + msg.nodeId);
      }

      // Verify node supports export
      if (!('exportAsync' in node)) {
        throw new Error('Node type ' + node.type + ' does not support export');
      }

      // Configure export settings — AI-optimized defaults (PNG 1x)
      var format = msg.format || 'PNG';
      var scale = msg.scale || 1;

      // AI vision cap: models resize images beyond their processing ceiling,
      // so exporting larger just wastes bandwidth and export time.
      // msg.maxDimension is set per-provider by the host (e.g. 1568 for Claude, 2048 for GPT).
      var maxDim = msg.maxDimension || 1568;
      var nodeWidth = 0;
      var nodeHeight = 0;

      if (node.type === 'PAGE') {
        // Pages don't have fixed dimensions — calculate from visible children
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (var i = 0; i < node.children.length; i++) {
          var child = node.children[i];
          if (child.visible !== false && 'absoluteBoundingBox' in child && child.absoluteBoundingBox) {
            var bb = child.absoluteBoundingBox;
            minX = Math.min(minX, bb.x);
            minY = Math.min(minY, bb.y);
            maxX = Math.max(maxX, bb.x + bb.width);
            maxY = Math.max(maxY, bb.y + bb.height);
          }
        }
        if (minX !== Infinity) {
          nodeWidth = maxX - minX;
          nodeHeight = maxY - minY;
        }
      } else if ('width' in node && 'height' in node) {
        nodeWidth = node.width;
        nodeHeight = node.height;
      }

      // Cap scale so the longest exported side doesn't exceed the AI processing ceiling
      if (nodeWidth > 0 && nodeHeight > 0) {
        var longestSide = Math.max(nodeWidth, nodeHeight);
        var exportedLongest = longestSide * scale;
        if (exportedLongest > maxDim) {
          var cappedScale = maxDim / longestSide;
          console.log('🌉 [Desktop Bridge] Capping scale from', scale, 'to', cappedScale.toFixed(3),
            '(node ' + Math.round(longestSide) + 'px, cap ' + maxDim + 'px)');
          scale = cappedScale;
        }
      }

      var exportSettings = {
        format: format,
        constraint: { type: 'SCALE', value: scale }
      };

      // Export the node
      var bytes = await node.exportAsync(exportSettings);

      // Convert to base64
      var base64 = figma.base64Encode(bytes);

      // Get node bounds for context
      var bounds = null;
      if ('absoluteBoundingBox' in node) {
        bounds = node.absoluteBoundingBox;
      }

      console.log('🌉 [Desktop Bridge] Screenshot captured:', bytes.length, 'bytes');

      figma.ui.postMessage({
        type: 'CAPTURE_SCREENSHOT_RESULT',
        requestId: msg.requestId,
        success: true,
        image: {
          base64: base64,
          format: format,
          scale: scale,
          byteLength: bytes.length,
          node: {
            id: node.id,
            name: node.name,
            type: node.type
          },
          bounds: bounds
        }
      });

    } catch (error) {
      var errorMsg = error && error.message ? error.message : String(error);
      console.error('🌉 [Desktop Bridge] Screenshot capture error:', errorMsg);
      figma.ui.postMessage({
        type: 'CAPTURE_SCREENSHOT_RESULT',
        requestId: msg.requestId,
        success: false,
        error: errorMsg
      });
    }
  }

  // ============================================================================
  // GET_FILE_INFO - Report which file this plugin instance is running in
  // Used by WebSocket bridge to identify the connected file
  // ============================================================================
  else if (msg.type === 'GET_FILE_INFO') {
    try {
      var selection = figma.currentPage.selection;
      figma.ui.postMessage({
        type: 'GET_FILE_INFO_RESULT',
        requestId: msg.requestId,
        success: true,
        fileInfo: {
          fileName: figma.root.name,
          fileKey: figma.fileKey || null,
          currentPage: figma.currentPage.name,
          currentPageId: figma.currentPage.id,
          selectionCount: selection ? selection.length : 0
        }
      });
    } catch (error) {
      var errorMsg = error && error.message ? error.message : String(error);
      figma.ui.postMessage({
        type: 'GET_FILE_INFO_RESULT',
        requestId: msg.requestId,
        success: false,
        error: errorMsg
      });
    }
  }


  // ============================================================================
  // RELOAD_UI - Reload the plugin UI iframe (re-establishes WebSocket connection)
  // Uses figma.showUI(__html__) to reload without restarting code.js
  // ============================================================================
  else if (msg.type === 'RELOAD_UI') {
    try {
      console.log('🌉 [Desktop Bridge] Reloading plugin UI');
      figma.ui.postMessage({
        type: 'RELOAD_UI_RESULT',
        requestId: msg.requestId,
        success: true
      });
      // Short delay to let the response message be sent before reload
      setTimeout(function() {
        figma.showUI(__html__, { width: 140, height: 50, visible: true, themeColors: true });
      }, 100);
    } catch (error) {
      var errorMsg = error && error.message ? error.message : String(error);
      figma.ui.postMessage({
        type: 'RELOAD_UI_RESULT',
        requestId: msg.requestId,
        success: false,
        error: errorMsg
      });
    }
  }

  // ============================================================================
  // SET_INSTANCE_PROPERTIES - Update component properties on an instance
  // Uses instance.setProperties() to update TEXT, BOOLEAN, INSTANCE_SWAP, VARIANT
  // ============================================================================
  else if (msg.type === 'SET_INSTANCE_PROPERTIES') {
    try {
      console.log('🌉 [Desktop Bridge] Setting instance properties on:', msg.nodeId);

      var node = await figma.getNodeByIdAsync(msg.nodeId);
      if (!node) {
        throw new Error('Node not found: ' + msg.nodeId);
      }

      if (node.type !== 'INSTANCE') {
        throw new Error('Node must be an INSTANCE. Got: ' + node.type);
      }

      // Load main component first (required for documentAccess: dynamic-page)
      var mainComponent = await node.getMainComponentAsync();

      // Get current properties for reference
      var currentProps = node.componentProperties;
      console.log('🌉 [Desktop Bridge] Current properties:', JSON.stringify(Object.keys(currentProps)));

      // Build the properties object
      // Note: TEXT, BOOLEAN, INSTANCE_SWAP properties use the format "PropertyName#nodeId"
      // VARIANT properties use just "PropertyName"
      var propsToSet = {};
      var propUpdates = msg.properties || {};

      for (var propName in propUpdates) {
        var newValue = propUpdates[propName];

        // Check if this exact property name exists
        if (currentProps[propName] !== undefined) {
          propsToSet[propName] = newValue;
          console.log('🌉 [Desktop Bridge] Setting property:', propName, '=', newValue);
        } else {
          // Try to find a matching property with a suffix (for TEXT/BOOLEAN/INSTANCE_SWAP)
          var foundMatch = false;
          for (var existingProp in currentProps) {
            // Check if this is the base property name with a node ID suffix
            if (existingProp.startsWith(propName + '#')) {
              propsToSet[existingProp] = newValue;
              console.log('🌉 [Desktop Bridge] Found suffixed property:', existingProp, '=', newValue);
              foundMatch = true;
              break;
            }
          }

          if (!foundMatch) {
            console.warn('🌉 [Desktop Bridge] Property not found:', propName, '- Available:', Object.keys(currentProps).join(', '));
          }
        }
      }

      if (Object.keys(propsToSet).length === 0) {
        throw new Error('No valid properties to set. Available properties: ' + Object.keys(currentProps).join(', '));
      }

      // Apply the properties
      node.setProperties(propsToSet);

      // Get updated properties
      var updatedProps = node.componentProperties;

      console.log('🌉 [Desktop Bridge] Instance properties updated');

      figma.ui.postMessage({
        type: 'SET_INSTANCE_PROPERTIES_RESULT',
        requestId: msg.requestId,
        success: true,
        instance: {
          id: node.id,
          name: node.name,
          componentId: mainComponent ? mainComponent.id : null,
          propertiesSet: Object.keys(propsToSet),
          currentProperties: Object.keys(updatedProps).reduce(function(acc, key) {
            acc[key] = {
              type: updatedProps[key].type,
              value: updatedProps[key].value
            };
            return acc;
          }, {})
        }
      });

    } catch (error) {
      var errorMsg = error && error.message ? error.message : String(error);
      console.error('🌉 [Desktop Bridge] Set instance properties error:', errorMsg);
      figma.ui.postMessage({
        type: 'SET_INSTANCE_PROPERTIES_RESULT',
        requestId: msg.requestId,
        success: false,
        error: errorMsg
      });
    }
  }

  // ============================================================================
  // LINT_DESIGN - Accessibility and design quality checks on node tree
  // ============================================================================
  else if (msg.type === 'LINT_DESIGN') {
    try {
      console.log('🌉 [Desktop Bridge] Running design lint...');

      // ---- Helper functions ----

      // sRGB linearization
      function lintLinearize(c) {
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      }

      // Relative luminance (r, g, b in 0-1 range)
      function lintLuminance(r, g, b) {
        return 0.2126 * lintLinearize(r) + 0.7152 * lintLinearize(g) + 0.0722 * lintLinearize(b);
      }

      // Contrast ratio between two colors (each r, g, b in 0-1)
      function lintContrastRatio(r1, g1, b1, r2, g2, b2) {
        var l1 = lintLuminance(r1, g1, b1);
        var l2 = lintLuminance(r2, g2, b2);
        var lighter = Math.max(l1, l2);
        var darker = Math.min(l1, l2);
        return (lighter + 0.05) / (darker + 0.05);
      }

      // Convert 0-1 RGB to hex string
      function lintRgbToHex(r, g, b) {
        var rr = Math.round(r * 255).toString(16);
        var gg = Math.round(g * 255).toString(16);
        var bb = Math.round(b * 255).toString(16);
        if (rr.length === 1) rr = '0' + rr;
        if (gg.length === 1) gg = '0' + gg;
        if (bb.length === 1) bb = '0' + bb;
        return '#' + rr.toUpperCase() + gg.toUpperCase() + bb.toUpperCase();
      }

      // Walk up ancestors to find nearest solid fill background color
      function lintGetEffectiveBg(node) {
        var current = node.parent;
        while (current) {
          try {
            if (current.fills && current.fills.length > 0) {
              // Iterate reverse (last = topmost visible fill in Figma's stack)
              for (var fi = current.fills.length - 1; fi >= 0; fi--) {
                var fill = current.fills[fi];
                if (fill.type === 'SOLID' && fill.visible !== false) {
                  var opacity = (fill.opacity !== undefined) ? fill.opacity : 1;
                  return { r: fill.color.r, g: fill.color.g, b: fill.color.b, opacity: opacity };
                }
              }
            }
          } catch (e) {
            // Slot sublayer — skip
          }
          current = current.parent;
        }
        // Default to white if no bg found
        return { r: 1, g: 1, b: 1, opacity: 1 };
      }

      // Check if text qualifies as "large" per WCAG (18pt=24px regular, 14pt≈18.66px bold 700+)
      function lintIsLargeText(fontSize, fontWeight) {
        if (fontSize >= 24) return true;
        if (fontSize >= 18.66 && fontWeight && (fontWeight === 'Bold' || fontWeight === 'Black' || fontWeight === 'ExtraBold')) return true;
        return false;
      }

      // ---- Rule configuration ----
      var allRuleIds = [
        'wcag-contrast', 'wcag-text-size', 'wcag-target-size', 'wcag-line-height',
        'hardcoded-color', 'no-text-style', 'default-name', 'detached-component',
        'no-autolayout', 'empty-container'
      ];

      var ruleGroups = {
        'all': allRuleIds,
        'wcag': ['wcag-contrast', 'wcag-text-size', 'wcag-target-size', 'wcag-line-height'],
        'design-system': ['hardcoded-color', 'no-text-style', 'default-name', 'detached-component'],
        'layout': ['no-autolayout', 'empty-container']
      };

      var severityMap = {
        'wcag-contrast': 'critical',
        'wcag-target-size': 'critical',
        'wcag-text-size': 'warning',
        'wcag-line-height': 'warning',
        'hardcoded-color': 'warning',
        'no-text-style': 'warning',
        'default-name': 'warning',
        'detached-component': 'warning',
        'no-autolayout': 'warning',
        'empty-container': 'info'
      };

      var ruleDescriptions = {
        'wcag-contrast': 'Text does not meet WCAG AA contrast ratio (4.5:1 normal, 3:1 large)',
        'wcag-text-size': 'Text size is below 12px minimum',
        'wcag-target-size': 'Interactive element is smaller than 24x24px minimum target size',
        'wcag-line-height': 'Line height is less than 1.5x the font size',
        'hardcoded-color': 'Fill color is not bound to a variable or style',
        'no-text-style': 'Text node is not using a text style',
        'default-name': 'Node has a default Figma name (e.g., "Frame 1")',
        'detached-component': 'Frame uses component naming convention but is not a component or instance',
        'no-autolayout': 'Frame with multiple children does not use auto-layout',
        'empty-container': 'Frame has no children'
      };

      var defaultNameRegex = /^(Frame|Rectangle|Ellipse|Line|Text|Group|Component|Instance|Vector|Polygon|Star|Section)(\s+\d+)?$/;
      var interactiveNameRegex = /button|link|input|checkbox|radio|switch|toggle|tab|menu-item/i;

      // ---- Resolve active rules ----
      var requestedRules = msg.rules || ['all'];
      var activeRuleSet = {};
      for (var ri = 0; ri < requestedRules.length; ri++) {
        var ruleOrGroup = requestedRules[ri];
        if (ruleGroups[ruleOrGroup]) {
          var groupRules = ruleGroups[ruleOrGroup];
          for (var gi = 0; gi < groupRules.length; gi++) {
            activeRuleSet[groupRules[gi]] = true;
          }
        } else if (severityMap[ruleOrGroup]) {
          activeRuleSet[ruleOrGroup] = true;
        }
      }

      var maxDepth = typeof msg.maxDepth === 'number' ? msg.maxDepth : 10;
      var maxFindings = typeof msg.maxFindings === 'number' ? msg.maxFindings : 100;

      // ---- Resolve root node ----
      var rootNode;
      if (msg.nodeId) {
        rootNode = await figma.getNodeByIdAsync(msg.nodeId);
        if (!rootNode) {
          throw new Error('Node not found: ' + msg.nodeId);
        }
      } else {
        rootNode = figma.currentPage;
      }

      // ---- Collect context (styles and variables for design-system rules) ----
      var paintStyleIds = {};
      var textStyleIds = {};
      var variableIds = {};

      if (activeRuleSet['hardcoded-color'] || activeRuleSet['no-text-style']) {
        try {
          var paintStyles = await figma.getLocalPaintStylesAsync();
          for (var pi = 0; pi < paintStyles.length; pi++) {
            paintStyleIds[paintStyles[pi].id] = true;
          }
        } catch (e) { /* ignore */ }

        try {
          var textStyles = await figma.getLocalTextStylesAsync();
          for (var ti = 0; ti < textStyles.length; ti++) {
            textStyleIds[textStyles[ti].id] = true;
          }
        } catch (e) { /* ignore */ }

        try {
          var localVars = await figma.variables.getLocalVariablesAsync();
          for (var vi = 0; vi < localVars.length; vi++) {
            variableIds[localVars[vi].id] = true;
          }
        } catch (e) { /* ignore */ }
      }

      // ---- Findings storage ----
      var findings = {};
      for (var ai = 0; ai < allRuleIds.length; ai++) {
        if (activeRuleSet[allRuleIds[ai]]) {
          findings[allRuleIds[ai]] = [];
        }
      }
      var totalFindings = 0;
      var nodesScanned = 0;
      var truncated = false;

      // ---- Tree walk ----
      function walkNode(node, depth) {
        if (depth > maxDepth) return;
        if (truncated) return;

        nodesScanned++;

        var nodeType, nodeName, nodeId;
        try {
          nodeType = node.type;
          nodeName = node.name;
          nodeId = node.id;
        } catch (e) {
          return; // Slot sublayer — skip entirely
        }

        // Skip pages for most checks but still recurse into their children
        var isPage = nodeType === 'PAGE';
        var isSection = nodeType === 'SECTION';

        // ---- WCAG checks ----

        // wcag-contrast: TEXT nodes
        if (activeRuleSet['wcag-contrast'] && nodeType === 'TEXT' && !truncated) {
          try {
            var fills = node.fills;
            if (fills && fills.length > 0) {
              for (var fci = 0; fci < fills.length; fci++) {
                if (fills[fci].type === 'SOLID' && fills[fci].visible !== false) {
                  var fg = fills[fci].color;
                  var bg = lintGetEffectiveBg(node);
                  var ratio = lintContrastRatio(fg.r, fg.g, fg.b, bg.r, bg.g, bg.b);
                  var fontSize = 16;
                  var fontWeight = null;
                  try { fontSize = node.fontSize; } catch (e) { /* mixed */ }
                  try { fontWeight = node.fontWeight; } catch (e) { /* mixed */ }
                  if (typeof fontSize !== 'number') fontSize = 16;
                  var isLarge = lintIsLargeText(fontSize, fontWeight);
                  var required = isLarge ? 3.0 : 4.5;
                  var fgOpacity = (fills[fci].opacity !== undefined) ? fills[fci].opacity : 1;
                  var approximate = fgOpacity < 1 || bg.opacity < 1;
                  if (ratio < required) {
                    if (totalFindings < maxFindings) {
                      var finding = {
                        id: nodeId,
                        name: nodeName,
                        ratio: ratio.toFixed(1) + ':1',
                        required: required.toFixed(1) + ':1',
                        fg: lintRgbToHex(fg.r, fg.g, fg.b),
                        bg: lintRgbToHex(bg.r, bg.g, bg.b)
                      };
                      if (approximate) finding.approximate = true;
                      findings['wcag-contrast'].push(finding);
                      totalFindings++;
                    } else {
                      truncated = true;
                    }
                  }
                  break; // Only check the first visible solid fill
                }
              }
            }
          } catch (e) { /* slot sublayer */ }
        }

        // wcag-text-size: TEXT nodes with fontSize < 12
        if (activeRuleSet['wcag-text-size'] && nodeType === 'TEXT' && !truncated) {
          try {
            var ts = node.fontSize;
            if (typeof ts === 'number' && ts < 12) {
              if (totalFindings < maxFindings) {
                findings['wcag-text-size'].push({
                  id: nodeId,
                  name: nodeName,
                  fontSize: ts
                });
                totalFindings++;
              } else {
                truncated = true;
              }
            }
          } catch (e) { /* slot sublayer or mixed */ }
        }

        // wcag-target-size: Interactive elements < 24x24
        if (activeRuleSet['wcag-target-size'] && !isPage && !isSection && !truncated) {
          try {
            if ((nodeType === 'FRAME' || nodeType === 'COMPONENT' || nodeType === 'INSTANCE' || nodeType === 'COMPONENT_SET') && interactiveNameRegex.test(nodeName)) {
              var tw = node.width;
              var th = node.height;
              if ((typeof tw === 'number' && tw < 24) || (typeof th === 'number' && th < 24)) {
                if (totalFindings < maxFindings) {
                  findings['wcag-target-size'].push({
                    id: nodeId,
                    name: nodeName,
                    width: tw,
                    height: th
                  });
                  totalFindings++;
                } else {
                  truncated = true;
                }
              }
            }
          } catch (e) { /* slot sublayer */ }
        }

        // wcag-line-height: TEXT nodes where lineHeight < 1.5 * fontSize
        if (activeRuleSet['wcag-line-height'] && nodeType === 'TEXT' && !truncated) {
          try {
            var lh = node.lineHeight;
            var fs = node.fontSize;
            var effectiveLh = null;
            if (lh && typeof fs === 'number' && typeof lh === 'object' && typeof lh.value === 'number') {
              if (lh.unit === 'PIXELS') {
                effectiveLh = lh.value;
              } else if (lh.unit === 'PERCENT') {
                effectiveLh = fs * (lh.value / 100);
              }
            }
            if (effectiveLh !== null && effectiveLh < 1.5 * fs) {
              if (totalFindings < maxFindings) {
                findings['wcag-line-height'].push({
                  id: nodeId,
                  name: nodeName,
                  lineHeight: effectiveLh,
                  fontSize: fs,
                  recommended: (1.5 * fs).toFixed(1)
                });
                totalFindings++;
              } else {
                truncated = true;
              }
            }
          } catch (e) { /* slot sublayer or mixed */ }
        }

        // ---- Design System checks ----

        // hardcoded-color: Solid fills without variable binding or style
        if (activeRuleSet['hardcoded-color'] && !isPage && !isSection && !truncated) {
          try {
            var hcFills = node.fills;
            if (hcFills && hcFills.length > 0) {
              var hasFillStyle = false;
              try {
                hasFillStyle = node.fillStyleId && node.fillStyleId !== '';
              } catch (e) { /* mixed fill styles */ }

              if (!hasFillStyle) {
                for (var hci = 0; hci < hcFills.length; hci++) {
                  var hcFill = hcFills[hci];
                  if (hcFill.type === 'SOLID' && hcFill.visible !== false) {
                    var hasBoundVar = false;
                    try {
                      if (hcFill.boundVariables && hcFill.boundVariables.color) {
                        hasBoundVar = true;
                      }
                    } catch (e) { /* no bound vars */ }

                    if (!hasBoundVar) {
                      if (totalFindings < maxFindings) {
                        findings['hardcoded-color'].push({
                          id: nodeId,
                          name: nodeName,
                          color: lintRgbToHex(hcFill.color.r, hcFill.color.g, hcFill.color.b)
                        });
                        totalFindings++;
                      } else {
                        truncated = true;
                      }
                      break; // One finding per node
                    }
                  }
                }
              }
            }
          } catch (e) { /* slot sublayer */ }
        }

        // no-text-style: TEXT nodes without textStyleId
        if (activeRuleSet['no-text-style'] && nodeType === 'TEXT' && !truncated) {
          try {
            var hasTextStyle = node.textStyleId && node.textStyleId !== '';
            if (!hasTextStyle) {
              if (totalFindings < maxFindings) {
                findings['no-text-style'].push({
                  id: nodeId,
                  name: nodeName
                });
                totalFindings++;
              } else {
                truncated = true;
              }
            }
          } catch (e) { /* slot sublayer or mixed */ }
        }

        // default-name: Nodes with default Figma names
        if (activeRuleSet['default-name'] && !isPage && !truncated) {
          try {
            if (defaultNameRegex.test(nodeName)) {
              if (totalFindings < maxFindings) {
                findings['default-name'].push({
                  id: nodeId,
                  name: nodeName,
                  type: nodeType
                });
                totalFindings++;
              } else {
                truncated = true;
              }
            }
          } catch (e) { /* slot sublayer */ }
        }

        // detached-component: Frames with "/" in name but not component/instance
        if (activeRuleSet['detached-component'] && nodeType === 'FRAME' && !truncated) {
          try {
            if (nodeName.indexOf('/') !== -1) {
              if (totalFindings < maxFindings) {
                findings['detached-component'].push({
                  id: nodeId,
                  name: nodeName
                });
                totalFindings++;
              } else {
                truncated = true;
              }
            }
          } catch (e) { /* slot sublayer */ }
        }

        // ---- Layout checks ----

        // no-autolayout: Frames with 2+ children and no auto-layout
        if (activeRuleSet['no-autolayout'] && !isPage && !isSection && !truncated) {
          try {
            if (nodeType === 'FRAME' || nodeType === 'COMPONENT' || nodeType === 'COMPONENT_SET') {
              var childCount = 0;
              try { childCount = node.children ? node.children.length : 0; } catch (e) { /* skip */ }
              if (childCount >= 2) {
                var layoutMode = 'NONE';
                try { layoutMode = node.layoutMode; } catch (e) { /* skip */ }
                if (!layoutMode || layoutMode === 'NONE') {
                  if (totalFindings < maxFindings) {
                    findings['no-autolayout'].push({
                      id: nodeId,
                      name: nodeName,
                      childCount: childCount
                    });
                    totalFindings++;
                  } else {
                    truncated = true;
                  }
                }
              }
            }
          } catch (e) { /* slot sublayer */ }
        }

        // empty-container: Frames with zero children
        if (activeRuleSet['empty-container'] && !isPage && !isSection && !truncated) {
          try {
            if (nodeType === 'FRAME') {
              var ec = 0;
              try { ec = node.children ? node.children.length : 0; } catch (e) { /* skip */ }
              if (ec === 0) {
                if (totalFindings < maxFindings) {
                  findings['empty-container'].push({
                    id: nodeId,
                    name: nodeName
                  });
                  totalFindings++;
                } else {
                  truncated = true;
                }
              }
            }
          } catch (e) { /* slot sublayer */ }
        }

        // ---- Recurse into children ----
        try {
          if (node.children) {
            for (var ci = 0; ci < node.children.length; ci++) {
              if (truncated) break;
              walkNode(node.children[ci], depth + 1);
            }
          }
        } catch (e) { /* no children or slot sublayer */ }
      }

      // ---- Execute walk ----
      walkNode(rootNode, 0);

      // ---- Build response ----
      var categories = [];
      var summaryObj = { critical: 0, warning: 0, info: 0, total: 0 };

      for (var rk = 0; rk < allRuleIds.length; rk++) {
        var ruleId = allRuleIds[rk];
        if (!findings[ruleId] || findings[ruleId].length === 0) continue;
        var sev = severityMap[ruleId];
        categories.push({
          rule: ruleId,
          severity: sev,
          count: findings[ruleId].length,
          description: ruleDescriptions[ruleId],
          nodes: findings[ruleId]
        });
        summaryObj[sev] = (summaryObj[sev] || 0) + findings[ruleId].length;
        summaryObj.total += findings[ruleId].length;
      }

      var responseData = {
        rootNodeId: rootNode.id,
        rootNodeName: rootNode.name,
        nodesScanned: nodesScanned,
        categories: categories,
        summary: summaryObj
      };

      if (truncated) {
        responseData.warning = 'Showing first ' + maxFindings + ' findings...';
      }

      console.log('🌉 [Desktop Bridge] Lint complete: ' + summaryObj.total + ' findings across ' + nodesScanned + ' nodes');

      figma.ui.postMessage({
        type: 'LINT_DESIGN_RESULT',
        requestId: msg.requestId,
        success: true,
        data: responseData
      });

    } catch (error) {
      var errorMsg = error && error.message ? error.message : String(error);
      console.error('🌉 [Desktop Bridge] Lint design error:', errorMsg);
      figma.ui.postMessage({
        type: 'LINT_DESIGN_RESULT',
        requestId: msg.requestId,
        success: false,
        error: errorMsg
      });
    }
  }

  // ============================================================================
  // DEEP_GET_COMPONENT - Full recursive component extraction for code generation
  // ============================================================================
  else if (msg.type === 'DEEP_GET_COMPONENT') {
    try {
      var MAX_DEPTH_CAP = 20;
      var COMPONENT_PROPERTIES_CAP_BYTES = 10240;
      var MAX_TOKEN_ENTRIES = 500;
      var PAYLOAD_WARNING_KB = 512;

      var maxDepth = msg.depth || 10;
      if (maxDepth > MAX_DEPTH_CAP) maxDepth = MAX_DEPTH_CAP;
      console.log('🌉 [Desktop Bridge] Deep component fetch: ' + msg.nodeId + ' (depth: ' + maxDepth + ')');

      var rootNode = await figma.getNodeByIdAsync(msg.nodeId);
      if (!rootNode) {
        throw new Error('Node not found: ' + msg.nodeId);
      }

      // Build a variable name lookup map for resolving boundVariables
      var varNameMap = await buildVarNameMap();

      // Resolve boundVariables to token names
      function resolveBoundVars(bv) {
        if (!bv) return null;
        var resolved = {};
        var keys = Object.keys(bv);
        for (var k = 0; k < keys.length; k++) {
          var prop = keys[k];
          var binding = bv[prop];
          if (Array.isArray(binding)) {
            resolved[prop] = [];
            for (var bi = 0; bi < binding.length; bi++) {
              var b = binding[bi];
              if (b && b.id) {
                var info = varNameMap[b.id];
                resolved[prop].push(info ? { id: b.id, name: info.name, collection: info.collection, resolvedType: info.resolvedType, codeSyntax: info.codeSyntax } : { id: b.id });
              }
            }
          } else if (binding && binding.id) {
            var info = varNameMap[binding.id];
            resolved[prop] = info ? { id: binding.id, name: info.name, collection: info.collection, resolvedType: info.resolvedType, codeSyntax: info.codeSyntax } : { id: binding.id };
          }
        }
        return Object.keys(resolved).length > 0 ? resolved : null;
      }

      // P3b: Hardcoded value detection accumulators
      var varsUsed = [];
      var hardcodedValues = [];

      // Geometry-eligible node types (P3a: fillGeometry restriction)
      var geometryTypes = { VECTOR: 1, BOOLEAN_OPERATION: 1, LINE: 1, REGULAR_POLYGON: 1, STAR: 1, ELLIPSE: 1 };

      // Check if paint array (fills/strokes) properties are tokenized or hardcoded
      function checkPaintTokenization(paints, paintBv, propertyName, nodePath) {
        for (var pi = 0; pi < paints.length; pi++) {
          if (paints[pi].type === 'SOLID' && paints[pi].visible !== false) {
            if (paintBv && (Array.isArray(paintBv) ? paintBv[pi] : paintBv)) {
              var varRef = Array.isArray(paintBv) ? paintBv[pi] : paintBv;
              if (varRef && varRef.id) {
                var vi = varNameMap[varRef.id];
                varsUsed.push({ variableId: varRef.id, variableName: vi ? vi.name : varRef.id, property: propertyName, nodePath: nodePath });
              }
            } else {
              var color = paints[pi].color;
              if (color) {
                hardcodedValues.push({ property: propertyName, value: figmaRGBToHex(color), nodePath: nodePath });
              }
            }
          }
        }
      }

      // Extract visual properties from a node
      function extractNodeProps(n, nodePath) {
        var props = {};

        if (n.layoutMode) props.layoutMode = n.layoutMode;
        if (n.primaryAxisSizingMode) props.primaryAxisSizingMode = n.primaryAxisSizingMode;
        if (n.counterAxisSizingMode) props.counterAxisSizingMode = n.counterAxisSizingMode;
        if (n.layoutSizingHorizontal) props.layoutSizingHorizontal = n.layoutSizingHorizontal;
        if (n.layoutSizingVertical) props.layoutSizingVertical = n.layoutSizingVertical;
        if (n.primaryAxisAlignItems) props.primaryAxisAlignItems = n.primaryAxisAlignItems;
        if (n.counterAxisAlignItems) props.counterAxisAlignItems = n.counterAxisAlignItems;
        if (n.paddingLeft !== undefined && n.paddingLeft !== 0) props.paddingLeft = n.paddingLeft;
        if (n.paddingRight !== undefined && n.paddingRight !== 0) props.paddingRight = n.paddingRight;
        if (n.paddingTop !== undefined && n.paddingTop !== 0) props.paddingTop = n.paddingTop;
        if (n.paddingBottom !== undefined && n.paddingBottom !== 0) props.paddingBottom = n.paddingBottom;
        if (n.itemSpacing !== undefined && n.itemSpacing !== 0) props.itemSpacing = n.itemSpacing;
        if (n.counterAxisSpacing !== undefined && n.counterAxisSpacing !== 0) props.counterAxisSpacing = n.counterAxisSpacing;
        if (n.layoutWrap && n.layoutWrap !== 'NO_WRAP') props.layoutWrap = n.layoutWrap;
        if (n.minWidth !== undefined) props.minWidth = n.minWidth;
        if (n.maxWidth !== undefined) props.maxWidth = n.maxWidth;
        if (n.minHeight !== undefined) props.minHeight = n.minHeight;
        if (n.maxHeight !== undefined) props.maxHeight = n.maxHeight;
        if (n.clipsContent) props.clipsContent = true;

        // Visual
        var bv = null;
        try { bv = n.boundVariables || null; } catch (e) {}

        try {
          if (n.fills && n.fills !== figma.mixed && n.fills.length > 0) {
            props.fills = n.fills;
            checkPaintTokenization(n.fills, bv && bv.fills, 'fill', nodePath);
          }
        } catch (e) { /* mixed fills */ }
        try {
          if (n.strokes && n.strokes !== figma.mixed && n.strokes.length > 0) {
            props.strokes = n.strokes;
            checkPaintTokenization(n.strokes, bv && bv.strokes, 'stroke', nodePath);
          }
        } catch (e) {}
        if (n.strokeWeight !== undefined && n.strokeWeight !== 0 && n.strokeWeight !== figma.mixed) props.strokeWeight = n.strokeWeight;
        if (n.cornerRadius !== undefined && n.cornerRadius !== 0 && n.cornerRadius !== figma.mixed) props.cornerRadius = n.cornerRadius;
        try {
          if (n.effects && n.effects.length > 0) props.effects = n.effects;
        } catch (e) {}
        if (n.opacity !== undefined && n.opacity < 1) props.opacity = n.opacity;

        // P3a: fillGeometry/strokeGeometry only for vector-like nodes
        if (geometryTypes[n.type]) {
          try { if (n.fillGeometry && n.fillGeometry.length > 0) props.fillGeometry = n.fillGeometry; } catch (e) {}
          try { if (n.strokeGeometry && n.strokeGeometry.length > 0) props.strokeGeometry = n.strokeGeometry; } catch (e) {}
        }

        // P3b: spacing/sizing token check
        var spacingProps = ['itemSpacing', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'cornerRadius'];
        for (var sp = 0; sp < spacingProps.length; sp++) {
          var spProp = spacingProps[sp];
          if (n[spProp] !== undefined && n[spProp] !== 0 && n[spProp] !== figma.mixed) {
            if (bv && bv[spProp] && bv[spProp].id) {
              var spInfo = varNameMap[bv[spProp].id];
              varsUsed.push({ variableId: bv[spProp].id, variableName: spInfo ? spInfo.name : bv[spProp].id, property: spProp, nodePath: nodePath });
            } else if (!bv || !bv[spProp]) {
              hardcodedValues.push({ property: spProp, value: n[spProp], nodePath: nodePath });
            }
          }
        }

        // Typography
        if (n.type === 'TEXT') {
          try { props.characters = n.characters; } catch (e) {}
          try { if (n.fontSize !== figma.mixed) props.fontSize = n.fontSize; } catch (e) {}
          try { if (n.fontName !== figma.mixed) { props.fontFamily = n.fontName.family; props.fontStyle = n.fontName.style; } } catch (e) {}
          try { if (n.fontWeight !== figma.mixed) props.fontWeight = n.fontWeight; } catch (e) {}
          try { if (n.lineHeight !== figma.mixed) props.lineHeight = n.lineHeight; } catch (e) {}
          try { if (n.letterSpacing !== figma.mixed) props.letterSpacing = n.letterSpacing; } catch (e) {}
          try { if (n.textAlignHorizontal) props.textAlignHorizontal = n.textAlignHorizontal; } catch (e) {}
          try { if (n.textAlignVertical) props.textAlignVertical = n.textAlignVertical; } catch (e) {}
          try { if (n.textAutoResize && n.textAutoResize !== 'NONE') props.textAutoResize = n.textAutoResize; } catch (e) {}
          try { if (n.textTruncation && n.textTruncation !== 'DISABLED') props.textTruncation = n.textTruncation; } catch (e) {}
          try { if (n.textCase && n.textCase !== 'ORIGINAL') props.textCase = n.textCase; } catch (e) {}
          try { if (n.textDecoration && n.textDecoration !== 'NONE') props.textDecoration = n.textDecoration; } catch (e) {}
        }

        // Design tokens (resolved to names)
        try {
          var resolved = resolveBoundVars(bv);
          if (resolved) props.boundVariables = resolved;
        } catch (e) {}

        // Prototype interactions
        try {
          if (n.reactions && n.reactions.length > 0) {
            props.reactions = n.reactions.map(function(r) {
              var reaction = { trigger: r.trigger };
              if (r.action) {
                reaction.action = { type: r.action.type };
                if (r.action.navigation) reaction.action.navigation = r.action.navigation;
                if (r.action.transition) reaction.action.transition = r.action.transition;
                if (r.action.destinationId) reaction.action.destinationId = r.action.destinationId;
              }
              return reaction;
            });
          }
        } catch (e) {}

        // Annotations
        try {
          if (n.annotations && n.annotations.length > 0) {
            props.annotations = n.annotations.map(function(a) {
              var ann = {};
              if (a.labelMarkdown) ann.labelMarkdown = a.labelMarkdown;
              else if (a.label) ann.label = a.label;
              if (a.properties) ann.properties = a.properties;
              if (a.categoryId) ann.categoryId = a.categoryId;
              return ann;
            });
          }
        } catch (e) {}

        // Component instance reference
        if (n.type === 'INSTANCE') {
          try {
            if (n.mainComponent) {
              props.mainComponent = {
                id: n.mainComponent.id,
                name: n.mainComponent.name,
                key: n.mainComponent.key || null,
                isVariant: n.mainComponent.parent && n.mainComponent.parent.type === 'COMPONENT_SET'
              };
              if (props.mainComponent.isVariant && n.mainComponent.parent) {
                props.mainComponent.componentSetName = n.mainComponent.parent.name;
                props.mainComponent.componentSetId = n.mainComponent.parent.id;
              }
            }
          } catch (e) {}
          // P3a: componentProperties cap at 10KB
          try {
            if (n.componentProperties) {
              var cpStr = JSON.stringify(n.componentProperties);
              if (cpStr.length > COMPONENT_PROPERTIES_CAP_BYTES) {
                var truncated = {};
                var cpKeys = Object.keys(n.componentProperties);
                for (var cpk = 0; cpk < cpKeys.length; cpk++) {
                  var cpVal = n.componentProperties[cpKeys[cpk]];
                  truncated[cpKeys[cpk]] = { type: cpVal.type, value: String(cpVal.value).substring(0, 50) };
                }
                props.componentProperties = truncated;
                props._componentPropertiesTruncated = true;
              } else {
                props.componentProperties = n.componentProperties;
              }
            }
          } catch (e) {}
        }

        // Component definitions (for COMPONENT and COMPONENT_SET)
        if (n.type === 'COMPONENT_SET' || n.type === 'COMPONENT') {
          try {
            if (n.componentPropertyDefinitions) props.componentPropertyDefinitions = n.componentPropertyDefinitions;
          } catch (e) {}
          if (n.type === 'COMPONENT' && n.variantProperties) {
            props.variantProperties = n.variantProperties;
          }
        }

        // Dimensions
        try {
          props.width = Math.round(n.width);
          props.height = Math.round(n.height);
        } catch (e) {}

        return props;
      }

      // Recursive tree walker
      function walkNode(n, currentDepth, parentPath) {
        var nodePath = parentPath ? parentPath + ' > ' + (n.name || n.id) : (n.name || n.id);
        var nodeData = {
          id: n.id,
          name: n.name,
          type: n.type,
          visible: n.visible
        };

        // Skip invisible nodes (unless they're component set variants)
        if (!n.visible && n.type !== 'COMPONENT') {
          nodeData._hidden = true;
          return nodeData;
        }

        // Extract all properties
        var props = extractNodeProps(n, nodePath);
        var propKeys = Object.keys(props);
        for (var pk = 0; pk < propKeys.length; pk++) {
          nodeData[propKeys[pk]] = props[propKeys[pk]];
        }

        // Recurse into children
        if (n.children && currentDepth < maxDepth) {
          nodeData.children = [];
          for (var i = 0; i < n.children.length; i++) {
            try {
              nodeData.children.push(walkNode(n.children[i], currentDepth + 1, nodePath));
            } catch (e) {
              // Skip inaccessible slot sublayers
            }
          }
        } else if (n.children) {
          // At max depth, include lightweight child summary
          nodeData.childCount = n.children.length;
          nodeData._depthLimitReached = true;
        }

        return nodeData;
      }

      var result = walkNode(rootNode, 0, '');
      result._variableMapSize = Object.keys(varNameMap).length;
      result._maxDepthUsed = maxDepth;

      // P3b: attach token coverage metrics
      var totalProps = varsUsed.length + hardcodedValues.length;
      // Cap token coverage arrays to prevent oversized payloads
      var maxTokenEntries = MAX_TOKEN_ENTRIES;
      if (varsUsed.length > maxTokenEntries) {
        result.variables_used = varsUsed.slice(0, maxTokenEntries);
        result._variablesUsedTruncated = true;
      } else {
        result.variables_used = varsUsed;
      }
      if (hardcodedValues.length > maxTokenEntries) {
        result.hardcoded_values = hardcodedValues.slice(0, maxTokenEntries);
        result._hardcodedValuesTruncated = true;
      } else {
        result.hardcoded_values = hardcodedValues;
      }
      result.token_coverage = totalProps > 0 ? Math.round((varsUsed.length / totalProps) * 100) : 100;

      var resultJson = JSON.stringify(result);
      var resultSizeKB = Math.round(resultJson.length / 1024);
      console.log('🌉 [Desktop Bridge] Deep component data: ' + resultSizeKB + 'KB, vars resolved: ' + Object.keys(varNameMap).length + ', token coverage: ' + result.token_coverage + '%');

      // Warn if payload is very large (>512KB)
      if (resultSizeKB > PAYLOAD_WARNING_KB) {
        result._payloadWarning = 'Response is ' + resultSizeKB + 'KB. Consider using a smaller depth or targeting a sub-node.';
      }

      figma.ui.postMessage({
        type: 'DEEP_GET_COMPONENT_RESULT',
        requestId: msg.requestId,
        success: true,
        data: result
      });

    } catch (error) {
      var errorMsg = error && error.message ? error.message : String(error);
      console.error('🌉 [Desktop Bridge] Deep component error:', errorMsg);
      figma.ui.postMessage({
        type: 'DEEP_GET_COMPONENT_RESULT',
        requestId: msg.requestId,
        success: false,
        error: errorMsg
      });
    }
  }

  // ============================================================================
  // ANALYZE_COMPONENT_SET - Variant state machine + cross-variant diff
  // ============================================================================
  else if (msg.type === 'ANALYZE_COMPONENT_SET') {
    try {
      console.log('🌉 [Desktop Bridge] Analyzing component set: ' + msg.nodeId);

      var node = await figma.getNodeByIdAsync(msg.nodeId);
      if (!node) throw new Error('Node not found: ' + msg.nodeId);
      if (node.type !== 'COMPONENT_SET') throw new Error('Node is not a COMPONENT_SET. Type: ' + node.type);

      // Build variable name lookup
      var varNameMap = await buildVarNameMap();

      function resolveVarId(id) {
        return varNameMap[id] ? varNameMap[id].name : id;
      }

      function resolveBoundColor(bv) {
        if (!bv) return null;
        if (Array.isArray(bv)) {
          return bv.length > 0 && bv[0].id ? resolveVarId(bv[0].id) : null;
        }
        if (bv.id) return resolveVarId(bv.id);
        if (bv.color && bv.color.id) return resolveVarId(bv.color.id);
        return null;
      }

      // Extract visual signature from a variant for diffing
      function extractSignature(variant) {
        var sig = {};
        var mainChild = null;
        if (variant.children) {
          for (var i = 0; i < variant.children.length; i++) {
            var child = variant.children[i];
            try {
              if (child.visible !== false && child.type !== 'TEXT' && child.strokes && child.strokes.length > 0) {
                mainChild = child;
                break;
              }
            } catch(e) {}
          }
          if (!mainChild) {
            for (var i2 = 0; i2 < variant.children.length; i2++) {
              var c2 = variant.children[i2];
              try {
                if (c2.visible !== false && c2.type === 'FRAME') {
                  mainChild = c2;
                  break;
                }
              } catch(e) {}
            }
          }
        }

        if (mainChild) {
          var child = mainChild;
          try {
            var bv = child.boundVariables || {};
            sig.fillToken = resolveBoundColor(bv.fills);
            sig.strokeToken = resolveBoundColor(bv.strokes);
            sig.strokeWeight = child.strokeWeight;
            if (!sig.fillToken && child.fills && child.fills.length > 0 && child.fills[0].color) {
              var fc = child.fills[0].color;
              sig.fillHex = figmaRGBToHex(fc);
            }
            if (!sig.strokeToken && child.strokes && child.strokes.length > 0 && child.strokes[0].color) {
              var sc = child.strokes[0].color;
              sig.strokeHex = figmaRGBToHex(sc);
            }
            sig.effects = child.effects && child.effects.length > 0 ? child.effects : null;
            sig.opacity = child.opacity < 1 ? child.opacity : null;
          } catch(e) {}

          if (child.children) {
            for (var t = 0; t < child.children.length; t++) {
              var textChild = child.children[t];
              if (textChild.type === 'TEXT') {
                try {
                  var tbv = textChild.boundVariables || {};
                  sig.textToken = resolveBoundColor(tbv.fills);
                  if (!sig.textToken && textChild.fills && textChild.fills.length > 0 && textChild.fills[0].color) {
                    var tc = textChild.fills[0].color;
                    sig.textHex = figmaRGBToHex(tc);
                  }
                } catch(e) {}
                break;
              }
            }
          }
        }

        sig.visibilityChanges = {};
        if (variant.children) {
          for (var j = 0; j < variant.children.length; j++) {
            var ch = variant.children[j];
            try {
              if (!ch.visible) sig.visibilityChanges[ch.name] = false;
            } catch(e) {}
          }
        }

        return sig;
      }

      // Parse variant property definitions
      var propDefs = node.componentPropertyDefinitions || {};
      var variantAxes = {};
      var componentProps = {};
      var propKeys = Object.keys(propDefs);
      for (var pk = 0; pk < propKeys.length; pk++) {
        var propKey = propKeys[pk];
        var propDef = propDefs[propKey];
        if (propDef.type === 'VARIANT') {
          variantAxes[propKey] = propDef.variantOptions || [];
        } else {
          componentProps[propKey] = { type: propDef.type, defaultValue: propDef.defaultValue };
        }
      }

      // CSS pseudo-class mapping for state variants
      var stateMapping = {
        'default': null,
        'hover': ':hover',
        'focus': ':focus-visible',
        'focus-visible': ':focus-visible',
        'focused': ':focus-visible',
        'active': ':active',
        'pressed': ':active',
        'disabled': ':disabled, [aria-disabled="true"]',
        'error': '[aria-invalid="true"]',
        'invalid': '[aria-invalid="true"]',
        'filled': '.has-value',
        'selected': '[aria-selected="true"]',
        'checked': ':checked',
        'loading': '[aria-busy="true"]',
        'readonly': '[readonly]',
        'open': '[aria-expanded="true"]',
        'closed': '[aria-expanded="false"]'
      };

      var variants = node.children || [];
      var defaultVariant = null;
      var stateAxis = null;
      var sizeAxis = null;

      var axisKeys = Object.keys(variantAxes);
      for (var ak = 0; ak < axisKeys.length; ak++) {
        var axisName = axisKeys[ak].toLowerCase();
        if (axisName === 'state' || axisName === 'status' || axisName === 'interaction') {
          stateAxis = axisKeys[ak];
        } else if (axisName === 'size' || axisName === 'scale') {
          sizeAxis = axisKeys[ak];
        }
      }

      var stateMachine = { states: {}, defaultState: null, cssMapping: {} };
      var defaultSig = null;

      for (var di = 0; di < variants.length; di++) {
        var vName = variants[di].name;
        var lowerName = vName.toLowerCase();
        if (lowerName.indexOf('state=default') !== -1 && (sizeAxis ? vName.indexOf(sizeAxis + '=') !== -1 : true)) {
          if (!defaultVariant || lowerName.indexOf('large') !== -1) {
            defaultVariant = variants[di];
          }
        }
      }
      if (defaultVariant) {
        defaultSig = extractSignature(defaultVariant);
      }

      var variantDiffs = [];
      for (var vdi = 0; vdi < variants.length; vdi++) {
        var variant = variants[vdi];
        var sig = extractSignature(variant);

        var axisParts = variant.name.split(', ');
        var axisValues = {};
        for (var ap = 0; ap < axisParts.length; ap++) {
          var parts = axisParts[ap].split('=');
          if (parts.length === 2) axisValues[parts[0].trim()] = parts[1].trim();
        }

        var stateValue = stateAxis ? (axisValues[stateAxis] || 'default') : 'default';
        var cssSelector = stateMapping[stateValue.toLowerCase()] || null;

        var diff = {};
        if (defaultSig && variant.id !== (defaultVariant ? defaultVariant.id : null)) {
          if (sig.fillToken !== defaultSig.fillToken) diff.fillToken = sig.fillToken || sig.fillHex;
          if (sig.strokeToken !== defaultSig.strokeToken) diff.strokeToken = sig.strokeToken || sig.strokeHex;
          if (sig.strokeWeight !== defaultSig.strokeWeight) diff.strokeWeight = sig.strokeWeight;
          if (sig.textToken !== defaultSig.textToken) diff.textToken = sig.textToken || sig.textHex;
          if (sig.opacity !== defaultSig.opacity) diff.opacity = sig.opacity;
          if (JSON.stringify(sig.effects) !== JSON.stringify(defaultSig.effects)) diff.effects = sig.effects;
          var svKeys = Object.keys(sig.visibilityChanges);
          for (var sk = 0; sk < svKeys.length; sk++) {
            if (!defaultSig.visibilityChanges[svKeys[sk]]) {
              if (!diff.visibilityChanges) diff.visibilityChanges = {};
              diff.visibilityChanges[svKeys[sk]] = sig.visibilityChanges[svKeys[sk]];
            }
          }
        }

        variantDiffs.push({
          name: variant.name,
          id: variant.id,
          axes: axisValues,
          state: stateValue,
          cssSelector: cssSelector,
          diffFromDefault: Object.keys(diff).length > 0 ? diff : null,
          signature: sig
        });

        if (cssSelector) {
          stateMachine.cssMapping[stateValue] = cssSelector;
        }
        if (!stateMachine.states[stateValue]) {
          stateMachine.states[stateValue] = [];
        }
        stateMachine.states[stateValue].push(variant.id);
      }

      if (defaultVariant) {
        stateMachine.defaultState = 'default';
        stateMachine.defaultSignature = defaultSig;
      }

      var result = {
        nodeId: node.id,
        nodeName: node.name,
        variantCount: variants.length,
        variantAxes: variantAxes,
        componentProps: componentProps,
        stateMachine: stateMachine,
        variants: variantDiffs,
        ai_instruction: 'Use cssMapping to implement interaction states. diffFromDefault shows only what changes per state — apply these as CSS pseudo-class or attribute overrides. componentProps maps to React/Vue component props (BOOLEAN → boolean prop, TEXT → string prop, INSTANCE_SWAP → ReactNode/slot prop).'
      };

      console.log('🌉 [Desktop Bridge] Component set analysis complete. ' + variants.length + ' variants, ' + Object.keys(stateMachine.cssMapping).length + ' CSS mappings');

      figma.ui.postMessage({
        type: 'ANALYZE_COMPONENT_SET_RESULT',
        requestId: msg.requestId,
        success: true,
        data: result
      });

    } catch (error) {
      var errorMsg = error && error.message ? error.message : String(error);
      console.error('🌉 [Desktop Bridge] Analyze component set error:', errorMsg);
      figma.ui.postMessage({
        type: 'ANALYZE_COMPONENT_SET_RESULT',
        requestId: msg.requestId,
        success: false,
        error: errorMsg
      });
    }
  }

  // ============================================================================
  // GET_ANNOTATIONS - Read annotations from a node (and optionally children)
  // ============================================================================
  else if (msg.type === 'GET_ANNOTATIONS') {
    try {
      console.log('🌉 [Desktop Bridge] Getting annotations for node:', msg.nodeId);

      var node = await figma.getNodeByIdAsync(msg.nodeId);
      if (!node) {
        throw new Error('Node not found: ' + msg.nodeId);
      }

      var categories = [];
      try {
        categories = await figma.annotations.getAnnotationCategoriesAsync();
      } catch (e) {
        console.log('🌉 [Desktop Bridge] Could not fetch annotation categories:', e.message);
      }

      var categoryMap = {};
      for (var ci = 0; ci < categories.length; ci++) {
        categoryMap[categories[ci].id] = categories[ci].name;
      }

      function extractAnnotations(n) {
        var anns = n.annotations || [];
        var result = [];
        for (var ai = 0; ai < anns.length; ai++) {
          var ann = anns[ai];
          var props = [];
          if (ann.properties) {
            for (var pi = 0; pi < ann.properties.length; pi++) {
              props.push({ type: ann.properties[pi].type });
            }
          }
          result.push({
            label: ann.label || null,
            labelMarkdown: ann.labelMarkdown || null,
            properties: props.length > 0 ? props : null,
            categoryId: ann.categoryId || null,
            categoryName: ann.categoryId && categoryMap[ann.categoryId] ? categoryMap[ann.categoryId] : null
          });
        }
        return result;
      }

      var nodeAnnotations = extractAnnotations(node);
      var childAnnotations = [];

      var includeChildren = msg.includeChildren || false;
      var maxDepth = msg.depth || 1;
      if (maxDepth > 10) maxDepth = 10;

      if (includeChildren && 'children' in node && node.children) {
        function walkChildren(parent, currentDepth) {
          if (currentDepth > maxDepth) return;
          for (var i = 0; i < parent.children.length; i++) {
            var child = parent.children[i];
            try {
              var anns = extractAnnotations(child);
              if (anns.length > 0) {
                childAnnotations.push({
                  nodeId: child.id,
                  nodeName: child.name,
                  nodeType: child.type,
                  annotations: anns
                });
              }
              if ('children' in child && child.children) {
                walkChildren(child, currentDepth + 1);
              }
            } catch (e) {}
          }
        }
        walkChildren(node, 1);
      }

      var result = {
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
        annotations: nodeAnnotations,
        annotationCount: nodeAnnotations.length,
        children: includeChildren ? childAnnotations : undefined,
        childAnnotationCount: includeChildren ? childAnnotations.reduce(function(sum, c) { return sum + c.annotations.length; }, 0) : undefined,
        availableCategories: categories.map(function(c) { return { id: c.id, name: c.name }; })
      };

      console.log('🌉 [Desktop Bridge] Annotations retrieved. Node: ' + nodeAnnotations.length + ', Children: ' + (childAnnotations.length || 0));

      figma.ui.postMessage({
        type: 'GET_ANNOTATIONS_RESULT',
        requestId: msg.requestId,
        success: true,
        data: result
      });

    } catch (error) {
      var errorMsg = error && error.message ? error.message : String(error);
      console.error('🌉 [Desktop Bridge] Get annotations error:', errorMsg);
      figma.ui.postMessage({
        type: 'GET_ANNOTATIONS_RESULT',
        requestId: msg.requestId,
        success: false,
        error: errorMsg
      });
    }
  }

  // ============================================================================
  // SET_ANNOTATIONS - Write annotations to a node
  // ============================================================================
  else if (msg.type === 'SET_ANNOTATIONS') {
    try {
      console.log('🌉 [Desktop Bridge] Setting annotations on node:', msg.nodeId);

      var node = await figma.getNodeByIdAsync(msg.nodeId);
      if (!node) {
        throw new Error('Node not found: ' + msg.nodeId);
      }

      if (!('annotations' in node)) {
        throw new Error('Node type ' + node.type + ' does not support annotations');
      }

      var newAnnotations = [];
      var inputAnnotations = msg.annotations || [];

      for (var i = 0; i < inputAnnotations.length; i++) {
        var input = inputAnnotations[i];
        var ann = {};

        if (input.label) {
          ann.label = input.label;
        }
        if (input.labelMarkdown) {
          ann.labelMarkdown = input.labelMarkdown;
        }
        if (input.properties && input.properties.length > 0) {
          ann.properties = [];
          for (var p = 0; p < input.properties.length; p++) {
            ann.properties.push({ type: input.properties[p].type });
          }
        }
        if (input.categoryId) {
          ann.categoryId = input.categoryId;
        }

        newAnnotations.push(ann);
      }

      var annotationMode = msg.mode || 'replace';
      if (annotationMode === 'append') {
        var existing = node.annotations || [];
        var merged = [];
        for (var e = 0; e < existing.length; e++) {
          var ex = existing[e];
          var copy = {};
          if (ex.label) copy.label = ex.label;
          if (ex.labelMarkdown) copy.labelMarkdown = ex.labelMarkdown;
          if (ex.properties) copy.properties = ex.properties;
          if (ex.categoryId) copy.categoryId = ex.categoryId;
          merged.push(copy);
        }
        for (var n = 0; n < newAnnotations.length; n++) {
          merged.push(newAnnotations[n]);
        }
        newAnnotations = merged;
      }

      node.annotations = newAnnotations;

      console.log('🌉 [Desktop Bridge] Annotations set successfully. Count: ' + newAnnotations.length);

      figma.ui.postMessage({
        type: 'SET_ANNOTATIONS_RESULT',
        requestId: msg.requestId,
        success: true,
        data: {
          nodeId: node.id,
          nodeName: node.name,
          annotationCount: newAnnotations.length,
          mode: annotationMode
        }
      });

    } catch (error) {
      var errorMsg = error && error.message ? error.message : String(error);
      console.error('🌉 [Desktop Bridge] Set annotations error:', errorMsg);
      figma.ui.postMessage({
        type: 'SET_ANNOTATIONS_RESULT',
        requestId: msg.requestId,
        success: false,
        error: errorMsg
      });
    }
  }

  // ============================================================================
  // GET_ANNOTATION_CATEGORIES - List available annotation categories
  // ============================================================================
  else if (msg.type === 'GET_ANNOTATION_CATEGORIES') {
    try {
      console.log('🌉 [Desktop Bridge] Fetching annotation categories');

      var categories = await figma.annotations.getAnnotationCategoriesAsync();
      // Figma plugin API shapes differ across versions — try label/name/title.
      // Always return a readable `name` field so the agent doesn't have to expose raw IDs like "51:0".
      var result = categories.map(function(c) {
        var readable = c.label || c.name || c.title || '';
        if (!readable) readable = 'Category ' + c.id;
        return { id: c.id, name: readable, label: readable, color: c.color || null };
      });

      console.log('🌉 [Desktop Bridge] Found ' + result.length + ' annotation categories');

      figma.ui.postMessage({
        type: 'GET_ANNOTATION_CATEGORIES_RESULT',
        requestId: msg.requestId,
        success: true,
        data: { categories: result }
      });

    } catch (error) {
      var errorMsg = error && error.message ? error.message : String(error);
      console.error('🌉 [Desktop Bridge] Get annotation categories error:', errorMsg);
      figma.ui.postMessage({
        type: 'GET_ANNOTATION_CATEGORIES_RESULT',
        requestId: msg.requestId,
        success: false,
        error: errorMsg
      });
    }
  }

  // ============================================================================
  // CREATE_FROM_JSX - Render a JSX TreeNode tree as Figma nodes
  // ============================================================================
  else if (msg.type === 'CREATE_FROM_JSX') {
    const { tree, x, y, parentId, requestId } = msg;
    try {
      const parent = parentId ? await figma.getNodeByIdAsync(parentId) : figma.currentPage;
      const rootNode = await createNodeFromTree(tree, parent);
      if (x !== undefined) rootNode.x = x;
      if (y !== undefined) rootNode.y = y;
      figma.viewport.scrollAndZoomIntoView([rootNode]);
      const childIds = [];
      function collectIds(n) { childIds.push(n.id); if ('children' in n) n.children.forEach(collectIds); }
      collectIds(rootNode);
      figma.ui.postMessage({ type: 'CREATE_FROM_JSX_RESULT', success: true, requestId, nodeId: rootNode.id, childIds });
    } catch (e) {
      figma.ui.postMessage({ type: 'CREATE_FROM_JSX_RESULT', success: false, requestId, error: e.message });
    }
  }

  // ============================================================================
  // CREATE_ICON - Create an icon from SVG data
  // ============================================================================
  else if (msg.type === 'CREATE_ICON') {
    const { svg, size, color, x, y, parentId, requestId } = msg;
    try {
      const node = figma.createNodeFromSvg(svg);
      node.resize(size, size);
      const vectors = node.findAll(n => n.type === 'VECTOR');
      vectors.forEach(v => {
        v.fills = [{ type: 'SOLID', color: hexToFigmaRGB(color) }];
      });
      const parent = parentId ? await figma.getNodeByIdAsync(parentId) : figma.currentPage;
      if (parent && parent !== figma.currentPage) parent.appendChild(node);
      if (x !== undefined) node.x = x;
      if (y !== undefined) node.y = y;
      figma.ui.postMessage({ type: 'CREATE_ICON_RESULT', success: true, requestId, nodeId: node.id });
    } catch (e) {
      figma.ui.postMessage({ type: 'CREATE_ICON_RESULT', success: false, requestId, error: e.message });
    }
  }

  // ============================================================================
  // BIND_VARIABLE - Bind a node property to a design token variable
  // ============================================================================
  else if (msg.type === 'BIND_VARIABLE') {
    const { nodeId, variableName, property, requestId } = msg;
    try {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) throw new Error('Node ' + nodeId + ' not found');
      if (property === 'fill' && 'fills' in node) {
        const variables = await figma.variables.getLocalVariablesAsync('COLOR');
        const variable = variables.find(v => v.name === variableName);
        if (!variable) throw new Error('COLOR variable "' + variableName + '" not found');
        const fills = [...node.fills];
        for (let i = 0; i < fills.length; i++) {
          if (fills[i].type === 'SOLID') {
            fills[i] = figma.variables.setBoundVariableForPaint(fills[i], 'color', variable);
          }
        }
        node.fills = fills;
      } else if (property === 'stroke' && 'strokes' in node) {
        const variables = await figma.variables.getLocalVariablesAsync('COLOR');
        const variable = variables.find(v => v.name === variableName);
        if (!variable) throw new Error('COLOR variable "' + variableName + '" not found');
        const strokes = [...node.strokes];
        for (let i = 0; i < strokes.length; i++) {
          if (strokes[i].type === 'SOLID') {
            strokes[i] = figma.variables.setBoundVariableForPaint(strokes[i], 'color', variable);
          }
        }
        node.strokes = strokes;
      } else {
        // FLOAT property binding (padding, gap, radius, fontSize, etc.)
        const floatProperties = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'itemSpacing', 'counterAxisSpacing', 'cornerRadius', 'fontSize', 'lineHeight', 'strokeWeight'];
        if (floatProperties.includes(property)) {
          const allVars = await figma.variables.getLocalVariablesAsync('FLOAT');
          const floatVar = allVars.find(v => v.name === variableName);
          if (!floatVar) throw new Error('FLOAT variable "' + variableName + '" not found');
          node.setBoundVariable(property, floatVar);
        } else {
          throw new Error('Unsupported property: ' + property + '. Supported: fill, stroke, ' + floatProperties.join(', '));
        }
      }
      figma.ui.postMessage({ type: 'BIND_VARIABLE_RESULT', success: true, requestId });
    } catch (e) {
      figma.ui.postMessage({ type: 'BIND_VARIABLE_RESULT', success: false, requestId, error: e.message });
    }
  }

  // ── BATCH OPERATIONS ──────────────────────────────────────────────────────

  // BATCH_SET_TEXT - Update text content on multiple nodes
  else if (msg.type === 'BATCH_SET_TEXT') {
    runBatch(msg.requestId, msg.updates, 'BATCH_SET_TEXT_RESULT', 'text nodes', async function(upd) {
      const node = await figma.getNodeByIdAsync(upd.nodeId);
      if (!node || node.type !== 'TEXT') throw new Error('Not a text node');
      // Load all required fonts BEFORE any mutations to avoid partial state on error
      var currentStyle = (node.fontName !== figma.mixed) ? node.fontName.style : 'Regular';
      if (upd.fontFamily) {
        await figma.loadFontAsync({ family: upd.fontFamily, style: currentStyle });
      }
      if (node.fontName === figma.mixed) {
        var len = node.characters.length;
        for (var fi = 0; fi < len; fi++) { await figma.loadFontAsync(node.getRangeFontName(fi, fi + 1)); }
      } else {
        await figma.loadFontAsync(node.fontName);
      }
      // All fonts loaded — safe to mutate
      node.characters = upd.text;
      if (upd.fontSize) node.fontSize = upd.fontSize;
      if (upd.fontFamily) {
        node.fontName = { family: upd.fontFamily, style: currentStyle };
      }
    });
  }

  // BATCH_SET_FILLS - Set fill colors on multiple nodes
  else if (msg.type === 'BATCH_SET_FILLS') {
    runBatch(msg.requestId, msg.updates, 'BATCH_SET_FILLS_RESULT', 'fills', async function(upd) {
      const node = await figma.getNodeByIdAsync(upd.nodeId);
      if (!node || !('fills' in node)) throw new Error('Node has no fills property');
      node.fills = upd.fills.map(function(f) {
        if (f.type === 'SOLID' && typeof f.color === 'string') {
          const rgb = hexToFigmaRGB(f.color);
          var opacity = f.opacity !== undefined ? f.opacity : (rgb.a !== undefined ? rgb.a : 1);
          return { type: 'SOLID', color: { r: rgb.r, g: rgb.g, b: rgb.b }, opacity: opacity };
        }
        return f;
      });
    });
  }

  // BATCH_TRANSFORM - Move and/or resize multiple nodes
  else if (msg.type === 'BATCH_TRANSFORM') {
    runBatch(msg.requestId, msg.updates, 'BATCH_TRANSFORM_RESULT', 'nodes', async function(upd) {
      const node = await figma.getNodeByIdAsync(upd.nodeId);
      if (!node) throw new Error('Node not found');
      if (upd.x !== undefined) node.x = upd.x;
      if (upd.y !== undefined) node.y = upd.y;
      if (upd.width !== undefined && upd.height !== undefined) {
        node.resize(upd.width, upd.height);
      } else if (upd.width !== undefined) {
        node.resize(upd.width, node.height);
      } else if (upd.height !== undefined) {
        node.resize(node.width, upd.height);
      }
    });
  }

  // ── SCAN TEXT NODES ────────────────────────────────────────────────────────

  else if (msg.type === 'SCAN_TEXT_NODES') {
    const { nodeId, maxDepth, maxResults, requestId } = msg;
    var scanLimit = (maxResults !== undefined && maxResults > 0) ? maxResults : 1000;
    (async () => {
      try {
        const root = nodeId ? await figma.getNodeByIdAsync(nodeId) : figma.currentPage;
        if (!root) {
          figma.ui.postMessage({ type: 'SCAN_TEXT_NODES_RESULT', requestId, success: false, error: 'Node not found' });
          return;
        }
        var textNodes = [];
        var truncated = false;
        var visited = 0;
        // Iterative DFS with yielding
        var stack = [{ node: root, depth: 0, path: root.name }];
        while (stack.length > 0) {
          var item = stack.pop();
          visited++;
          if (maxDepth !== undefined && item.depth > maxDepth) continue;
          if (item.node.type === 'TEXT') {
            textNodes.push({
              id: item.node.id,
              name: item.node.name,
              characters: item.node.characters,
              fontSize: item.node.fontSize,
              fontFamily: typeof item.node.fontName === 'object' ? item.node.fontName.family : 'Mixed',
              x: Math.round(item.node.absoluteTransform[0][2]),
              y: Math.round(item.node.absoluteTransform[1][2]),
              width: Math.round(item.node.width),
              height: Math.round(item.node.height),
              path: item.path
            });
            if (textNodes.length >= scanLimit) { truncated = true; break; }
            if (textNodes.length % 50 === 0) {
              sendProgress(requestId, -1, 'Found ' + textNodes.length + ' text nodes...', textNodes.length);
            }
          }
          if ('children' in item.node) {
            // Push in reverse order so left-to-right traversal is preserved
            for (var ci = item.node.children.length - 1; ci >= 0; ci--) {
              stack.push({ node: item.node.children[ci], depth: item.depth + 1, path: item.path + '/' + item.node.children[ci].name });
            }
          }
          // Yield every 100 visited nodes to avoid blocking UI
          if (visited % 100 === 0) {
            await new Promise(function(r) { setTimeout(r, 0); });
          }
        }
        figma.ui.postMessage({ type: 'SCAN_TEXT_NODES_RESULT', requestId, success: true, data: { count: textNodes.length, nodes: textNodes, truncated: truncated } });
      } catch (e) {
        figma.ui.postMessage({ type: 'SCAN_TEXT_NODES_RESULT', requestId, success: false, error: e.message });
      }
    })();
  }

  // ── AUTO-LAYOUT ────────────────────────────────────────────────────────────

  else if (msg.type === 'SET_AUTO_LAYOUT') {
    const { nodeId, requestId } = msg;
    try {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node || !('layoutMode' in node)) {
        figma.ui.postMessage({ type: 'SET_AUTO_LAYOUT_RESULT', requestId, success: false, error: 'Node does not support auto-layout' });
        return;
      }
      // CRITICAL ORDER: layoutMode FIRST
      if (msg.direction !== undefined) node.layoutMode = msg.direction;
      // Wrap (after layoutMode)
      if (msg.layoutWrap !== undefined) node.layoutWrap = msg.layoutWrap;
      // Sizing modes
      if (msg.primaryAxisSizingMode !== undefined) node.primaryAxisSizingMode = msg.primaryAxisSizingMode;
      if (msg.counterAxisSizingMode !== undefined) node.counterAxisSizingMode = msg.counterAxisSizingMode;
      // Padding
      if (msg.padding !== undefined) {
        node.paddingTop = node.paddingBottom = node.paddingLeft = node.paddingRight = msg.padding;
      } else {
        if (msg.paddingTop !== undefined) node.paddingTop = msg.paddingTop;
        if (msg.paddingBottom !== undefined) node.paddingBottom = msg.paddingBottom;
        if (msg.paddingLeft !== undefined) node.paddingLeft = msg.paddingLeft;
        if (msg.paddingRight !== undefined) node.paddingRight = msg.paddingRight;
      }
      // Spacing
      if (msg.itemSpacing !== undefined) node.itemSpacing = msg.itemSpacing;
      // Alignment (LAST)
      if (msg.primaryAxisAlignItems !== undefined) node.primaryAxisAlignItems = msg.primaryAxisAlignItems;
      if (msg.counterAxisAlignItems !== undefined) node.counterAxisAlignItems = msg.counterAxisAlignItems;

      figma.ui.postMessage({ type: 'SET_AUTO_LAYOUT_RESULT', requestId, success: true, node: { id: node.id, name: node.name, layoutMode: node.layoutMode } });
    } catch (e) {
      figma.ui.postMessage({ type: 'SET_AUTO_LAYOUT_RESULT', requestId, success: false, error: e.message });
    }
  }

  // ── VARIANT SWITCHING ──────────────────────────────────────────────────────

  else if (msg.type === 'SET_VARIANT') {
    const { nodeId, variant, requestId } = msg;
    try {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node || node.type !== 'INSTANCE') {
        figma.ui.postMessage({ type: 'SET_VARIANT_RESULT', requestId, success: false, error: 'Node is not a component instance' });
        return;
      }
      const componentProperties = node.componentProperties;
      const updates = {};
      for (const [key, value] of Object.entries(variant)) {
        // Exact match first, then strip hash suffix, then case-insensitive
        var propKey = Object.keys(componentProperties).find(function(k) { return k === key || k.split('#')[0] === key; });
        if (!propKey) {
          propKey = Object.keys(componentProperties).find(function(k) {
            return k.toLowerCase() === key.toLowerCase() || k.split('#')[0].toLowerCase() === key.toLowerCase();
          });
        }
        if (propKey && componentProperties[propKey].type === 'VARIANT') {
          updates[propKey] = value;
        }
      }
      if (Object.keys(updates).length > 0) {
        node.setProperties(updates);
      }
      figma.ui.postMessage({ type: 'SET_VARIANT_RESULT', requestId, success: true, instance: { id: node.id, name: node.name, appliedVariants: updates } });
    } catch (e) {
      figma.ui.postMessage({ type: 'SET_VARIANT_RESULT', requestId, success: false, error: e.message });
    }
  }

  // ── GRANULAR STYLE TOOLS ───────────────────────────────────────────────────

  // SET_TEXT_STYLE - Typography properties
  else if (msg.type === 'SET_TEXT_STYLE') {
    const { nodeId, requestId } = msg;
    (async () => {
      try {
        const node = await figma.getNodeByIdAsync(nodeId);
        if (!node || node.type !== 'TEXT') {
          figma.ui.postMessage({ type: 'SET_TEXT_STYLE_RESULT', requestId, success: false, error: 'Not a text node' });
          return;
        }
        if (node.fontName === figma.mixed) {
          var len = node.characters.length;
          for (var fi = 0; fi < len; fi++) { await figma.loadFontAsync(node.getRangeFontName(fi, fi + 1)); }
        } else {
          await figma.loadFontAsync(node.fontName);
        }
        if (msg.letterSpacing !== undefined) node.letterSpacing = { value: msg.letterSpacing, unit: 'PIXELS' };
        if (msg.lineHeight !== undefined) node.lineHeight = { value: msg.lineHeight, unit: 'PIXELS' };
        if (msg.paragraphSpacing !== undefined) node.paragraphSpacing = msg.paragraphSpacing;
        if (msg.textCase !== undefined) node.textCase = msg.textCase;
        if (msg.textDecoration !== undefined) node.textDecoration = msg.textDecoration;
        if (msg.textAlignHorizontal !== undefined) node.textAlignHorizontal = msg.textAlignHorizontal;
        if (msg.textAlignVertical !== undefined) node.textAlignVertical = msg.textAlignVertical;
        figma.ui.postMessage({ type: 'SET_TEXT_STYLE_RESULT', requestId, success: true, node: { id: node.id, name: node.name } });
      } catch (e) {
        figma.ui.postMessage({ type: 'SET_TEXT_STYLE_RESULT', requestId, success: false, error: e.message });
      }
    })();
  }

  // SET_EFFECTS - Shadows and blurs
  else if (msg.type === 'SET_EFFECTS') {
    const { nodeId, effects, requestId } = msg;
    try {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node || !('effects' in node)) {
        figma.ui.postMessage({ type: 'SET_EFFECTS_RESULT', requestId, success: false, error: 'Node does not support effects' });
        return;
      }
      const mapped = effects.map(function(e) {
        var effect = { type: e.type, visible: e.visible !== undefined ? e.visible : true };
        if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
          var rgb = e.color ? hexToFigmaRGB(e.color) : { r: 0, g: 0, b: 0, a: 0.25 };
          // opacity param takes precedence over hex alpha
          var alpha = e.opacity !== undefined ? e.opacity : (rgb.a !== undefined ? rgb.a : 0.25);
          effect.color = { r: rgb.r, g: rgb.g, b: rgb.b, a: alpha };
          effect.offset = { x: e.offsetX || 0, y: e.offsetY || 0 };
          effect.radius = e.radius || 0;
          effect.spread = e.spread || 0;
        } else {
          effect.radius = e.radius || 0;
        }
        return effect;
      });
      node.effects = mapped;
      figma.ui.postMessage({ type: 'SET_EFFECTS_RESULT', requestId, success: true, node: { id: node.id, name: node.name } });
    } catch (e) {
      figma.ui.postMessage({ type: 'SET_EFFECTS_RESULT', requestId, success: false, error: e.message });
    }
  }

  // SET_OPACITY
  else if (msg.type === 'SET_OPACITY') {
    const { nodeId, opacity, requestId } = msg;
    try {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node || !('opacity' in node)) {
        figma.ui.postMessage({ type: 'SET_OPACITY_RESULT', requestId, success: false, error: 'Node does not support opacity' });
        return;
      }
      node.opacity = Math.max(0, Math.min(1, opacity));
      figma.ui.postMessage({ type: 'SET_OPACITY_RESULT', requestId, success: true, node: { id: node.id, name: node.name } });
    } catch (e) {
      figma.ui.postMessage({ type: 'SET_OPACITY_RESULT', requestId, success: false, error: e.message });
    }
  }

  // SET_CORNER_RADIUS
  else if (msg.type === 'SET_CORNER_RADIUS') {
    const { nodeId, requestId } = msg;
    try {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node || !('cornerRadius' in node)) {
        figma.ui.postMessage({ type: 'SET_CORNER_RADIUS_RESULT', requestId, success: false, error: 'Node does not support corner radius' });
        return;
      }
      if (msg.radius !== undefined) {
        node.cornerRadius = msg.radius;
      } else {
        if (msg.topLeft !== undefined) node.topLeftRadius = msg.topLeft;
        if (msg.topRight !== undefined) node.topRightRadius = msg.topRight;
        if (msg.bottomLeft !== undefined) node.bottomLeftRadius = msg.bottomLeft;
        if (msg.bottomRight !== undefined) node.bottomRightRadius = msg.bottomRight;
      }
      figma.ui.postMessage({ type: 'SET_CORNER_RADIUS_RESULT', requestId, success: true, node: { id: node.id, name: node.name } });
    } catch (e) {
      figma.ui.postMessage({ type: 'SET_CORNER_RADIUS_RESULT', requestId, success: false, error: e.message });
    }
  }

  // ============================================================================
  // CLEAR_PAGE - Create a fresh page and switch to it (QA canvas cleanup)
  // ============================================================================
  else if (msg.type === 'CLEAR_PAGE') {
    try {
      console.log('🌉 [Desktop Bridge] Creating clean page for QA');
      var newPage = figma.createPage();
      newPage.name = msg.payload && msg.payload.name ? msg.payload.name : 'QA-Run-' + Date.now();
      await figma.setCurrentPageAsync(newPage);
      figma.ui.postMessage({
        type: 'CLEAR_PAGE_RESULT',
        requestId: msg.requestId,
        success: true,
        pageId: newPage.id,
        pageName: newPage.name
      });
    } catch (e) {
      figma.ui.postMessage({
        type: 'CLEAR_PAGE_RESULT',
        requestId: msg.requestId,
        success: false,
        error: e.message
      });
    }
  }
};

// ============================================================================
// DOCUMENT CHANGE LISTENER - Forward change events for cache invalidation
// Fires when variables, styles, or nodes change (by any means — user edits, API, etc.)
// Requires figma.loadAllPagesAsync() in dynamic-page mode before registering.
// ============================================================================
figma.loadAllPagesAsync().then(function() {
  figma.on('documentchange', function(event) {
    var hasStyleChanges = false;
    var hasNodeChanges = false;
    var changedNodeIds = [];

    for (var i = 0; i < event.documentChanges.length; i++) {
      var change = event.documentChanges[i];
      if (change.type === 'STYLE_CREATE' || change.type === 'STYLE_DELETE' || change.type === 'STYLE_PROPERTY_CHANGE') {
        hasStyleChanges = true;
      } else if (change.type === 'CREATE' || change.type === 'DELETE' || change.type === 'PROPERTY_CHANGE') {
        hasNodeChanges = true;
        if (change.id && changedNodeIds.length < 50) {
          changedNodeIds.push(change.id);
        }
      }
    }

    if (hasStyleChanges || hasNodeChanges) {
      figma.ui.postMessage({
        type: 'DOCUMENT_CHANGE',
        data: {
          hasStyleChanges: hasStyleChanges,
          hasNodeChanges: hasNodeChanges,
          changedNodeIds: changedNodeIds,
          changeCount: event.documentChanges.length,
          timestamp: Date.now()
        }
      });
    }
  });
  // Selection change listener — tracks what the user has selected in Figma
  figma.on('selectionchange', function() {
    var selection = figma.currentPage.selection;
    var selectedNodes = [];
    for (var i = 0; i < Math.min(selection.length, 50); i++) {
      try {
        var node = selection[i];
        selectedNodes.push({
          id: node.id,
          name: node.name,
          type: node.type,
          width: node.width,
          height: node.height
        });
      } catch (e) {
        // Slot sublayers and table cells may not be fully resolvable —
        // accessing .name throws "does not exist" for these node types.
        // Skip silently rather than crashing the plugin.
      }
    }
    figma.ui.postMessage({
      type: 'SELECTION_CHANGE',
      data: {
        nodes: selectedNodes,
        count: selection.length,
        page: figma.currentPage.name,
        timestamp: Date.now()
      }
    });
  });

  // Page change listener — tracks which page the user is viewing
  figma.on('currentpagechange', function() {
    figma.ui.postMessage({
      type: 'PAGE_CHANGE',
      data: {
        pageId: figma.currentPage.id,
        pageName: figma.currentPage.name,
        timestamp: Date.now()
      }
    });
  });

  console.log('🌉 [Desktop Bridge] Document change, selection, and page listeners registered');
}).catch(function(err) {
  console.warn('🌉 [Desktop Bridge] Could not register event listeners:', err);
});

console.log('🌉 [Desktop Bridge] Ready to handle component requests');
console.log('🌉 [Desktop Bridge] Plugin will stay open until manually closed');

// Plugin stays open - no auto-close
