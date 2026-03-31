---
name: bottega-cicd
description: Use when setting up or modifying CI/CD pipelines for Bottega. Covers GitHub Actions workflows for Electron macOS app — esbuild build, TypeScript checking, vitest unit tests, Playwright-Electron smoke tests, electron-builder .dmg packaging, macOS code signing/notarization, and release automation. Triggers include "CI/CD", "GitHub Actions", "pipeline", "workflow", "build pipeline", "release", "code signing", "notarize", "dmg", "continuous integration".
---

# Bottega — CI/CD Guide

## When to Use

- Setting up GitHub Actions CI/CD pipeline for the first time
- Adding new CI jobs (type checking, unit tests, smoke tests, packaging)
- Configuring macOS code signing and notarization
- Automating .dmg releases via tags
- Optimizing CI performance (caching, parallelism)
- Troubleshooting CI failures

## Project Build Stack

| Step | Command | Tool | Output |
|------|---------|------|--------|
| Install | `npm ci` | npm | node_modules/ |
| Build | `node scripts/build.mjs` | esbuild | dist/main.js, dist/preload.js, dist/renderer/ |
| Type check | `npx tsc --noEmit` | TypeScript | (validation only) |
| Unit tests | `npm test` (vitest run) | Vitest | test results |
| E2E tests | `npx vitest run tests/compression-e2e.test.ts` | Vitest | test results |
| Smoke test | `node tests/electron-smoke.mjs` | Playwright-Electron | pass/fail |
| Package | `npx electron-builder --mac` | electron-builder | .dmg in dist/ |

**Key constraints:**
- Build produces ESM (main) + CJS (preload) via esbuild — NOT webpack/vite
- `packages: 'external'` — npm deps are NOT bundled, resolved at runtime
- Smoke test requires display (Electron needs a window manager)
- macOS-only packaging currently (electron-builder `--mac`)

## GitHub Actions Workflows

### 1. CI Workflow (Every Push/PR)

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

env:
  CI: true
  NODE_VERSION: '22'

jobs:
  # ── Fast checks (no display needed) ────────────────
  check:
    name: Build & Type Check
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm

      - run: npm ci

      - name: Build (esbuild)
        run: node scripts/build.mjs

      - name: Type check
        run: npx tsc --noEmit

      # Cache dist/ for downstream jobs
      - uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist/
          retention-days: 1

  # ── Unit tests (no display needed) ─────────────────
  unit-tests:
    name: Unit Tests
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm

      - run: npm ci

      - name: Run all tests
        run: npm test

  # ── Smoke test (macOS, needs display) ──────────────
  smoke-test:
    name: Electron Smoke Test
    needs: check
    runs-on: macos-latest
    timeout-minutes: 15

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm

      - run: npm ci

      # Download pre-built dist/
      - uses: actions/download-artifact@v4
        with:
          name: dist
          path: dist/

      - name: Run Electron smoke test
        run: node tests/electron-smoke.mjs
```

**Why macOS for smoke tests?**
- Electron needs a window manager. Ubuntu runners need `xvfb-run` workaround.
- macOS runners have a display server by default.
- The app uses macOS-specific features (`vibrancy: 'sidebar'`, `titleBarStyle: 'hiddenInset'`).

**Alternative — Ubuntu with xvfb** (cheaper, if macOS features aren't tested):
```yaml
    runs-on: ubuntu-latest
    steps:
      # ...
      - name: Run smoke test with xvfb
        run: xvfb-run --auto-servernum node tests/electron-smoke.mjs
```

### 2. Release Workflow (Tag-Triggered)

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write  # for creating GitHub release

env:
  NODE_VERSION: '22'

jobs:
  build-mac:
    name: Build macOS .dmg
    runs-on: macos-latest
    timeout-minutes: 30

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm

      - run: npm ci

      - name: Build
        run: node scripts/build.mjs

      - name: Type check
        run: npx tsc --noEmit

      - name: Package .dmg
        run: npx electron-builder --mac
        env:
          # Code signing (see Code Signing section below)
          CSC_LINK: ${{ secrets.MAC_CERTIFICATE_P12 }}
          CSC_KEY_PASSWORD: ${{ secrets.MAC_CERTIFICATE_PASSWORD }}
          # Notarization
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}

      - name: Upload .dmg artifact
        uses: actions/upload-artifact@v4
        with:
          name: bottega-mac
          path: dist/*.dmg
          retention-days: 30

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: dist/*.dmg
          generate_release_notes: true
          draft: true  # review before publishing
```

### 3. Nightly Build (Optional)

```yaml
# .github/workflows/nightly.yml
name: Nightly Build

on:
  schedule:
    - cron: '0 3 * * 1-5'  # Mon-Fri at 3am UTC
  workflow_dispatch:

jobs:
  nightly:
    uses: ./.github/workflows/ci.yml
    # Reuses the CI workflow — same checks, different trigger
```

## electron-builder Configuration

The project uses electron-builder (NOT Electron Forge). Configuration in `package.json`:

```json
{
  "build": {
    "appId": "com.bottega",
    "productName": "Bottega",
    "directories": {
      "output": "release"
    },
    "files": [
      "dist/**/*",
      "node_modules/**/*",
      "package.json"
    ],
    "mac": {
      "target": ["dmg"],
      "icon": "build/icon.icns",
      "category": "public.app-category.developer-tools",
      "hardenedRuntime": true,
      "gatekeeperAssess": false,
      "entitlements": "build/entitlements.mac.plist",
      "entitlementsInherit": "build/entitlements.mac.plist"
    },
    "dmg": {
      "sign": false,
      "contents": [
        { "x": 130, "y": 220 },
        { "x": 410, "y": 220, "type": "link", "path": "/Applications" }
      ]
    },
    "afterSign": "scripts/notarize.js"
  }
}
```

