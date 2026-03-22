/**
 * Electron smoke test for compression system.
 *
 * Verifies that the compression UI controls are present and functional
 * without requiring a Figma connection.
 *
 * Run: node scripts/build.mjs && node tests/electron-compression-smoke.mjs
 */

import { _electron as electron } from '@playwright/test';
import { setTimeout } from 'timers/promises';

async function main() {
  console.log('Launching Electron app for compression smoke test...');

  const app = await electron.launch({
    args: ['dist/main.js'],
    timeout: 30000,
  });

  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await setTimeout(2000);

  let passed = 0;
  let failed = 0;

  function check(name, condition) {
    if (condition) {
      console.log(`  PASS: ${name}`);
      passed++;
    } else {
      console.log(`  FAIL: ${name}`);
      failed++;
    }
  }

  // ── Settings panel has compression UI ──────────

  console.log('\n1. Checking compression UI elements...');

  // Open settings panel
  const settingsBtn = await window.$('#settings-btn');
  check('Settings button exists', !!settingsBtn);
  if (settingsBtn) await settingsBtn.click();
  await setTimeout(500);

  // Check profile selector
  const profileSelect = await window.$('#compression-profile-select');
  check('Profile selector exists', !!profileSelect);

  // Check default value is balanced
  const defaultProfile = await profileSelect?.inputValue();
  check('Default profile is "balanced"', defaultProfile === 'balanced');

  // Check description element
  const descEl = await window.$('#compression-profile-desc');
  check('Profile description element exists', !!descEl);
  const descText = await descEl?.textContent();
  check('Description is non-empty', descText && descText.length > 0);

  // Check refresh button
  const refreshBtn = await window.$('#compression-refresh-btn');
  check('Refresh cache button exists', !!refreshBtn);

  // ── Profile switching ──────────────────────────

  console.log('\n2. Testing profile switching...');

  // Switch to minimal
  if (profileSelect) {
    await profileSelect.selectOption('minimal');
    await setTimeout(300);
    const newProfile = await profileSelect.inputValue();
    check('Profile switched to "minimal"', newProfile === 'minimal');

    const newDesc = await descEl?.textContent();
    check('Description updated after switch', newDesc && newDesc !== descText);
  }

  // Switch back to balanced
  if (profileSelect) {
    await profileSelect.selectOption('balanced');
    await setTimeout(300);
    const restored = await profileSelect.inputValue();
    check('Profile restored to "balanced"', restored === 'balanced');
  }

  // ── Cache refresh button ───────────────────────

  console.log('\n3. Testing cache refresh...');

  if (refreshBtn) {
    await refreshBtn.click();
    await setTimeout(500);
    const btnText = await refreshBtn.textContent();
    check('Refresh button shows feedback', btnText === 'Done!' || btnText === 'Refresh caches');
  }

  // ── Profile options ────────────────────────────

  console.log('\n4. Checking all profile options...');

  if (profileSelect) {
    const options = await profileSelect.$$('option');
    const values = await Promise.all(options.map((o) => o.getAttribute('value')));
    check('Has 4 profile options', values.length === 4);
    check('Has balanced option', values.includes('balanced'));
    check('Has creative option', values.includes('creative'));
    check('Has exploration option', values.includes('exploration'));
    check('Has minimal option', values.includes('minimal'));
  }

  // ── IPC roundtrip ──────────────────────────────

  console.log('\n5. Testing IPC roundtrip...');

  const ipcProfile = await window.evaluate(() => window.api.compressionGetProfile());
  check('IPC get-profile returns a string', typeof ipcProfile === 'string');
  check('IPC get-profile matches UI', ipcProfile === 'balanced');

  const profiles = await window.evaluate(() => window.api.compressionGetProfiles());
  check('IPC get-profiles returns array', Array.isArray(profiles));
  check('IPC get-profiles has 4 entries', profiles?.length === 4);
  check('Profiles have descriptions', profiles?.[0]?.description?.length > 0);

  // ── App still runs normally ────────────────────

  console.log('\n6. Verifying app stability...');

  await window.screenshot({ path: 'tests/screenshot-compression-smoke.png' });
  check('Screenshot captured without crash', true);

  const title = await window.textContent('#app-title');
  check('App title still visible', !!title);

  // ── Summary ────────────────────────────────────

  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(40));

  await app.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
