import { describe, expect, it } from 'vitest';
import type { TreeNode } from '../src/figma/types.js';
import { parseJsx } from '../src/main/jsx-parser.js';

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
    // Fragment maps to "Fragment" string via jsxFragment config
    expect(result.type).toBe('fragment');
    expect(result.children).toHaveLength(2);
  });
});
