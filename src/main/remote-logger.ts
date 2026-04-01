/**
 * Remote logger — barrel re-export.
 *
 * The implementation has been split into focused modules:
 * - src/shared/diagnostics-config.ts — config, session UID, Axiom transport, redaction paths
 * - src/main/vitals.ts — system vitals, disk stats, settings snapshot
 * - src/main/usage-tracker.ts — UsageTracker class, hashFileKey, redactMessage
 *
 * This file re-exports everything for backward compatibility with existing imports.
 */

// Config & transport (shared layer — no cross-layer dependency)
export {
  createAxiomTransport,
  type DiagnosticsConfig,
  deriveSupportCode,
  generateSessionUid,
  loadDiagnosticsConfig,
  REDACT_PATHS,
  reloadDiagnosticsConfig,
  saveDiagnosticsConfig,
} from '../shared/diagnostics-config.js';
// Usage tracker
export { hashFileKey, redactMessage, UsageTracker } from './usage-tracker.js';
// Vitals & settings
export {
  captureSettings,
  captureVitals,
  getDiskStats,
  type SettingsRefs,
  type SettingsSnapshotData,
  type Vitals,
} from './vitals.js';
