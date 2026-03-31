---
name: debug-ws
description: Debug the Figma WebSocket bridge connection on port 9280 — checks port, process, plugin, and connectivity
---

# Debug WebSocket Bridge

Run these diagnostics in sequence to troubleshoot the Figma Desktop Bridge connection:

## Step 1 — Port check
```bash
lsof -i :9280 -P -n 2>/dev/null || echo "Nothing listening on port 9280"
```
Is the WS server running? If not, the Electron app likely hasn't started or crashed.

## Step 2 — Electron process check
```bash
pgrep -fl "electron.*bottega\|Bottega" 2>/dev/null || echo "Bottega not running"
```

## Step 3 — Plugin manifest validation
Read `figma-desktop-bridge/manifest.json` and verify:
- `"name"` is `"Bottega Bridge"`
- `"api"` version is current
- `"main"` points to `"code.js"`
- `"ui"` points to `"ui.html"`

## Step 4 — WebSocket connectivity test
```bash
node -e "
const ws = new (require('ws'))('ws://127.0.0.1:9280');
const t = setTimeout(() => { console.log('TIMEOUT: No response in 3s'); process.exit(1); }, 3000);
ws.on('open', () => { console.log('CONNECTED: WebSocket handshake OK'); clearTimeout(t); ws.close(); });
ws.on('error', (e) => { console.log('ERROR:', e.message); clearTimeout(t); process.exit(1); });
"
```

## Step 5 — Diagnosis summary

Based on results, report:
- **Connection status**: Connected / Listening but no clients / Not listening / Port conflict
- **Common fixes**:
  - *"Nothing listening"* → Start the app with `npm start` or `npx electron dist/main.js`
  - *"Port conflict"* → Another process holds 9280. Kill it or check `src/main/startup-guards.ts` port logic
  - *"TIMEOUT"* → Server is up but plugin not connected. Open Figma Desktop → Plugins → Development → Run "Bottega Bridge"
  - *"ERROR: connect ECONNREFUSED"* → Same as "Nothing listening"
  - *"CONNECTED but agent can't reach Figma"* → Plugin UI panel must be open in Figma (the `ui.html` relay must be active)
