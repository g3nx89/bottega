import { iconToHTML, iconToSVG } from '@iconify/utils';
import type { TreeNode } from '../figma/types.js';

const MAX_ICON_CACHE = 500;
const FETCH_TIMEOUT_MS = 10_000;
const iconCache = new Map<string, string>();

export async function loadIconSvg(name: string, size: number = 24): Promise<string> {
  const cacheKey = `${name}@${size}`;
  if (iconCache.has(cacheKey)) return iconCache.get(cacheKey)!;

  const parts = name.split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1])
    throw new Error(`Invalid icon name "${name}". Use format "prefix:name" (e.g. "mdi:home")`);
  const [prefix, iconName] = parts;

  const url = `https://api.iconify.design/${prefix}.json?icons=${iconName}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (err: any) {
    if (err.name === 'AbortError') throw new Error(`Fetch timeout for icon "${name}" after ${FETCH_TIMEOUT_MS}ms`);
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
  if (!response.ok) throw new Error(`Failed to fetch icon "${name}": ${response.status}`);

  const data = await response.json();
  const iconData = data.icons?.[iconName];
  if (!iconData) throw new Error(`Icon "${name}" not found on Iconify`);

  const renderData = iconToSVG(
    {
      ...iconData,
      width: data.width ?? iconData.width ?? 24,
      height: data.height ?? iconData.height ?? 24,
    },
    { height: size, width: size },
  );

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

  // Deduplicate: group nodes by cacheKey so each unique icon is fetched once
  const groups = new Map<string, { nodes: typeof iconNodes; name: string; size: number }>();
  for (const node of iconNodes) {
    const name = node.props.name as string;
    const size = (node.props.size as number) || 24;
    const key = `${name}@${size}`;
    let group = groups.get(key);
    if (!group) {
      group = { nodes: [], name, size };
      groups.set(key, group);
    }
    group.nodes.push(node);
  }

  const entries = [...groups.values()];
  const results = await Promise.allSettled(entries.map((g) => loadIconSvg(g.name, g.size)));
  entries.forEach((group, i) => {
    const result = results[i];
    if (result.status !== 'fulfilled') return; // Leave nodes unchanged — doesn't break the tree
    for (const node of group.nodes) {
      node.type = 'svg';
      node.props = { ...node.props, svg: result.value, w: group.size, h: group.size };
      node.children = [];
    }
  });
}
