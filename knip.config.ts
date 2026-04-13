export default {
  entry: ['src/main/index.ts', 'src/main/preload.ts', 'tests/**/*.ts', 'scripts/*.{ts,mjs}'],
  project: ['src/**/*.ts', 'tests/**/*.ts'],
  ignore: ['src/figma/**'],  // embedded upstream — not our code to prune
  ignoreDependencies: [
    '@axiomhq/pino',   // pino transport loaded dynamically by name
    '@iconify/core',   // re-exported through @iconify/utils
    'pino-pretty',     // pino transport loaded dynamically by name
    '@eslint/js',      // used by eslint.config.mjs (knip doesn't trace flat config)
    '@mariozechner/pi-agent-core',  // transitive dep of pi-coding-agent, used for types
  ],
  ignoreBinaries: [
    'which',    // used in lint:arch script
    'semgrep',  // optional linter, checked with `which` guard
    'tsx',      // used for benchmark scripts
  ],
  exclude: ['unresolved', 'exports', 'types', 'duplicates'],  // exported types are API surface; duplicates = intentional aliases
};
