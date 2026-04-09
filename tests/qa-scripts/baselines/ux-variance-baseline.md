# UX Reviewer Variance Baseline

**Measured**: 2026-04-09
**Runs**: 3x Opus ux-reviewer on same screenshots (02-happy-path, 14-judge-and-subagents)
**Threshold**: regressionDimension=0.3 (must be > all measured dimension stddev)
**Prompt iterations needed**: 0

## Per-dimension stddev

| Script | visualQuality | responseClarity | toolSelection | uxCoherence | feedbackQuality |
|---|---|---|---|---|---|
| 02-happy-path | 0.000 | 0.118 | 0.118 | 0.118 | 0.000 |
| 14-judge-and-subagents | 0.000 | 0.118 | 0.000 | 0.118 | 0.118 |

## Overall scores

| Run | Score |
|---|---|
| Run 1 | 3.87 |
| Run 2 | 3.88 |
| Run 3 | 3.88 |

Overall stddev: 0.005

## Verdict

**PASS** — max observed stddev 0.118 vs threshold 0.30

## Notes

- Zero prompt iterations required. The SKILL.md prompt with "BE DETERMINISTIC" anchor
  instructions and 2-decimal precision scoring was sufficient on the first attempt.
- 4 dimensions (visualQuality x2, feedbackQuality x1, toolSelection x1) had stddev
  of exactly 0.000 — Opus returned identical scores across all 3 runs.
- The remaining dimensions varied by at most 0.25 points (e.g., 3.75 vs 4.00),
  which falls within the expected rounding granularity for 0.25-step anchors.
- AI provider: OpenAI GPT-5.4 (agent), Anthropic Claude Opus 4.6 (reviewer).
