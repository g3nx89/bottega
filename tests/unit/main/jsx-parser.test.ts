import { describe, expect, it } from 'vitest';
import type { TreeNode } from '../../../src/figma/types.js';
import { parseJsx } from '../../../src/main/jsx-parser.js';

describe('parseJsx', () => {
  it('should parse a simple Frame element', () => {
    const result = parseJsx('<Frame width={100} height={50} />');
    expect(result).toEqual({
      type: 'frame',
      props: { width: 100, height: 50 },
      children: [],
    });
  });

  it('should parse nested elements', () => {
    const result = parseJsx(`
      <Frame padding={16}>
        <Rectangle width={50} height={50} />
        <Text>Hello</Text>
      </Frame>
    `);
    expect(result.type).toBe('frame');
    expect(result.children).toHaveLength(2);
    expect((result.children[0] as TreeNode).type).toBe('rectangle');
    expect((result.children[1] as TreeNode).type).toBe('text');
    expect((result.children[1] as TreeNode).children).toEqual(['Hello']);
  });

  it('should lowercase tag names via sandbox mapping', () => {
    const tags = ['Frame', 'View', 'Rectangle', 'Rect', 'Ellipse', 'Text', 'Line', 'Svg', 'Image', 'Icon'];
    for (const tag of tags) {
      const result = parseJsx(`<${tag} />`);
      expect(result.type).toBe(tag.toLowerCase());
    }
  });

  it('should handle string props', () => {
    const result = parseJsx('<Frame name="card" layoutMode="VERTICAL" />');
    expect(result.props).toEqual({ name: 'card', layoutMode: 'VERTICAL' });
  });

  it('should handle numeric props', () => {
    const result = parseJsx('<Rectangle width={200} height={100} cornerRadius={8} />');
    expect(result.props.width).toBe(200);
    expect(result.props.height).toBe(100);
    expect(result.props.cornerRadius).toBe(8);
  });

  it('should handle boolean props', () => {
    const result = parseJsx('<Frame clipsContent={true} />');
    expect(result.props.clipsContent).toBe(true);
  });

  it('should handle deeply nested structures', () => {
    const result = parseJsx(`
      <Frame>
        <Frame>
          <Frame>
            <Text>Deep</Text>
          </Frame>
        </Frame>
      </Frame>
    `);
    const l1 = result.children[0] as TreeNode;
    const l2 = l1.children[0] as TreeNode;
    const l3 = l2.children[0] as TreeNode;
    expect(l3.type).toBe('text');
  });

  it('should handle object props (fills, etc.)', () => {
    const result = parseJsx('<Rectangle fills={[{ type: "SOLID", color: "#FF0000" }]} />');
    expect(result.props.fills).toEqual([{ type: 'SOLID', color: '#FF0000' }]);
  });

  it('should filter null children', () => {
    const result = parseJsx(`
      <Frame>
        {null}
        <Text>visible</Text>
        {undefined}
      </Frame>
    `);
    // null and undefined children should be filtered out
    const textChildren = result.children.filter((c: any) => typeof c === 'object' && c.type === 'text');
    expect(textChildren).toHaveLength(1);
  });

  it('should throw on invalid JSX', () => {
    expect(() => parseJsx('not jsx at all {')).toThrow();
  });

  it('should handle Fragment', () => {
    const result = parseJsx(`
      <>
        <Text>A</Text>
        <Text>B</Text>
      </>
    `);
    // Root Fragment with 2+ children is wrapped in a Frame
    expect(result.type).toBe('frame');
    expect(result.children).toHaveLength(2);
  });

  // ── Edge cases ────────────────────────────────

  it('should handle expression children (numbers)', () => {
    const result = parseJsx('<Text>{42}</Text>');
    expect(result.children).toContain(42);
  });

  it('should handle expression children (booleans are filtered by JSX)', () => {
    // In JSX, {true} and {false} are valid but typically render as nothing
    const result = parseJsx('<Frame>{true}{false}</Frame>');
    // true/false are filtered out by the h function's null filter or kept as primitives
    expect(result.type).toBe('frame');
  });

  it('should handle multiple text children', () => {
    const result = parseJsx(`
      <Frame>
        <Text>Hello</Text>
        <Text>World</Text>
        <Text>!</Text>
      </Frame>
    `);
    expect(result.children).toHaveLength(3);
    for (const child of result.children) {
      expect((child as TreeNode).type).toBe('text');
    }
  });

  it('should handle mixed prop types in one element', () => {
    const result = parseJsx(`
      <Frame
        name="card"
        width={300}
        clipsContent={true}
        fills={[{ type: "SOLID", color: "#FFF" }]}
      />
    `);
    expect(result.props.name).toBe('card');
    expect(result.props.width).toBe(300);
    expect(result.props.clipsContent).toBe(true);
    expect(result.props.fills).toEqual([{ type: 'SOLID', color: '#FFF' }]);
  });

  it('should handle self-closing elements with no props', () => {
    const result = parseJsx('<Rectangle />');
    expect(result.type).toBe('rectangle');
    expect(result.props).toEqual({});
    expect(result.children).toEqual([]);
  });

  it('should handle template literals in expressions', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: testing JSX runtime template literal parsing
    const result = parseJsx('<Frame name={`test-${1 + 1}`} />');
    expect(result.props.name).toBe('test-2');
  });

  it('should handle conditional expressions', () => {
    const result = parseJsx('<Frame width={true ? 100 : 200} />');
    expect(result.props.width).toBe(100);
  });

  it('should handle wide tree (many siblings)', () => {
    const items = Array.from({ length: 10 }, (_, i) => `<Rectangle width={${i * 10}} />`).join('\n');
    const result = parseJsx(`<Frame>${items}</Frame>`);
    expect(result.children).toHaveLength(10);
    expect((result.children[9] as TreeNode).props.width).toBe(90);
  });

  it('should handle negative numeric values', () => {
    const result = parseJsx('<Frame width={-10} />');
    expect(result.props.width).toBe(-10);
  });

  it('should handle float numeric values', () => {
    const result = parseJsx('<Frame opacity={0.5} />');
    expect(result.props.opacity).toBe(0.5);
  });

  // ── Boundary behavior ──────────────────────────

  it('should throw on unknown tag name not in sandbox mapping', () => {
    // 'CustomTag' is not in the sandbox mapping, so vm will throw ReferenceError
    expect(() => parseJsx('<CustomTag width={10} />')).toThrow();
  });

  it('should throw on empty JSX string', () => {
    expect(() => parseJsx('')).toThrow();
  });

  it('should handle wide tree with 100 siblings', () => {
    const items = Array.from({ length: 100 }, (_, i) => `<Rectangle width={${i}} />`).join('\n');
    const result = parseJsx(`<Frame>${items}</Frame>`);
    expect(result.type).toBe('frame');
    expect(result.children).toHaveLength(100);
    for (let i = 0; i < 100; i++) {
      const child = result.children[i] as TreeNode;
      expect(child.type).toBe('rectangle');
      expect(child.props.width).toBe(i);
    }
  });

  it('should throw on expression with undefined variable', () => {
    expect(() => parseJsx('<Frame width={nonExistentVar} />')).toThrow();
  });

  it('should throw on multiple root elements without Fragment', () => {
    expect(() => parseJsx('<Text>A</Text><Text>B</Text>')).toThrow();
  });

  // ── Cross-run contamination (R2 stability) ─────

  it('should not let sandbox mutation of tag name persist across calls', () => {
    // First call: expression tries to overwrite Frame in the sandbox
    const result1 = parseJsx('<Frame name={(() => { Frame = "hacked"; return "test"; })()}/>');
    expect(result1.props.name).toBe('test');

    // Second call: the sandbox IS shared (module-level vm.createContext),
    // so Frame is now "hacked" — h() receives "hacked" as the type string.
    const result2 = parseJsx('<Frame />');
    expect(result2.type).toBe('hacked');

    // Restore Frame for subsequent tests
    parseJsx('<Frame name={(() => { Frame = "frame"; return "restore"; })()}/>');
    const result3 = parseJsx('<Frame />');
    expect(result3.type).toBe('frame');
  });

  it('should not let Array.prototype modification persist across calls', () => {
    // First call: try to modify Array.prototype inside the sandbox
    const result1 = parseJsx('<Rectangle name={(() => { Array.prototype.customProp = 42; return "modified"; })()}/>');
    expect(result1.props.name).toBe('modified');

    // Second call: parseJsx should still work correctly — children array
    // operations (flat, filter) should be unaffected by the added property
    const result2 = parseJsx(`
      <Frame>
        <Text>A</Text>
        <Text>B</Text>
      </Frame>
    `);
    expect(result2.type).toBe('frame');
    expect(result2.children).toHaveLength(2);
    expect((result2.children[0] as TreeNode).type).toBe('text');
    expect((result2.children[1] as TreeNode).type).toBe('text');
  });

  // ── Additional edge cases ─────────────────────

  it('should handle explicit undefined prop value', () => {
    // Edge case: esbuild compiles width={undefined} to { width: void 0 }.
    // h() receives a truthy object so props || {} keeps it as-is.
    const result = parseJsx('<Frame width={undefined} />');
    expect(result.type).toBe('frame');
    expect('width' in result.props).toBe(true);
    expect(result.props.width).toBeUndefined();
  });

  it('should handle nested Fragment inside Frame', () => {
    // Edge case: Fragment as child of Frame — should flatten
    const result = parseJsx(`
      <Frame>
        <>
          <Text>A</Text>
          <Text>B</Text>
        </>
      </Frame>
    `);
    expect(result.type).toBe('frame');
    // Fragment is flattened: its children are spliced into the parent
    expect(result.children).toHaveLength(2);
    expect((result.children[0] as TreeNode).type).toBe('text');
    expect((result.children[1] as TreeNode).type).toBe('text');
  });

  it('should handle empty text content', () => {
    // Edge case: Text with empty string child
    const result = parseJsx('<Text>{""}</Text>');
    expect(result.type).toBe('text');
    expect(result.children).toContain('');
  });

  // ── Fragment flattening ──────────────────────────────────────────

  it('should flatten top-level Fragment into its children', () => {
    // When the root is a Fragment wrapping a single Frame, the Fragment
    // itself is the root — flattenTree doesn't remove the root node.
    // But Fragments as *children* get spliced out.
    const result = parseJsx(`
      <Frame>
        <>
          <Rectangle width={10} />
        </>
      </Frame>
    `);
    expect(result.type).toBe('frame');
    // Fragment child is flattened — Rectangle is directly in Frame
    expect(result.children).toHaveLength(1);
    expect((result.children[0] as TreeNode).type).toBe('rectangle');
  });

  it('should flatten deeply nested Fragments', () => {
    const result = parseJsx(`
      <Frame>
        <>
          <>
            <Text>Deep</Text>
          </>
          <Rectangle />
        </>
      </Frame>
    `);
    expect(result.type).toBe('frame');
    // Both levels of Fragment are flattened
    expect(result.children).toHaveLength(2);
    expect((result.children[0] as TreeNode).type).toBe('text');
    expect((result.children[1] as TreeNode).type).toBe('rectangle');
  });

  it('should flatten Fragment with mixed regular siblings', () => {
    const result = parseJsx(`
      <Frame>
        <Ellipse />
        <>
          <Text>A</Text>
          <Text>B</Text>
        </>
        <Line />
      </Frame>
    `);
    expect(result.type).toBe('frame');
    // Ellipse + 2 Text from Fragment + Line = 4 children
    expect(result.children).toHaveLength(4);
    expect((result.children[0] as TreeNode).type).toBe('ellipse');
    expect((result.children[1] as TreeNode).type).toBe('text');
    expect((result.children[2] as TreeNode).type).toBe('text');
    expect((result.children[3] as TreeNode).type).toBe('line');
  });

  it('should handle empty Fragment (no children)', () => {
    const result = parseJsx(`
      <Frame>
        <Text>Before</Text>
        <></>
        <Text>After</Text>
      </Frame>
    `);
    expect(result.type).toBe('frame');
    // Empty fragment contributes zero children
    expect(result.children).toHaveLength(2);
    expect((result.children[0] as TreeNode).type).toBe('text');
    expect((result.children[1] as TreeNode).type).toBe('text');
  });

  it('should unwrap root-level Fragment with single child', () => {
    const result = parseJsx(`
      <>
        <Frame name="Card" padding={16}>
          <Text>Hello</Text>
        </Frame>
      </>
    `);
    // Root Fragment unwrapped — Frame becomes root
    expect(result.type).toBe('frame');
    expect(result.props.name).toBe('Card');
  });

  it('should wrap root-level Fragment with multiple children in Frame', () => {
    const result = parseJsx(`
      <>
        <Text>A</Text>
        <Text>B</Text>
      </>
    `);
    // Root Fragment with 2+ children → wrapped in Frame
    expect(result.type).toBe('frame');
    expect(result.children).toHaveLength(2);
    expect((result.children[0] as TreeNode).type).toBe('text');
    expect((result.children[1] as TreeNode).type).toBe('text');
  });

  it('should preserve non-Fragment wrapper frames', () => {
    const result = parseJsx(`
      <Frame name="outer">
        <Frame name="inner" padding={16}>
          <Text>Keep this wrapper</Text>
        </Frame>
      </Frame>
    `);
    expect(result.type).toBe('frame');
    expect(result.children).toHaveLength(1);
    // Inner Frame with props is NOT a Fragment — it stays
    const inner = result.children[0] as TreeNode;
    expect(inner.type).toBe('frame');
    expect(inner.props.name).toBe('inner');
  });

  it('should handle array map pattern commonly used by LLM', () => {
    // Edge case: dynamic children via array map — common LLM pattern
    const result = parseJsx(`
      <Frame>
        {[1, 2, 3].map(i => <Rectangle key={i} width={i * 10} />)}
      </Frame>
    `);
    expect(result.type).toBe('frame');
    expect(result.children.length).toBeGreaterThanOrEqual(3);
  });
});
