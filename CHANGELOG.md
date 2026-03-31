# Changelog

All notable changes to Bottega are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/), adhering to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/g3nx89/bottega/compare/v0.9.0...HEAD
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
