import { statSync } from 'node:fs';

const limits = {
  'dist/main.js':    { max: 600_000, label: 'Main bundle' },
  'dist/preload.js': { max: 15_000,  label: 'Preload bundle' },
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
