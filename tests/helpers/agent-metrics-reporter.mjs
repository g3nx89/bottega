/**
 * Agent Metrics Reporter — Playwright custom reporter for agent integration tests.
 *
 * Collects per-test metrics (tool calls, errors, duration, turn metrics),
 * writes a structured report.json, and prints a summary table.
 */

import { mkdirSync, writeFileSync } from 'node:fs';

class AgentMetricsReporter {
  constructor() {
    this.results = [];
  }

  onTestEnd(test, result) {
    const findAttachment = (name) => {
      const att = result.attachments.find((a) => a.name === name);
      return att?.body?.toString() || null;
    };

    let toolCalls = [];
    try { toolCalls = JSON.parse(findAttachment('tool-calls') || '[]'); } catch {}

    let turnMetrics = null;
    try { turnMetrics = JSON.parse(findAttachment('turn-metrics') || 'null'); } catch {}

    this.results.push({
      name: test.title,
      file: test.location.file.split('/').pop(),
      status: result.status,
      durationMs: result.duration,
      retry: result.retry,
      tools: {
        count: toolCalls.length,
        errors: toolCalls.filter((t) => t.error).length,
        names: [...new Set(toolCalls.map((t) => t.name))],
      },
      response: {
        length: findAttachment('agent-response')?.length || 0,
      },
      figma: {
        nodeCount: (() => {
          const raw = findAttachment('figma-node-count');
          return raw !== null ? Number(raw) : null;
        })(),
      },
      turnMetrics,
    });
  }

  async onEnd() {
    // Filter to only agent tests (skip e2e/uat if reporter is global)
    const allAgentResults = this.results.filter((r) =>
      r.file?.startsWith('tier') || r.file?.includes('agent'),
    );
    if (allAgentResults.length === 0) return;

    // Deduplicate retried tests: keep only the final attempt per test title
    const lastAttemptMap = new Map();
    for (const r of allAgentResults) {
      lastAttemptMap.set(r.name, r);
    }
    const agentResults = [...lastAttemptMap.values()];

    const passed = agentResults.filter((r) => r.status === 'passed');
    const failed = agentResults.filter((r) => r.status === 'failed');
    const flaky = agentResults.filter((r) => r.status === 'passed' && r.retry > 0);

    const summary = {
      timestamp: new Date().toISOString(),
      totals: {
        total: agentResults.length,
        passed: passed.length,
        failed: failed.length,
        flaky: flaky.length,
        passRate: agentResults.length > 0
          ? ((passed.length / agentResults.length) * 100).toFixed(1) + '%'
          : '0%',
      },
      timing: {
        totalMs: agentResults.reduce((s, r) => s + r.durationMs, 0),
        avgPassedMs: passed.length
          ? Math.round(passed.reduce((s, r) => s + r.durationMs, 0) / passed.length)
          : 0,
        slowest: [...agentResults]
          .sort((a, b) => b.durationMs - a.durationMs)
          .slice(0, 5)
          .map((r) => ({ name: r.name, ms: r.durationMs, status: r.status })),
      },
      quality: {
        avgToolsPerTest: passed.length
          ? (passed.reduce((s, r) => s + r.tools.count, 0) / passed.length).toFixed(1)
          : '0',
        totalToolErrors: agentResults.reduce((s, r) => s + r.tools.errors, 0),
        toolsUsed: [...new Set(agentResults.flatMap((r) => r.tools.names))].sort(),
      },
      tests: agentResults,
    };

    mkdirSync('tests/.artifacts/agent', { recursive: true });
    writeFileSync('tests/.artifacts/agent/report.json', JSON.stringify(summary, null, 2));

    const sec = (ms) => (ms / 1000).toFixed(1) + 's';
    const pad = (s, n = 47) => s.padEnd(n).slice(0, n);
    console.log('');
    console.log('+----------------------------------------------+');
    console.log('|          Agent Test Quality Report            |');
    console.log('+----------------------------------------------+');
    console.log('|' + pad(` Tests:     ${passed.length}/${agentResults.length} passed (${summary.totals.passRate})`) + '|');
    console.log('|' + pad(` Flaky:     ${flaky.length}`) + '|');
    console.log('|' + pad(` Avg time:  ${sec(summary.timing.avgPassedMs)}`) + '|');
    console.log('|' + pad(` Total:     ${sec(summary.timing.totalMs)}`) + '|');
    console.log('|' + pad(` Tools/test:${summary.quality.avgToolsPerTest}`) + '|');
    console.log('|' + pad(` Tool errs: ${summary.quality.totalToolErrors}`) + '|');
    console.log('|' + pad(` Unique tools: ${summary.quality.toolsUsed.length}`) + '|');
    if (failed.length > 0) {
      console.log('+----------------------------------------------+');
      console.log('|' + pad(' Failed:') + '|');
      for (const f of failed.slice(0, 8)) {
        console.log('|' + pad(`   x ${f.name}`) + '|');
      }
    }
    console.log('+----------------------------------------------+');
    console.log('| Report: tests/.artifacts/agent/report.json    |');
    console.log('+----------------------------------------------+');
    console.log('');
  }

  printsToStdio() {
    return false; // Let built-in reporter handle stdio too
  }
}

export default AgentMetricsReporter;
