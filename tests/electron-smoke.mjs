import { _electron as electron } from '@playwright/test';
import { setTimeout } from 'timers/promises';

async function main() {
  console.log('Launching Electron app...');

  const app = await electron.launch({
    args: ['dist/main.js'],
    timeout: 30000,
  });

  // Wait for the first window
  const window = await app.firstWindow();
  console.log('Window opened:', await window.title());

  // Wait for page to fully load
  await window.waitForLoadState('domcontentloaded');
  await setTimeout(2000);

  // Take screenshot of initial state
  await window.screenshot({ path: 'tests/screenshot-initial.png' });
  console.log('Initial screenshot saved');

  // Check UI elements
  const title = await window.textContent('#app-title');
  console.log('App title:', title);

  const statusDot = await window.$('#status-dot');
  const statusClass = await statusDot?.getAttribute('class');
  console.log('Status dot class:', statusClass);

  const statusTitle = await statusDot?.getAttribute('title');
  console.log('Status title:', statusTitle);

  const inputField = await window.$('#input-field');
  console.log('Input field present:', !!inputField);

  const sendBtn = await window.$('#send-btn');
  console.log('Send button present:', !!sendBtn);

  // Wait for Figma plugin to connect (up to 15s)
  console.log('\nWaiting for Figma plugin connection (reopen plugin in Figma now)...');
  let connected = false;
  for (let i = 0; i < 30; i++) {
    await setTimeout(500);
    const currentClass = await (await window.$('#status-dot'))?.getAttribute('class');
    if (currentClass?.includes('connected') && !currentClass?.includes('disconnected')) {
      connected = true;
      const connTitle = await (await window.$('#status-dot'))?.getAttribute('title');
      console.log('Connected! Status title:', connTitle);
      break;
    }
  }

  if (!connected) {
    console.log('Plugin did not connect within 15s');
  }

  // Take final screenshot
  await window.screenshot({ path: 'tests/screenshot-final.png' });
  console.log('Final screenshot saved');

  // Close app
  await app.close();
  console.log('\nTest complete');
}

main().catch(err => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
