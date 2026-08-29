/**
 * The published package, imported the way Node imports it.
 *
 * Every other test in `packages/sdk/test` imports `../src/*`, so nothing in CI
 * ever resolved the `exports` map or read a single emitted specifier. That is
 * how `dist/index.js` came to say `export … from './detect'` — legal for Vite
 * and webpack, `ERR_MODULE_NOT_FOUND` for Node ESM, which is what Next.js
 * server components, `environment: 'node'` test runners and any plain
 * `node --eval` use.
 *
 * Vitest cannot catch this on its own: it resolves through Vite, which fills in
 * the missing extension exactly as a bundler does, so an `await import()` here
 * would pass against a broken build. The check therefore happens in a real
 * `node` child process, against the real `dist/`, entered by the package name
 * so the `exports` map is what does the resolving.
 *
 * If this file fails with ERR_MODULE_NOT_FOUND, a relative specifier lost its
 * `.js`. If it fails with ERR_MODULE_NOT_FOUND naming the package itself,
 * `dist/` was not built — `pnpm test` builds packages first for this reason.
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')

/**
 * A directory that links `@joeywallet/wallet-sdk` in its `node_modules`.
 *
 * pnpm links a workspace package only into the projects that declare it, and
 * nothing declares the SDK on itself. `gemwallet-compat` does, so its directory
 * is where a bare `@joeywallet/wallet-sdk` resolves the way a consumer's
 * `node_modules` will — through the `exports` map rather than a file path.
 */
const consumer = resolve(root, 'packages/gemwallet-compat')

/** Import `specifier` in a fresh Node process and report the named exports. */
function importInNode(specifier: string, cwd = consumer): string[] {
  const script = `
    const m = await import(${JSON.stringify(specifier)})
    process.stdout.write(JSON.stringify(Object.keys(m)))
  `
  const out = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return JSON.parse(out) as string[]
}

describe('the package resolves under Node ESM', () => {
  it('imports the main entry point by name', () => {
    const exports = importInNode('@joeywallet/wallet-sdk')
    // A representative value from each re-exported module, so a broken
    // specifier in any one of them fails rather than only the first.
    expect(exports).toEqual(
      expect.arrayContaining([
        'getJoey', // detect
        'createJoeyClient', // client
        'JoeyRpcError', // errors
        'JOEY_RPC_METHODS', // provider
        'JOEY_CHAINS', // types
        'mutationReducer', // mutation
      ]),
    )
  })

  it('imports the /vanilla entry point by name', () => {
    // The entry point whose whole purpose is script-tag dapps, and the one the
    // README's framework-free snippet uses.
    expect(importInNode('@joeywallet/wallet-sdk/vanilla')).toEqual(
      expect.arrayContaining(['createJoeySession', 'bindConnectButton']),
    )
  })

  it('imports the gemwallet compatibility layer, and the SDK through it', () => {
    // Published alongside the SDK and released with it, so it carries the same
    // requirement — and it is the first thing a migrating dapp imports.
    //
    // Entered by file path rather than by name because nothing in the workspace
    // declares a dependency on it, so pnpm links it nowhere. That costs the
    // `exports`-map hop and nothing else: its own relative specifiers are still
    // resolved by Node, and its bare `@joeywallet/wallet-sdk` import resolves
    // from `dist/`, which is the cross-package hop that matters here.
    const entry = pathToFileURL(resolve(root, 'packages/gemwallet-compat/dist/index.js')).href
    expect(importInNode(entry)).toEqual(
      expect.arrayContaining(['isInstalled', 'getAddress', 'sendPayment']),
    )
  })

  it('has no runtime dependencies to resolve', async () => {
    // The zero-dependency claim is the first bullet of the README. A `require`
    // of anything at all would have shown up as a resolution failure above; this
    // states the rule rather than leaving it implied.
    const pkg = (await import('../package.json', { with: { type: 'json' } })) as unknown as {
      default: { dependencies?: Record<string, string> }
    }
    expect(pkg.default.dependencies ?? {}).toEqual({})
  })
})
