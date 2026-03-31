---
name: smoke-test
description: Build the Electron app and run the smoke test to verify it launches, connects, and renders correctly
disable-model-invocation: true
---

# Smoke Test

Build and run the Electron smoke test suite.

## Steps

1. **Build**: Run `node scripts/build.mjs` to produce `dist/`
2. **Smoke test**: Run `node tests/electron-smoke.mjs`
3. **Report**: Summarize pass/fail results

## Usage

```bash
node scripts/build.mjs && node tests/electron-smoke.mjs
```

If the smoke test fails, read the test file to understand what it checks, diagnose the failure, and suggest fixes.
