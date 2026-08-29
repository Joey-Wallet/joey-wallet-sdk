// @vitest-environment jsdom
/**
 * Detection, in the realm detection is for.
 *
 * This file used to run under `environment: 'node'` against
 * `installEventTargetShim`'s bare `EventTarget`, which is a page in exactly one
 * respect — it has `addEventListener` — and is not a page in the one that
 * decides this file's hardest case. A DOM global *reports* a listener's
 * exception synchronously, as a cancellable `error` event, which is the
 * mechanism `dispatchQuietly` contains it with; a bare `EventTarget` defers to
 * `process`'s `uncaughtException` on a later tick, where nothing in userland can
 * reach it. Under node the "survives a page listener that throws" test below
 * therefore passed while leaking two uncaught exceptions into the run, and
 * `pnpm test` exited non-zero over a suite in which every assertion held.
 *
 * jsdom is the faithful realm here, not the heavier one: `detect.ts` reads page
 * globals and dispatches page events, and every assertion below is about a
 * window. The shim stays for `installEventTargetShim`'s own no-op guard —
 * `globalThis` is the window here, so it already has the listener methods.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { getJoey, isJoeyAvailable, requireJoey, waitForJoey } from '../src/detect'
import { JOEY_ERROR_CODES, JoeyRpcError } from '../src/errors'
import {
  CAIP294_ANNOUNCE_EVENT,
  CAIP294_PROMPT_EVENT,
  WALLET_STANDARD_APP_READY_EVENT,
  WALLET_STANDARD_REGISTER_EVENT,
} from '../src/provider'
import {
  announce,
  clearProviders,
  createMockProvider,
  installEventTargetShim,
  installNestedProvider,
  installProvider,
  removeEventTargetShim,
} from './harness'

beforeAll(() => {
  installEventTargetShim()
})

afterAll(() => {
  removeEventTargetShim()
})

afterEach(() => {
  clearProviders()
})

describe('synchronous detection', () => {
  it('reports absence without touching the wallet', () => {
    expect(isJoeyAvailable()).toBe(false)
    expect(getJoey()).toBeNull()
  })

  it('finds window.joey', () => {
    installProvider(createMockProvider())
    expect(isJoeyAvailable()).toBe(true)
    expect(getJoey()).not.toBeNull()
  })

  it('finds window.xrpl.joey without disturbing the rest of window.xrpl', () => {
    installNestedProvider(createMockProvider())
    expect(getJoey()).not.toBeNull()
    const xrpl = (globalThis as unknown as { xrpl: Record<string, unknown> }).xrpl
    expect(xrpl.isCrossmark).toBe(true)
    expect(xrpl.crossmark).toBeDefined()
  })

  it('ignores an object that is not a provider', () => {
    ;(globalThis as unknown as { joey: unknown }).joey = { notAProvider: true }
    expect(isJoeyAvailable()).toBe(false)
  })

  it('returns the same client across calls so listeners are not orphaned', () => {
    installProvider(createMockProvider())
    expect(getJoey()).toBe(getJoey())
  })

  it('rebuilds the client when the injected object is replaced', () => {
    installProvider(createMockProvider())
    const first = getJoey()
    installProvider(createMockProvider())
    expect(getJoey()).not.toBe(first)
  })

  it('requireJoey throws 4900 when nothing is injected', () => {
    expect(() => requireJoey()).toThrowError(JoeyRpcError)
    try {
      requireJoey()
    } catch (error) {
      expect((error as JoeyRpcError).code).toBe(JOEY_ERROR_CODES.DISCONNECTED)
    }
  })

  it('exposes the provider version', () => {
    installProvider(createMockProvider({ version: '9.9.9' }))
    expect(getJoey()?.version).toBe('9.9.9')
  })
})

describe('waitForJoey', () => {
  it('settles in the same microtask when the provider is already present', async () => {
    installProvider(createMockProvider())

    let settledSynchronously = true
    const promise = waitForJoey().then((joey) => {
      expect(settledSynchronously).toBe(true)
      return joey
    })
    // A timer callback would run after any already-queued microtask, so this
    // flag proves no timer or round trip was involved.
    queueMicrotask(() => {
      settledSynchronously = false
    })

    await expect(promise).resolves.not.toBeNull()
  })

  it('resolves on the CAIP-294 announcement', async () => {
    const pending = waitForJoey({ timeoutMs: 2000 })
    installProvider(createMockProvider())
    announce(CAIP294_ANNOUNCE_EVENT)
    await expect(pending).resolves.not.toBeNull()
  })

  it('resolves on the wallet-standard registration event', async () => {
    const pending = waitForJoey({ timeoutMs: 2000 })
    installProvider(createMockProvider())
    announce(WALLET_STANDARD_REGISTER_EVENT)
    await expect(pending).resolves.not.toBeNull()
  })

  /**
   * The half of the handshake `waitForJoey` exists for.
   *
   * Every case above has the wallet arriving *after* the wait starts, which is
   * the easy direction and not the one this function is for. The case it is for
   * is a dapp bundle that ran late: the wallet installed and announced itself
   * before there was anybody listening, and a second announcement is never
   * coming. Listening alone would then time out against a wallet already
   * sitting on `window.joey`, and only the 50ms poll would save it.
   *
   * Both protocols define an app-side prompt for exactly this, and Joey answers
   * both: CAIP-294's `wallet_prompt` makes it re-announce, and Wallet
   * Standard's `app-ready` carries a `register` callback it calls immediately.
   */
  describe('prompting wallets that already announced', () => {
    it('dispatches wallet_prompt and resolves on the re-announcement', async () => {
      // A wallet that announced into an empty page, then went quiet — exactly
      // what a `document_start` injection looks like to a late bundle.
      const provider = createMockProvider()
      let announcements = 0
      const onPrompt = (): void => {
        announcements += 1
        installProvider(provider)
        announce(CAIP294_ANNOUNCE_EVENT)
      }
      globalThis.addEventListener(CAIP294_PROMPT_EVENT, onPrompt)

      try {
        await expect(waitForJoey({ timeoutMs: 2000 })).resolves.not.toBeNull()
        expect(announcements).toBe(1)
      } finally {
        globalThis.removeEventListener(CAIP294_PROMPT_EVENT, onPrompt)
      }
    })

    it('dispatches wallet-standard:app-ready with a callable register', async () => {
      const provider = createMockProvider()
      let registered: unknown = null
      const onAppReady = (event: Event): void => {
        const detail = (event as CustomEvent<{ register(wallet: unknown): () => void }>).detail
        installProvider(provider)
        // What a Wallet Standard wallet does with the callback: hand over its
        // wallet object and keep the unregister function.
        registered = detail.register({ name: 'Joey' })
      }
      globalThis.addEventListener(WALLET_STANDARD_APP_READY_EVENT, onAppReady)

      try {
        await expect(waitForJoey({ timeoutMs: 2000 })).resolves.not.toBeNull()
        expect(typeof registered).toBe('function')
      } finally {
        globalThis.removeEventListener(WALLET_STANDARD_APP_READY_EVENT, onAppReady)
      }
    })

    it('does not prompt when the provider was already there', async () => {
      // The synchronous path settles before any listener is attached, so a page
      // with a wallet on it never sees these events at all.
      installProvider(createMockProvider())
      let prompts = 0
      const count = (): void => {
        prompts += 1
      }
      globalThis.addEventListener(CAIP294_PROMPT_EVENT, count)

      try {
        await waitForJoey({ timeoutMs: 2000 })
        expect(prompts).toBe(0)
      } finally {
        globalThis.removeEventListener(CAIP294_PROMPT_EVENT, count)
      }
    })

    it('survives a page listener that throws, and absorbs the report', async () => {
      // A prompt is a courtesy to a wallet that may not exist. A hostile or
      // merely broken listener on either event must cost a poll interval, not
      // the detection — and, because `dispatchEvent` reports rather than
      // rethrows, must not cost the page an unhandled error either.
      //
      // Both halves are asserted. Surviving is the weaker half and was never in
      // doubt: `dispatchEvent` has nothing to give us, so no `catch` was ever
      // load-bearing. The half that used to fail is the second one — the
      // exception reached the global as an *uncontained* report, which is a
      // page's `onerror`, a dapp's crash reporter, and this runner's
      // unhandled-error channel. `defaultPrevented` is read after the fact
      // rather than inside the listener, because this listener is registered
      // first and the SDK's absorber runs after it.
      const hostile = (): never => {
        throw new Error('nope')
      }
      const reports: Event[] = []
      const record = (event: Event): void => {
        reports.push(event)
      }
      window.addEventListener('error', record)
      globalThis.addEventListener(CAIP294_PROMPT_EVENT, hostile)
      globalThis.addEventListener(WALLET_STANDARD_APP_READY_EVENT, hostile)

      try {
        const pending = waitForJoey({ timeoutMs: 2000 })
        installProvider(createMockProvider())
        announce(CAIP294_ANNOUNCE_EVENT)
        await expect(pending).resolves.not.toBeNull()

        expect(reports).toHaveLength(2)
        expect(reports.every((event) => event.defaultPrevented)).toBe(true)
      } finally {
        window.removeEventListener('error', record)
        globalThis.removeEventListener(CAIP294_PROMPT_EVENT, hostile)
        globalThis.removeEventListener(WALLET_STANDARD_APP_READY_EVENT, hostile)
      }
    })

    it('absorbs only what its own dispatch reported', async () => {
      // The absorber is installed for the synchronous duration of one dispatch
      // and removed in `finally`. An error the page reports on its own — before
      // or after — must reach the page's handlers uncancelled, or the SDK has
      // quietly taken over error reporting for a document it does not own.
      const seen: boolean[] = []
      const record = (event: Event): void => {
        // Read in a microtask so the SDK's absorber, which runs after this
        // listener, has had its chance at the event.
        queueMicrotask(() => seen.push(event.defaultPrevented))
      }
      window.addEventListener('error', record)

      try {
        window.dispatchEvent(new ErrorEvent('error', { cancelable: true }))
        await waitForJoey({ timeoutMs: 20 }).catch(() => undefined)
        window.dispatchEvent(new ErrorEvent('error', { cancelable: true }))
        await Promise.resolve()

        expect(seen).toEqual([false, false])
      } finally {
        window.removeEventListener('error', record)
      }
    })
  })

  it('rejects with 4900 after the timeout', async () => {
    await expect(waitForJoey({ timeoutMs: 20 })).rejects.toMatchObject({
      code: JOEY_ERROR_CODES.DISCONNECTED,
    })
  })

  it('honours an abort signal', async () => {
    const controller = new AbortController()
    const pending = waitForJoey({ timeoutMs: 5000, signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toBeInstanceOf(JoeyRpcError)
  })

  it('rejects immediately for an already-aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      waitForJoey({ timeoutMs: 5000, signal: controller.signal }),
    ).rejects.toBeInstanceOf(JoeyRpcError)
  })
})
