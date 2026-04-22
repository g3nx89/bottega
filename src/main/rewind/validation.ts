import path from 'node:path';
import type { RestoreScope } from './types.js';

const FILE_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const FILENAME_SAFE_RE = /^[A-Za-z0-9_-]{1,128}$/;
const SCOPES: readonly RestoreScope[] = ['last-turn', 'to-checkpoint'];

export function validateFileKey(value: unknown): string {
  if (typeof value !== 'string' || !FILE_KEY_RE.test(value)) {
    throw new Error('rewind: invalid fileKey');
  }
  return value;
}

export function validateCheckpointId(value: unknown): string {
  if (typeof value !== 'string' || !FILENAME_SAFE_RE.test(value)) {
    throw new Error('rewind: invalid checkpointId');
  }
  return value;
}

export function validateExternalCheckpointId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new Error('rewind: invalid checkpointId');
  }
  return value;
}

export function validateUndoToken(value: unknown): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new Error('rewind: invalid undoToken');
  }
  return value;
}

export function validateScope(value: unknown): RestoreScope {
  if (typeof value !== 'string' || !SCOPES.includes(value as RestoreScope)) {
    throw new Error('rewind: invalid scope');
  }
  return value as RestoreScope;
}

export function assertPathWithin(root: string, candidate: string): void {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  if (!resolvedCandidate.startsWith(prefix) && resolvedCandidate !== resolvedRoot) {
    throw new Error('rewind: path escape detected');
  }
}
