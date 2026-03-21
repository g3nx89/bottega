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

export function parseJsx(jsxString: string): TreeNode {
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

  const { code: compiled } = transformSync(wrappedCode, {
    jsx: 'transform',
    jsxFactory: 'h',
    jsxFragment: '"Fragment"',
    loader: 'jsx',
  });

  return vm.runInContext(compiled, jsxContext) as TreeNode;
}
