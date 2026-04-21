#!/usr/bin/env node
/**
 * Sync cross-layer constants from TypeScript sources into
 * figma-desktop-bridge/ui.html. The Figma plugin is loaded directly from
 * the source tree by Figma Desktop — there is no bundler on that side —
 * so ui.html must physically contain literal numbers. This script keeps
 * those literals aligned with the authoritative TS exports by rewriting
 * the contents between `SYNC:BEGIN <id>` / `SYNC:END <id>` sentinel
 * comments in ui.html.
 *
 * Usage:
 *   node scripts/sync-bridge-constants.mjs        # rewrite ui.html in place
 *   node scripts/sync-bridge-constants.mjs --check # exit 1 if drift found
 *
 * Wired into `npm run build` so a forgotten sync shows up at build time.
 * The unit drift tests (plugin-protocol.test.ts, timeouts.test.ts)
 * remain as belt-and-suspenders for direct edits that bypass the script.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const UI_HTML = resolve(REPO_ROOT, 'figma-desktop-bridge/ui.html');
const PROTOCOL_TS = resolve(REPO_ROOT, 'src/shared/plugin-protocol.ts');
const WS_SERVER_TS = resolve(REPO_ROOT, 'src/figma/websocket-server.ts');

/**
 * Parse a simple `export const NAME = number_expr;` declaration out of a
 * TypeScript source. `number_expr` may use underscores for readability.
 */
function extractNumericConst(tsSource, name) {
  const rx = new RegExp(`export\\s+const\\s+${name}\\s*(?::\\s*\\w+)?\\s*=\\s*([\\d_]+)\\s*;`);
  const m = tsSource.match(rx);
  if (!m) throw new Error(`export const ${name} not found`);
  const value = Number(m[1].replace(/_/g, ''));
  if (!Number.isFinite(value)) throw new Error(`${name} parsed to non-finite value`);
  return value;
}

function replaceSentinelBlock(source, id, nextBody) {
  const rx = new RegExp(
    `(\\/\\*\\s*SYNC:BEGIN\\s+${id}\\s*\\*\\/)([\\s\\S]*?)(\\/\\*\\s*SYNC:END\\s+${id}\\s*\\*\\/)`,
  );
  if (!rx.test(source)) throw new Error(`sentinel block '${id}' not found in ui.html`);
  return source.replace(rx, `$1\n${nextBody}\n    $3`);
}

function indent(lines, spaces) {
  const pad = ' '.repeat(spaces);
  return lines.map((l) => pad + l).join('\n');
}

const protocolTs = readFileSync(PROTOCOL_TS, 'utf8');
const wsServerTs = readFileSync(WS_SERVER_TS, 'utf8');

const pluginVersion = extractNumericConst(protocolTs, 'PLUGIN_PROTOCOL_VERSION');
const fastRpc = extractNumericConst(wsServerTs, 'WS_FAST_RPC_TIMEOUT_MS');
const mediumRpc = extractNumericConst(wsServerTs, 'WS_MEDIUM_RPC_TIMEOUT_MS');
const commandDefault = extractNumericConst(wsServerTs, 'WS_COMMAND_DEFAULT_TIMEOUT_MS');
const stall = extractNumericConst(wsServerTs, 'WS_STALL_DETECTION_MS');
const heavyRpc = extractNumericConst(wsServerTs, 'WS_HEAVY_RPC_TIMEOUT_MS');
const batch = extractNumericConst(wsServerTs, 'WS_BATCH_TIMEOUT_MS');
const refreshVars = extractNumericConst(wsServerTs, 'WS_REFRESH_VARIABLES_TIMEOUT_MS');

const original = readFileSync(UI_HTML, 'utf8');

let next = original;
next = replaceSentinelBlock(
  next,
  'protocol-constants',
  indent(
    [
      `var WS_FAST_RPC_TIMEOUT_MS = ${fastRpc};`,
      `var WS_MEDIUM_RPC_TIMEOUT_MS = ${mediumRpc};`,
      `var WS_COMMAND_DEFAULT_TIMEOUT_MS = ${commandDefault};`,
      `var WS_STALL_DETECTION_MS = ${stall};`,
      `var WS_HEAVY_RPC_TIMEOUT_MS = ${heavyRpc};`,
      `var WS_BATCH_TIMEOUT_MS = ${batch};`,
      `var WS_REFRESH_VARIABLES_TIMEOUT_MS = ${refreshVars};`,
    ],
    4,
  ),
);
next = replaceSentinelBlock(next, 'plugin-version', indent([`var PLUGIN_VERSION = ${pluginVersion};`], 6));

const checkOnly = process.argv.includes('--check');

if (next === original) {
  console.log('[sync-bridge-constants] ui.html already in sync.');
  process.exit(0);
}

if (checkOnly) {
  console.error('[sync-bridge-constants] ui.html is out of sync with TS sources.');
  console.error('Run: node scripts/sync-bridge-constants.mjs');
  process.exit(1);
}

writeFileSync(UI_HTML, next);
console.log('[sync-bridge-constants] ui.html updated.');
