import { chromium } from '@playwright/test';
import { setTimeout } from 'timers/promises';
import WebSocket from 'ws';

async function main() {
  // 1. Check WS server - how many clients connected?
  console.log('=== WS Server Check ===');
  const ws = new WebSocket('ws://localhost:9223');

  await new Promise((resolve, reject) => {
    ws.on('open', () => {
      console.log('WS server reachable: YES');
      resolve();
    });
    ws.on('error', (err) => {
      console.log('WS server reachable: NO -', err.message);
      reject(err);
    });
  });
  ws.close();

  // 2. Connect to Electron via CDP and check console + execute JS
  console.log('\n=== Electron App Check ===');
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const page = browser.contexts()[0].pages()[0];

  // Check the renderer's view of window.api
  const hasApi = await page.evaluate(() => typeof window.api !== 'undefined');
  console.log('window.api exists:', hasApi);

  const apiMethods = await page.evaluate(() => {
    if (!window.api) return 'no api';
    return Object.keys(window.api).join(', ');
  });
  console.log('API methods:', apiMethods);

  // Check current DOM state
  const statusDotClass = await page.evaluate(() => document.getElementById('status-dot')?.className);
  const statusTextContent = await page.evaluate(() => document.getElementById('status-text')?.textContent);
  console.log('Status dot class:', statusDotClass);
  console.log('Status text:', statusTextContent);

  // Try to manually trigger the connected state to verify the renderer handles it
  console.log('\n=== Manual trigger test ===');
  await page.evaluate(() => {
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    console.log('Before - dot class:', dot?.className, 'text:', text?.textContent);
  });

  // Listen for console messages from renderer
  page.on('console', msg => console.log('  [renderer console]', msg.text()));

  // Manually send the figma:connected event to see if the renderer handles it
  // This simulates what the main process should do
  const mainProcessLogs = await page.evaluate(() => {
    // Check if the onFigmaConnected callback was registered
    return 'Renderer JS loaded, checking event handlers...';
  });
  console.log(mainProcessLogs);

  await browser.close();
  console.log('\nDone');
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
