// Debug utility — not a test. Run manually.
import { chromium } from '@playwright/test';
import { setTimeout } from 'timers/promises';

async function main() {
  console.log('Connecting to running Electron app via CDP...');

  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const contexts = browser.contexts();
  console.log('Browser contexts:', contexts.length);

  if (contexts.length === 0) {
    console.log('No contexts found');
    await browser.close();
    return;
  }

  const pages = contexts[0].pages();
  console.log('Pages:', pages.length);

  const page = pages.find(p => p.url().includes('index.html')) || pages[0];
  console.log('Page URL:', page.url());

  await setTimeout(1000);

  // Check status
  const statusClass = await (await page.$('#status-dot'))?.getAttribute('class');
  const statusText = await page.textContent('#status-text');
  console.log('Status dot class:', statusClass);
  console.log('Status text:', statusText);

  const isConnected = statusClass?.includes('connected') && !statusClass?.includes('disconnected');
  console.log('Connected:', isConnected);

  // Take screenshot
  await page.screenshot({ path: 'tests/screenshot-live.png' });
  console.log('Screenshot saved to tests/screenshot-live.png');

  await browser.close();
  console.log('Done');
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
