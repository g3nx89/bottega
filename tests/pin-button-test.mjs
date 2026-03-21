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
  await setTimeout(1000);

  // 1. Verify pin button exists
  const pinBtn = await window.$('#pin-btn');
  console.log('Pin button present:', !!pinBtn);
  if (!pinBtn) {
    console.error('FAIL: Pin button not found');
    await app.close();
    process.exit(1);
  }

  // 2. Check initial state — should NOT be pinned
  const initialClass = await pinBtn.getAttribute('class');
  const initiallyPinned = initialClass.includes('pinned');
  console.log('Initial class:', initialClass);
  console.log('Initially pinned:', initiallyPinned);

  // Check window is not always-on-top initially
  const initialOnTop = await app.evaluate(({ BrowserWindow }) => {
    return BrowserWindow.getAllWindows()[0].isAlwaysOnTop();
  });
  console.log('Window initially always-on-top:', initialOnTop);

  // Take screenshot before click
  await window.screenshot({ path: 'tests/screenshot-pin-before.png' });
  console.log('Screenshot before pin saved');

  // 3. Click pin button → should activate
  await pinBtn.click();
  await setTimeout(300);

  const afterPinClass = await pinBtn.getAttribute('class');
  const isPinnedAfterClick = afterPinClass.includes('pinned');
  console.log('Class after pin click:', afterPinClass);
  console.log('Pinned after click:', isPinnedAfterClick);

  const afterOnTop = await app.evaluate(({ BrowserWindow }) => {
    return BrowserWindow.getAllWindows()[0].isAlwaysOnTop();
  });
  console.log('Window always-on-top after pin:', afterOnTop);

  // Take screenshot after pin
  await window.screenshot({ path: 'tests/screenshot-pin-after.png' });
  console.log('Screenshot after pin saved');

  // 4. Click again → should deactivate
  await pinBtn.click();
  await setTimeout(300);

  const afterUnpinClass = await pinBtn.getAttribute('class');
  const isPinnedAfterUnpin = afterUnpinClass.includes('pinned');
  console.log('Class after unpin click:', afterUnpinClass);
  console.log('Pinned after unpin:', isPinnedAfterUnpin);

  const afterUnpinOnTop = await app.evaluate(({ BrowserWindow }) => {
    return BrowserWindow.getAllWindows()[0].isAlwaysOnTop();
  });
  console.log('Window always-on-top after unpin:', afterUnpinOnTop);

  // Take screenshot after unpin
  await window.screenshot({ path: 'tests/screenshot-pin-unpinned.png' });
  console.log('Screenshot after unpin saved');

  // 5. Summary
  const allPassed =
    !initiallyPinned &&
    !initialOnTop &&
    isPinnedAfterClick &&
    afterOnTop &&
    !isPinnedAfterUnpin &&
    !afterUnpinOnTop;

  console.log('\n── Results ──');
  console.log(allPassed ? 'PASS: All pin toggle checks passed' : 'FAIL: Some checks failed');

  await app.close();
  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
