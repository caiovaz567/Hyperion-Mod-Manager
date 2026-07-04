import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      // Main-process modules import electron at the top level; the stub satisfies
      // module loading so their pure functions can be unit-tested outside Electron.
      electron: path.resolve(__dirname, 'tests/stubs/electron.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // Node by default; DOM-dependent suites (fomodParser) opt into happy-dom via
    // a `// @vitest-environment happy-dom` pragma at the top of the file.
    environment: 'node',
  },
})
