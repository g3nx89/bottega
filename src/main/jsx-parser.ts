import vm from 'node:vm';
import { transformSync } from 'esbuild';
import type { TreeNode } from '../figma/types.js';

// Hoisted: vm.createContext is expensive (~1-5ms per call).
// The sandbox is identical every time so we create it once at module load.
const tagNames = ['Frame', 'View', 'Rectangle', 'Rect', 'Ellipse', 'Text', 'Line', 'Svg', 'Image', 'Icon', 'Fragment'];
const sandbox: Record<string, string> = {};
for (const tag of tagNames) {
  sandbox[tag] = tag.toLowerCase();
}
const jsxContext = vm.createContext(sandbox);

/**
 * Flatten fragment nodes: replace any node with type "fragment" by splicing
 * its children into the parent's children array.
 */
function flattenTree(node: TreeNode): TreeNode {
  if (!node.children || node.children.length === 0) return node;

  // Recursively flatten children, splicing fragment children into parent
  const flatChildren: (TreeNode | string)[] = [];
  for (const child of node.children) {
    if (typeof child === 'string') {
      flatChildren.push(child);
      continue;
    }
    const flattened = flattenTree(child);
    if (flattened.type === 'fragment') {
      flatChildren.push(...(flattened.children || []));
    } else {
      flatChildren.push(flattened);
    }
  }
  node.children = flatChildren;
  return node;
}

export function parseJsx(jsxString: string): TreeNode {
  // nosemgrep: missing-template-string-indicator — code generation: builds JS source to run in vm sandbox
  const wrappedCode = `
    (function() {
      function h(type, props) {
        var args = Array.prototype.slice.call(arguments, 2);
        var children = args.flat().filter(function(c) { return c != null; });
        return {
          type: typeof type === 'string' ? type.toLowerCase() : String(type),
          props: props || {},
          children: children
        };
      }
      return (${jsxString});
    })()
  `;

  let compiled: string;
  try {
    ({ code: compiled } = transformSync(wrappedCode, {
      jsx: 'transform',
      jsxFactory: 'h',
      jsxFragment: '"Fragment"',
      loader: 'jsx',
    }));
  } catch (err: unknown) {
    // Map esbuild error back to the user's JSX source.
    // The wrapper prepends 11 lines before the JSX insertion on line 12,
    // so <stdin>:N maps to jsxString line (N - 11).
    const msg = err instanceof Error ? err.message : String(err);
    const lineMatch = msg.match(/<stdin>:(\d+):(\d+)/);
    const WRAPPER_OFFSET = 11;
    if (lineMatch) {
      const srcLine = Math.max(1, Number(lineMatch[1]) - WRAPPER_OFFSET);
      const col = lineMatch[2];
      const jsxLines = jsxString.split('\n');
      const problemLine = jsxLines[srcLine - 1]?.trim() ?? '';
      const snippet = problemLine ? `\n  → line ${srcLine}: ${problemLine}` : '';
      throw new Error(
        `JSX syntax error at line ${srcLine}:${col}${snippet}\n${msg.replace(/<stdin>:\d+:\d+: ERROR: /, '')}`,
      );
    }
    throw err;
  }

  const tree = vm.runInContext(compiled, jsxContext) as TreeNode;
  let result = flattenTree(tree);
  // Handle root-level Fragment: unwrap single child or wrap multiple in Frame
  if (result.type === 'fragment') {
    const realChildren = (result.children || []).filter((c): c is TreeNode => typeof c !== 'string');
    if (realChildren.length === 1) {
      result = realChildren[0]!;
    } else {
      result = { type: 'frame', props: {}, children: result.children };
    }
  }
  return result;
}
