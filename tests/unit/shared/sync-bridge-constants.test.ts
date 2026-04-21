import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../..');
const SCRIPT = resolve(REPO_ROOT, 'scripts/sync-bridge-constants.mjs');

describe('sync-bridge-constants', () => {
  it('--check passes when ui.html is in sync with TS sources', () => {
    const result = spawnSync('node', [SCRIPT, '--check'], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('already in sync');
  });
});
