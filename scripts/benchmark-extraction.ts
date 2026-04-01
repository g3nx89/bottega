/**
 * Benchmark script for the semantic extraction pipeline.
 *
 * Reads a saved raw plugin response from debug/figma-raw.json (or generates a
 * synthetic fixture) and profiles the extraction pipeline across all modes.
 *
 * Usage:
 *   npx tsx scripts/benchmark-extraction.ts [path-to-raw.json]
 *   npm run benchmark:extraction
 */

import { readFileSync, existsSync } from 'node:fs';
import { extractTree } from '../src/main/compression/project-tree.js';
import { toYaml } from '../src/main/compression/yaml-emitter.js';
import type { SemanticMode } from '../src/main/compression/semantic-modes.js';

// ── Synthetic fixture ──────────────────────────

function generateSyntheticTree(nodeCount: number): any {
  let id = 0;
  function makeNode(depth: number, maxDepth: number): any {
    id++;
    const type = depth === maxDepth ? (id % 3 === 0 ? 'TEXT' : id % 5 === 0 ? 'VECTOR' : 'FRAME') : 'FRAME';
    const node: any = {
      id: `${id}:1`,
      type,
      name: `Node_${id}`,
      width: 100 + (id % 200),
      height: 50 + (id % 100),
      visible: id % 20 !== 0, // 5% invisible
      opacity: id % 10 === 0 ? 0.5 : 1,
      layoutMode: depth < maxDepth ? (id % 2 === 0 ? 'HORIZONTAL' : 'VERTICAL') : undefined,
      layoutWrap: id % 7 === 0 ? 'WRAP' : 'NO_WRAP',
      itemSpacing: 8,
      paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16,
      fills: [{ type: 'SOLID', color: { r: (id % 5) * 0.2, g: 0.5, b: 0.8, a: 1 }, visible: true }],
      strokes: id % 4 === 0 ? [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, visible: true }] : [],
      effects: id % 6 === 0 ? [{ type: 'DROP_SHADOW', visible: true, offset: { x: 2, y: 4 }, radius: 8, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.25 } }] : [],
      layoutSizingHorizontal: id % 3 === 0 ? 'FILL' : 'FIXED',
      layoutSizingVertical: 'HUG',
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: id % 4 === 0 ? 'CENTER' : 'MIN',
      cornerRadius: id % 3 === 0 ? 8 : 0,
    };

    if (type === 'TEXT') {
      node.characters = `Sample text content for node ${id}`;
      node.fontSize = 14 + (id % 4) * 2;
      node.style = { fontFamily: 'Inter', fontWeight: id % 2 === 0 ? 700 : 400, lineHeightPx: 20, letterSpacing: 0 };
    }

    if (type === 'INSTANCE') {
      node.componentId = `comp_${id % 5}`;
    }

    if (depth < maxDepth) {
      const childCount = Math.max(1, Math.min(5, nodeCount - id));
      node.children = [];
      for (let i = 0; i < childCount && id < nodeCount; i++) {
        node.children.push(makeNode(depth + 1, maxDepth));
      }
    }

    return node;
  }

  return makeNode(0, 6);
}

// ── Benchmark ──────────────────────────────────

async function benchmark() {
  const inputPath = process.argv[2];
  let rawTree: any;

  if (inputPath && existsSync(inputPath)) {
    console.log(`Reading raw tree from: ${inputPath}`);
    rawTree = JSON.parse(readFileSync(inputPath, 'utf-8'));
  } else {
    const nodeCount = 200;
    console.log(`No input file — generating synthetic tree (~${nodeCount} nodes)`);
    rawTree = generateSyntheticTree(nodeCount);
  }

  const rawJson = JSON.stringify(rawTree);
  const rawSize = rawJson.length;
  console.log(`\nInput: ${rawSize.toLocaleString()} chars (${Math.round(rawSize / 4).toLocaleString()} est. tokens)\n`);

  const modes: SemanticMode[] = ['briefing', 'structure', 'content', 'styling', 'component', 'full'];

  console.log('Mode           | Time (ms) | JSON chars | YAML chars | JSON ratio | YAML ratio | Nodes');
  console.log('───────────────┼───────────┼────────────┼────────────┼────────────┼────────────┼──────');

  for (const mode of modes) {
    const start = performance.now();
    const result = await extractTree(rawTree, mode);
    const elapsed = performance.now() - start;

    const jsonOut = JSON.stringify(result);
    const yamlOut = toYaml(result);
    const jsonSize = jsonOut.length;
    const yamlSize = yamlOut.length;

    const nodeCount = countNodes(result.nodes);
    const jsonRatio = ((jsonSize / rawSize) * 100).toFixed(1);
    const yamlRatio = ((yamlSize / rawSize) * 100).toFixed(1);

    console.log(
      `${mode.padEnd(15)}| ${elapsed.toFixed(1).padStart(9)} | ${jsonSize.toString().padStart(10)} | ${yamlSize.toString().padStart(10)} | ${(jsonRatio + '%').padStart(10)} | ${(yamlRatio + '%').padStart(10)} | ${nodeCount}`,
    );
  }

  // Memory report
  const mem = process.memoryUsage();
  console.log(`\nMemory: RSS=${(mem.rss / 1024 / 1024).toFixed(1)}MB Heap=${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB`);
}

function countNodes(nodes: any[]): number {
  let count = 0;
  for (const node of nodes) {
    count++;
    if (node.children) count += countNodes(node.children);
  }
  return count;
}

benchmark().catch(console.error);
