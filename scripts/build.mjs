import { build } from 'esbuild'
import { cpSync, mkdirSync, readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  packages: 'external',  // Don't bundle node_modules — resolve at runtime
  external: ['electron'],
  define: { '__APP_VERSION__': JSON.stringify(pkg.version) },
}

await Promise.all([
  build({ ...common, entryPoints: ['src/main/index.ts'], outfile: 'dist/main.js' }),
  // Preload MUST be CJS — Electron's sandbox doesn't support ESM imports
  build({ ...common, format: 'cjs', entryPoints: ['src/main/preload.ts'], outfile: 'dist/preload.js' }),
])

// Copy renderer assets (HTML/CSS/JS) to dist/renderer/
mkdirSync('dist/renderer', { recursive: true })
cpSync('src/renderer', 'dist/renderer', { recursive: true })

console.log('Build complete.')
