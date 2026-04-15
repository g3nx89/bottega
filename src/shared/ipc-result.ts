/**
 * Canonical IPC response envelope shared by main + renderer.
 *
 * The codebase historically mixed `{success, error, code?}`, `{ok, error?}`,
 * and bare booleans. That churn caused renderer code to accumulate
 * `if (res.ok ?? res.success)` defensive checks. This module defines the
 * one-true-envelope for new handlers. Existing handlers are migrated
 * opportunistically; both legacy shapes remain readable by `isOk()` so
 * the cutover is non-breaking.
 */

export interface IpcSuccess<T = undefined> {
  success: true;
  data?: T;
}

export interface IpcFailure {
  success: false;
  error: string;
  code?: string;
}

export type IpcResult<T = undefined> = IpcSuccess<T> | IpcFailure;

export function ok<T>(data?: T): IpcResult<T> {
  return data === undefined ? { success: true } : { success: true, data };
}

export function fail(error: string, code?: string): IpcFailure {
  return code ? { success: false, error, code } : { success: false, error };
}

/**
 * Type-guard that accepts both the new envelope and legacy shapes
 * (`{ok: true}`, bare booleans). Lets renderer callsites use a single check
 * during the rolling migration.
 */
export function isOk<T>(value: unknown): value is IpcSuccess<T> {
  if (value === true) return true;
  if (value && typeof value === 'object') {
    const v = value as { success?: unknown; ok?: unknown };
    return v.success === true || v.ok === true;
  }
  return false;
}
