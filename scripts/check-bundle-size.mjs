import { statSync } from 'node:fs';

// Ceilings kept slightly above the current build so routine feature work
// doesn't trip the gate, but a large regression still does. Bump when the
// delta approaches the limit — don't let either bundle drift unbounded.
const limits = {
  'dist/main.js':    { max: 800_000, label: 'Main bundle' },
  'dist/preload.js': { max: 20_000,  label: 'Preload bundle' },
};

let failed = false;
for (const [file, { max, label }] of Object.entries(limits)) {
  let stat;
  try {
    stat = statSync(file);
  } catch {
    console.error(`FAIL: ${label} (${file}) not found — run "npm run build" first`);
    failed = true;
    continue;
  }
  const size = stat.size;
  const kb = (size / 1024).toFixed(1);
  const maxKb = (max / 1024).toFixed(1);
  if (size > max) {
    console.error(`FAIL: ${label} (${file}) is ${kb}KB, limit is ${maxKb}KB`);
    failed = true;
  } else {
    console.log(`OK:   ${label} (${file}) is ${kb}KB (limit: ${maxKb}KB)`);
  }
}
if (failed) process.exit(1);
