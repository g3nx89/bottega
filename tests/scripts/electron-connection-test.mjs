// Debug utility — not a test. Run manually.
import { _electron as electron } from '@playwright/test';
import { setTimeout } from 'timers/promises';

async function main() {
  console.log('Launching Electron app...');

  const app = await electron.launch({
    args: ['dist/main.js'],
    timeout: 30000,
  });

  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await setTimeout(2000);

  console.log('App ready. Window title:', await window.title());

  // Initial state
  let statusClass = await (await window.$('#status-dot'))?.getAttribute('class');
  let statusTitle = await (await window.$('#status-dot'))?.getAttribute('title');
  console.log('Initial status:', statusClass, '|', statusTitle);
  await window.screenshot({ path: 'tests/screenshot-disconnected.png' });

  // Wait up to 45s for plugin connection
  console.log('\nWaiting up to 45s for Figma plugin... (reopen plugin in Figma NOW)');
  let connected = false;
  for (let i = 0; i < 90; i++) {
    await setTimeout(500);
    statusClass = await (await window.$('#status-dot'))?.getAttribute('class');
    if (statusClass?.includes('connected') && !statusClass?.includes('disconnected')) {
      connected = true;
      statusTitle = await (await window.$('#status-dot'))?.getAttribute('title');
      console.log('CONNECTED! Status title:', statusTitle);
      await window.screenshot({ path: 'tests/screenshot-connected.png' });
      break;
    }
    if (i % 10 === 0 && i > 0) console.log(`  ...waiting (${i/2}s)`);
  }

  if (!connected) {
    console.log('Plugin did not connect within 45s');
    await window.screenshot({ path: 'tests/screenshot-timeout.png' });
  }

  await app.close();
  console.log('Done');
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
