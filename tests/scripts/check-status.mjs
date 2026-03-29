// Debug utility — not a test. Run manually.
import { _electron as electron } from '@playwright/test';
import { setTimeout } from 'timers/promises';

// Connect to the already-running Electron app by launching a new instance
// that checks connection status
// Actually, we can't attach to a running Electron.
// Instead, let's just check the WS server status directly.

import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:9280');

ws.on('open', () => {
  console.log('WebSocket connection to server: OK');
  // Send a status check
  ws.send(JSON.stringify({ type: 'status' }));
  setTimeout(1000).then(() => {
    ws.close();
    console.log('Server is accepting connections');
    process.exit(0);
  });
});

ws.on('error', (err) => {
  console.log('WebSocket connection failed:', err.message);
  process.exit(1);
});

ws.on('message', (data) => {
  console.log('Received:', data.toString().substring(0, 200));
});
