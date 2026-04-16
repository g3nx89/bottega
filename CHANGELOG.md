# Changelog

All notable changes to Bottega are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/), adhering to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.15.0] - 2026-04-16

### Added
- Dynamic per-model reasoning effort menu with Pi SDK capability introspection
- Per-model level filtering: drops silently coerced levels (GPT-5.x minimal, Anthropic adaptive minimal, Gemini 3 Pro minimal+medium)
- Contextual chip labels per provider family (Thinking budget / Reasoning effort / Thinking)
- Bulk "Apply model to all" for micro-judge model configuration
- Auth overhaul with factory reset, self-healing state, and OAuth test buttons
- Auth-model-fix plan (Sprint A-D, F1-F21) for multi-provider credential management
- Self-healing config validation: stale model references auto-fallback to defaults

### Changed
- Subagent sessions use in-memory SessionManager to prevent judge prompt leaks into main history
- Context bar preserves token count across model switches instead of resetting to zero
- Global status dot derived from restored tab state at boot (fixes IPC race)

### Fixed
- Session restore: tool cards stuck on spinner (Pi SDK uses `c.id` not `c.toolCallId`, `toolResult` not `tool_result`)
- Session restore: blinking cursor on text-less tool turns (empty `.message-content` removed)
- Session restore: phantom gray rectangles from hidden-only tool turns
- Session restore: legacy judge "Criterion:" prompts filtered from chat history
- Effort dropdown desync between chip label, menu checkmark, and session state after tab/model switch
- Removed gpt-5.4-nano from AVAILABLE_MODELS (not available via OpenAI codex subscription)
- Judge pre-check surfaces missing credentials as explicit SKIP instead of silent vacuous PASS
- IPC: add return await in figma:clear-page handler

## [0.14.0] - 2026-04-15

### Added
- Componentization judge overhaul with YAML-based tree detection and ancestor dedup

### Fixed
- Auto-updater freeze and esbuild ENOTDIR after update

## [0.13.0] - 2026-04-13

### Added
- Evidence-based severity system for micro-judge verdicts with deterministic pipeline
- Design quality vision judge with figma_flatten_layers tool
- Figma REST API Personal Access Token persistence with safeStorage encryption
- Workflow engine with knowledge layer for guided agent steps
- Task orchestration layer (Fase 1.5) with TaskStore and task panel
- QA assertion DSL: phase 2 sentinels, metric/metric_growth expressions (Fase 4)
- MetricsRegistry runtime instrumentation for agent performance tracking
- Runtime baseline oracle (Fase 3) and UX oracle baseline (Fase 3b)
- Design quality evaluators with rubrics and judge integration
- Visual regression, process metrics, and error injection in QA pipeline

### Changed
- Replace monolithic judge with 7 parallel micro-judges for faster evaluation
- Remove Haiku from main agent model selector
- Evidence fast-paths and consistency file data optimization in judge harness

### Fixed
- Judge: fallback targetNodeId from selection, fix tier inflation
- Judge: improve consistency accuracy, retry quality, and observability
- Resolve all 14 open bugs from QA Run 2 and Run 3/4/5 pattern occurrences
- Auto-flatten after render_jsx, lower IE thresholds, white bg export
- Canvas screenshot node finder uses findAll with largest-area selection
- CI: resolve eslint and biome lint errors, bump bundle size limit

## [0.12.0] - 2026-04-02

### Added
- Semantic extraction pipeline with composable extractors and YAML output
- Read-only parallel subagents with judge harness (scout, analyst, auditor, judge)
- Support code, auth telemetry, session tracking, and empty turn warning

### Fixed
- Missing batchId parameter in runSubagentBatch callers
- CI: playbook tests no longer require Anthropic API key
- CI: biome lint error in orchestrator-abort test

## [0.11.0] - 2026-04-01

### Added
- 10 new Figma tools: batch operations (batch_set_text, batch_set_fills, batch_transform), text scanning (scan_text_nodes), auto-layout, variant switching, and granular styles (text_style, effects, opacity, corner_radius)
- Operation progress infrastructure for long-running batch operations with WS timeout reset
- Shared test helpers (findTool, expectTextResult) in tool-test-utils

### Fixed
- Use getNodeByIdAsync for dynamic-page document access in all new plugin handlers
- Mixed-font text nodes no longer crash batch text and text style operations
- Font validation before text content mutation prevents partial state on error
- Batch fills now preserve explicit opacity from callers
- Auto-layout sizing uses correct Figma API enum (AUTO not HUG)
- SET_OPACITY clamps values to [0,1] matching existing handler behavior
- Progress ID namespace mapping between plugin and WS layers
- SCAN_TEXT_NODES yields based on visited nodes, not just results found
- Mutation compressor now handles instance.id for variant tool compression

## [0.10.0] - 2026-03-31

### Added
- Playbook test harness for deterministic agent testing without LLM calls (29 tests)
- Bottega Observatory skill for Axiom log investigation
- Bottega Dev Debug skill for interactive app debugging
- Consolidated post-edit hook script for parallel typecheck/biome/build

### Changed
- Upgrade Pi SDK from 0.61.0 to 0.64.0
- Reduce cyclomatic complexity across 4 files for Codacy compliance

## [0.9.0] - 2026-03-31

### Fixed
- Plugin setup banner shown incorrectly when Figma is running — read-only registration check now runs regardless of Figma state

## [0.8.0] - 2026-03-31

### Added
- Auto-install Figma plugin on startup with settings.json registration

### Changed
- Model-aware screenshot optimization — default 1x, auto-cap to AI vision ceiling

### Fixed
- Context bar now reflects real token usage, suggestion chips send directly

## [0.7.0] - 2026-03-30

### Added
- Turn analytics, feedback UI, and action bias prompt