**Critical: `files` includes `node_modules/`** because `packages: 'external'` in esbuild means npm deps are resolved at runtime, not bundled.

## macOS Code Signing & Notarization

### Entitlements File

```xml
<!-- build/entitlements.mac.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.allow-dyld-environment-variables</key>
  <true/>
  <key>com.apple.security.network.client</key>
  <true/>
  <key>com.apple.security.network.server</key>
  <true/>
</dict>
</plist>
```

**Network entitlements are required** — the app runs a WebSocket server on port 9223.

### Notarization Script

```javascript
// scripts/notarize.js
const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  console.log(`Notarizing ${appName}...`);

  await notarize({
    appBundleId: 'com.figmacowork.app',
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });

  console.log('Notarization complete');
};
```

### GitHub Secrets Required

| Secret | Description | How to Get |
|--------|-------------|------------|
| `MAC_CERTIFICATE_P12` | Base64-encoded .p12 certificate | `base64 -i cert.p12` |
| `MAC_CERTIFICATE_PASSWORD` | Password for the .p12 | Set when exporting from Keychain |
| `APPLE_ID` | Apple Developer account email | developer.apple.com |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for notarization | appleid.apple.com → Security |
| `APPLE_TEAM_ID` | Apple Developer Team ID | developer.apple.com → Membership |

### Generating the Certificate

```bash
# 1. Create a Developer ID Application certificate in Apple Developer portal
# 2. Download and install in Keychain Access
# 3. Export as .p12
security find-identity -v -p codesigning
# 4. Base64 encode for GitHub secret
base64 -i "Developer ID Application.p12" | pbcopy
```

## Caching Strategy

### Node Modules

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: '22'
    cache: npm  # auto-caches ~/.npm based on package-lock.json
- run: npm ci   # clean install from lock file
```

### esbuild Build Cache

The build is fast (<5s with esbuild), so caching `dist/` between jobs within the same workflow is sufficient (via `upload-artifact` / `download-artifact`). No persistent cache needed.

### Playwright Browsers (for smoke tests)

```yaml
- name: Cache Playwright
  id: pw-cache
  uses: actions/cache@v4
  with:
    path: ~/Library/Caches/ms-playwright  # macOS path
    key: pw-${{ runner.os }}-${{ hashFiles('package-lock.json') }}

- name: Install Playwright
  if: steps.pw-cache.outputs.cache-hit != 'true'
  run: npx playwright install --with-deps chromium  # only Chromium needed for Electron
```

**Note:** On Ubuntu the path is `~/.cache/ms-playwright`. On macOS it's `~/Library/Caches/ms-playwright`.

## CI Pipeline Architecture

```
┌──────── Triggered on push/PR ────────┐
│                                       │
│  ┌─────────┐     ┌────────────┐      │
│  │  check   │     │ unit-tests │      │  (parallel, Ubuntu)
│  │ build+tsc│     │  vitest    │      │
│  └────┬─────┘     └────────────┘      │
│       │                               │
│       │ (artifact: dist/)             │
│       ▼                               │
│  ┌──────────┐                         │
│  │smoke-test│  (macOS, needs dist/)   │
│  │Playwright│                         │
│  │-Electron │                         │
│  └──────────┘                         │
└───────────────────────────────────────┘

┌──────── Triggered on tag v* ─────────┐
│                                       │
│  ┌───────────────────────────┐       │
│  │ build-mac                 │       │
│  │ npm ci → build → tsc     │       │
│  │ → electron-builder --mac  │       │
│  │ → sign → notarize        │       │
│  │ → GitHub Release (draft)  │       │
│  └───────────────────────────┘       │
└───────────────────────────────────────┘
```

## Common CI Issues

### Electron fails on Ubuntu (no display)

```yaml
# Use xvfb-run to create a virtual display
- run: xvfb-run --auto-servernum node tests/electron-smoke.mjs
```

Or use macOS runner (recommended for this project).

### electron-builder fails: "Cannot find module"

Check that `node_modules` is included in `files` config. The project uses `packages: 'external'` in esbuild, so deps MUST be in the packaged app.

### Notarization fails: "The software is not signed"

Ensure `hardenedRuntime: true` and correct entitlements. The Electron JIT/unsigned-memory entitlements are required.

### Build cache stale after dependency update

Cache keys include `hashFiles('package-lock.json')` — any dependency change busts the cache automatically.

### Smoke test timeout

The app waits for the Figma Desktop Bridge WebSocket connection. In CI, Figma Desktop isn't running, so the smoke test should only verify the app launches and renders UI, NOT Figma connectivity.

## Adding a New CI Job — Checklist

1. [ ] Does the job need a display? → macOS runner or `xvfb-run`
2. [ ] Does the job need `dist/`? → Add `needs: check` + download artifact
3. [ ] Does the job need secrets? → Add `environment:` and document required secrets
4. [ ] Set `timeout-minutes` (never leave default 6h)
5. [ ] Add `concurrency` group to avoid duplicate runs
6. [ ] Upload artifacts on failure with `if: ${{ !cancelled() }}`

## Future Improvements

When the project grows:
- **Auto-updater**: Add `electron-updater` + S3/GitHub Releases update server
- **Linux/Windows builds**: Add `runs-on: ubuntu-latest` / `runs-on: windows-latest` matrix
- **Test sharding**: When test suite exceeds 10 minutes, shard Playwright tests
- **Nightly regression**: Full test suite on schedule with Slack failure notifications
- **Performance budgets**: Track app startup time and memory usage in CI
