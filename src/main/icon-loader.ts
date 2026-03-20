import { iconToSVG, iconToHTML } from '@iconify/utils';
import type { TreeNode } from '../figma/types.js';

const MAX_ICON_CACHE = 500;
const iconCache = new Map<string, string>();

export async function loadIconSvg(name: string, size: number = 24): Promise<string> {
  const cacheKey = `${name}@${size}`;
  if (iconCache.has(cacheKey)) return iconCache.get(cacheKey)!;

  const [prefix, iconName] = name.split(':');
  if (!prefix || !iconName) throw new Error(`Invalid icon name "${name}". Use format "prefix:name" (e.g. "mdi:home")`);

  const url = `https://api.iconify.design/${prefix}.json?icons=${iconName}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch icon "${name}": ${response.status}`);

  const data = await response.json();
  const iconData = data.icons?.[iconName];
  if (!iconData) throw new Error(`Icon "${name}" not found on Iconify`);

  const renderData = iconToSVG({
    ...iconData,
    width: data.width ?? iconData.width ?? 24,
    height: data.height ?? iconData.height ?? 24,
  }, { height: size, width: size });

  const svg = iconToHTML(renderData.body, renderData.attributes);

  // Evict oldest entry if cache is full
  if (iconCache.size >= MAX_ICON_CACHE) {
    const oldest = iconCache.keys().next().value!;
    iconCache.delete(oldest);
  }
  iconCache.set(cacheKey, svg);
  return svg;
}

/**
 * Single-pass: collect all icon nodes, fetch SVGs in parallel, replace in-place.
 * Replaces the previous two-pass approach (collectIconNodes + replaceIconNodesWithSvg).
 */
export async function resolveIcons(tree: TreeNode): Promise<void> {
  const iconNodes: any[] = [];
  (function walk(node: TreeNode | string) {
    if (typeof node === 'string') return;
    if (node.type === 'icon' || node.type === 'Icon') iconNodes.push(node);
    for (const child of node.children) walk(child);
  })(tree);

  if (iconNodes.length === 0) return;

  const svgs = await Promise.all(
    iconNodes.map(n => loadIconSvg(n.props.name as string, (n.props.size as number) || 24))
  );
  iconNodes.forEach((node, i) => {
    const size = (node.props.size as number) || 24;
    node.type = 'svg';
    node.props = { ...node.props, svg: svgs[i], w: size, h: size };
    node.children = [];
  });
}
