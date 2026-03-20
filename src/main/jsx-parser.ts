import { transformSync } from 'esbuild';
import vm from 'node:vm';
import type { TreeNode } from '../figma/types.js';

export function parseJsx(jsxString: string): TreeNode {
  // Wrap the JSX in an IIFE with our custom createElement factory
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

  // Use esbuild to transform JSX → createElement calls
  const { code: compiled } = transformSync(wrappedCode, {
    jsx: 'transform',
    jsxFactory: 'h',
    jsxFragment: '"Fragment"',
    loader: 'jsx',
  });

  // Register all supported uppercase tag names as string identities in the sandbox.
  // In JSX, <Frame> compiles to h(Frame, {}) — Frame must be a defined variable.
  // We map each to its lowercase string so h() receives a string type.
  const tagNames = [
    'Frame', 'View', 'Rectangle', 'Rect', 'Ellipse', 'Text',
    'Line', 'Svg', 'Image', 'Icon', 'Fragment',
  ];
  const sandbox: Record<string, string> = {};
  for (const tag of tagNames) {
    sandbox[tag] = tag.toLowerCase();
  }

  const context = vm.createContext(sandbox);
  return vm.runInContext(compiled, context) as TreeNode;
}
