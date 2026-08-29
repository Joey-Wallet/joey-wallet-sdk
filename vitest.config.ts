import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    /**
     * `node` is the default realm because most of the SDK is transport and
     * parameter shaping, which has no DOM. The two files that need a document
     * — `detect.test.ts`, and anything exercising `window.joey` discovery —
     * opt in with a `// @vitest-environment jsdom` pragma at the top of the
     * file. That is deliberate: `detect.ts` reports listener exceptions to the
     * global, and only a real DOM realm routes them somewhere userland can
     * contain them. Running it under `node` against a bare `EventTarget` sent
     * them to `process.uncaughtException`, which is unreachable — the bug that
     * made the suite exit 1 while every assertion passed.
     */
    environment: 'node',
    include: ['packages/**/test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json', 'html'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.d.ts', '**/dist/**'],
    },
  },
})