## [0.6.0] - 2026-03-30

### Added
- Agent integration tests (32 tests across 5 tiers)
- Image generation integration tests (tier 5)
- Plugin version compatibility check between Bottega and Figma Bridge
- Multi-tab renderer UI with tab bar and prompt queue
- Multi-tab IPC, preload bridge, and app startup

### Changed
- Sync figma-console-mcp v1.19 — deep components, variants, annotations
- Reorganize test suite into unit/e2e/uat/scripts structure
- Extract helpers, split settings UI, parallelize cleanup

### Fixed
- Flaky grace period test + CI coverage upload
- Plugin hardening — reset scan counter, tighten manifest, postMessage origin
- Use dedicated port 9280 to avoid conflicts with figma-console-mcp
- Void floating promise from mainWindow.loadFile
- Revert await loadFile regression and fix E2E test suite

## [0.5.0] - 2026-03-25

### Added
- Single-instance lock and port conflict detection
- Diagnostics export and remote logging via Axiom
- String centralization

### Changed
- Use build-time constant for app version instead of app.getVersion()
- Enable anonymous diagnostics by default
- Embed Axiom ingest token for bottega-logs dataset

## [0.4.0] - 2026-03-24

### Added
- Persist chat sessions per Figma file across app restarts

## [0.3.1] - 2026-03-24

### Fixed
- Resolve multiple issues from user debug session logs

## [0.3.0] - 2026-03-24

### Added
- Figma plugin setup flow in Settings

### Fixed
- Fetch full git history for release notes generation

## [0.2.2] - 2026-03-24

### Fixed
- Parse HTML release notes in What's New modal, clean commit-based notes

## [0.2.1] - 2026-03-24

### Fixed
- Make settings panel scrollable to reveal Updates section

## [0.2.0] - 2026-03-24

### Added
- Update modals, What's New dialog, and manual update check

## [0.1.15] - 2026-03-24

### Added
- Show app version in titlebar

## [0.1.14] - 2026-03-24

### Fixed
- Use dynamic import() for electron-updater in ESM bundle

## [0.1.13] - 2026-03-23

### Fixed
- Ensure npm is in PATH when launched from Finder

## [0.1.12] - 2026-03-23

### Fixed
- CJS default import for electron-updater, DMG with Applications shortcut

## [0.1.11] - 2026-03-23

### Fixed
- Create DMG with hdiutil from signed+stapled app

## [0.1.10] - 2026-03-23

### Fixed
- Sign .node native binaries, add notarization error logging

## [0.1.9] - 2026-03-23

### Fixed
- Staple notarization ticket before creating DMG/ZIP

## [0.1.8] - 2026-03-23

### Added
- Generate latest-mac.yml for electron-updater auto-updates

## [0.1.7] - 2026-03-23

### Fixed
- Use gtimeout (coreutils) instead of timeout, fix signing flow

## [0.1.6] - 2026-03-23

### Fixed
- Manual signing with per-file logging and timeouts

## [0.1.5] - 2026-03-23

### Fixed
- Add codesign diagnostic test step before packaging

## [0.1.4] - 2026-03-23

### Fixed
- Correct keychain partition list password for CI code signing

## [0.1.3] - 2026-03-23

### Fixed
- Import Apple intermediate + root certs for CI code signing

## [0.1.2] - 2026-03-23

### Fixed
- Add codesign to keychain partition list, remove CSC_LINK conflict

## [0.1.1] - 2026-03-23

### Added
- Re-enable notarization with APPLE_ID_PASSWORD alias

## [0.1.0] - 2026-03-23

### Added
- Full Figma Companion app (phases 2-8)
- Multi-provider auth with model switching (Anthropic, OpenAI, Google)
- AI image generation tools, slash command menu, and security hardening
- Phase 1 context compression — ingestion-time compression with profiles, metrics, and UI
- Prompt suggestions, thinking spinner, screenshot fixes
- Input bar model/effort selectors, context usage bar, paste support
- OAuth login flow for Anthropic, OpenAI Codex, and Google Gemini CLI
- Persist LLM sessions to disk for debugging and analysis
- Settings panel with window transparency slider
- Graceful shutdown, persistent WS reconnect, pin window, structured logging

[Unreleased]: https://github.com/g3nx89/bottega/compare/v0.13.0...HEAD
[0.13.0]: https://github.com/g3nx89/bottega/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/g3nx89/bottega/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/g3nx89/bottega/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/g3nx89/bottega/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/g3nx89/bottega/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/g3nx89/bottega/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/g3nx89/bottega/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/g3nx89/bottega/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/g3nx89/bottega/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/g3nx89/bottega/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/g3nx89/bottega/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/g3nx89/bottega/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/g3nx89/bottega/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/g3nx89/bottega/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/g3nx89/bottega/compare/v0.1.15...v0.2.0
[0.1.15]: https://github.com/g3nx89/bottega/compare/v0.1.14...v0.1.15
[0.1.14]: https://github.com/g3nx89/bottega/compare/v0.1.13...v0.1.14
[0.1.13]: https://github.com/g3nx89/bottega/compare/v0.1.12...v0.1.13
[0.1.12]: https://github.com/g3nx89/bottega/compare/v0.1.11...v0.1.12
[0.1.11]: https://github.com/g3nx89/bottega/compare/v0.1.10...v0.1.11
[0.1.10]: https://github.com/g3nx89/bottega/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/g3nx89/bottega/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/g3nx89/bottega/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/g3nx89/bottega/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/g3nx89/bottega/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/g3nx89/bottega/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/g3nx89/bottega/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/g3nx89/bottega/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/g3nx89/bottega/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/g3nx89/bottega/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/g3nx89/bottega/releases/tag/v0.1.0
