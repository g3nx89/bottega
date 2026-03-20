import { iconToSVG, iconToHTML } from '@iconify/utils';
import type { TreeNode } from '../figma/types.js';

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
  iconCache.set(cacheKey, svg);
  return svg;
}

export function collectIconNodes(tree: TreeNode): Array<{ name: string; size: number }> {
  const icons: Array<{ name: string; size: number }> = [];
  function walk(node: TreeNode | string) {
    if (typeof node === 'string') return;
    if (node.type === 'icon' || node.type === 'Icon') {
      icons.push({ name: node.props.name as string, size: (node.props.size as number) || 24 });
    }
    for (const child of node.children) {
      walk(child);
    }
  }
  walk(tree);
  return icons;
}

export async function preloadIcons(icons: Array<{ name: string; size: number }>): Promise<void> {
  await Promise.all(icons.map(i => loadIconSvg(i.name, i.size)));
}
