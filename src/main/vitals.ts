/**
 * System vitals capture and settings snapshot.
 *
 * Provides real-time system metrics for heartbeat telemetry
 * and settings state capture for event-driven logging.
 */

import { statfsSync } from 'node:fs';
import os from 'node:os';
import type { monitorEventLoopDelay } from 'node:perf_hooks';

// ── Shared disk helpers ──────────────────────────

const DISK_CACHE_TTL_MS = 60_000; // Refresh disk stats at most once per minute
let cachedDiskStats = { totalGB: 0, freeGB: 0, ts: 0 };

/** Get disk stats with 60s TTL cache (avoids sync syscall on every heartbeat). */
export function getDiskStats(): { totalGB: number; freeGB: number } {
  const now = Date.now();
  if (now - cachedDiskStats.ts < DISK_CACHE_TTL_MS) {
    return { totalGB: cachedDiskStats.totalGB, freeGB: cachedDiskStats.freeGB };
  }
  try {
    const stats = statfsSync(os.homedir());
    cachedDiskStats = {
      totalGB: Math.round(((stats.bsize * stats.blocks) / 1e9) * 10) / 10,
      freeGB: Math.round(((stats.bsize * stats.bavail) / 1e9) * 10) / 10,
      ts: now,
    };
    return { totalGB: cachedDiskStats.totalGB, freeGB: cachedDiskStats.freeGB };
  } catch {
    return { totalGB: 0, freeGB: 0 };
  }
}

// ── Vitals capture ───────────────────────────────

export interface Vitals {
  freeRamGB: number;
  diskFreeGB: number;
  processRssMB: number;
  processHeapMB: number;
  eventLoopLagMs: number;
  eventLoopLagP99Ms: number;
  uptimeSeconds: number;
}

/** Capture current system vitals. Sub-millisecond operations. */
export function captureVitals(eld?: ReturnType<typeof monitorEventLoopDelay>): Vitals {
  const mem = process.memoryUsage();
  const disk = getDiskStats();

  return {
    freeRamGB: Math.round((os.freemem() / 1e9) * 10) / 10,
    diskFreeGB: disk.freeGB,
    processRssMB: Math.round(mem.rss / 1e6),
    processHeapMB: Math.round(mem.heapUsed / 1e6),
    eventLoopLagMs: eld ? Math.round((eld.mean / 1e6) * 10) / 10 : 0,
    eventLoopLagP99Ms: eld ? Math.round((eld.percentile(99) / 1e6) * 10) / 10 : 0,
    uptimeSeconds: Math.round(process.uptime()),
  };
}

// ── Settings snapshot ────────────────────────────

export interface SettingsSnapshotData {
  model: { provider: string; modelId: string };
  thinkingLevel: string;
  compressionProfile: string;
  contextSize: number;
  auth: Record<string, string>;
  imageGen: { hasKey: boolean; model: string };
  windowPinned: boolean;
  windowOpacity: number;
  sendDiagnostics: boolean;
}

/**
 * Refs to live app state. UsageTracker reads from these on demand.
 * All fields are optional to allow incremental wiring.
 */
export interface SettingsRefs {
  getModelConfig?: () => { provider: string; modelId: string };
  getThinkingLevel?: () => string;
  getCompressionProfile?: () => string;
  getContextSize?: () => number;
  getAuthStatus?: () => Record<string, string>;
  getImageGenInfo?: () => { hasKey: boolean; model: string };
  getWindowPinned?: () => boolean;
  getWindowOpacity?: () => number;
  getDiagnosticsEnabled?: () => boolean;
}

/** Call an optional getter, returning fallback if the getter is undefined or returns undefined. */
function getOr<T>(getter: (() => T) | undefined, fallback: T): T {
  return getter ? (getter() ?? fallback) : fallback;
}

export function captureSettings(refs: SettingsRefs): SettingsSnapshotData {
  return {
    model: getOr(refs.getModelConfig, { provider: 'unknown', modelId: 'unknown' }),
    thinkingLevel: getOr(refs.getThinkingLevel, 'unknown'),
    compressionProfile: getOr(refs.getCompressionProfile, 'unknown'),
    contextSize: getOr(refs.getContextSize, 0),
    auth: getOr(refs.getAuthStatus, {}),
    imageGen: getOr(refs.getImageGenInfo, { hasKey: false, model: 'unknown' }),
    windowPinned: getOr(refs.getWindowPinned, false),
    windowOpacity: getOr(refs.getWindowOpacity, 1.0),
    sendDiagnostics: getOr(refs.getDiagnosticsEnabled, false),
  };
}
