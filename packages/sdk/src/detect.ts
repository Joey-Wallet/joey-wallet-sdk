/**
 * Finding the wallet.
 *
 * This file is load-bearing for adoption, not just for correctness. Every XRPL
 * wallet aggregator gives a wallet about one second to prove it exists, and a
 * detection path that costs a message round trip to a sleeping MV3 service
 * worker will lose that race intermittently — which the aggregator reports to
 * the user as "not installed", the worst possible failure. So detection reads
 * the page globals and returns; it never talks to the extension.
 */
import { createJoeyClient, type Joey } from './client.js'
import { JOEY_ERROR_CODES, JoeyRpcError, notInstalledError } from './errors.js'
import {
  CAIP294_ANNOUNCE_EVENT,
  CAIP294_PROMPT_EVENT,
  WALLET_STANDARD_APP_READY_EVENT,
  WALLET_STANDARD_REGISTER_EVENT,
  isJoeyInjectedProvider,
  type JoeyInjectedProvider,
} from './provider.js'

/**
 * One client per injected object.
 *
 * React re-renders and aggregator retries both call `getJoey()` repeatedly; a
 * fresh client each time would leak the event subscriptions the previous one
 * registered and break referential equality in hook dependency arrays.
 */
let cachedProvider: JoeyInjectedProvider | null = null
let cachedClient: Joey | null = null

interface JoeyGlobals {
  joey?: unknown
  xrpl?: { joey?: unknown } | undefined
}

function globals(): JoeyGlobals | null {
  // `globalThis` rather than `window` so importing this module in Node (SSR,
  // Next.js, a test runner) is inert instead of a ReferenceError.
  if (typeof globalThis === 'undefined') return null
  return globalThis as unknown as JoeyGlobals
}

function readProvider(): JoeyInjectedProvider | null {
  const scope = globals()
  if (scope === null) return null

  if (isJoeyInjectedProvider(scope.joey)) return scope.joey
  // `window.xrpl` is Crossmark's namespace; Joey merges into it without
  // touching anything already there, so this is a legitimate second home.
  const nested = scope.xrpl?.joey
  if (isJoeyInjectedProvider(nested)) return nested
  return null
}

/**
 * The Joey client, or `null` when the provider is not on the page.
 *
 * Synchronous by design. It is also safe to `await` — the value is not a
 * promise, so `await getJoey()` costs one microtask and no round trip.
 */
export function getJoey(): Joey | null {
  const provider = readProvider()
  if (provider === null) return null
  if (provider !== cachedProvider || cachedClient === null) {
    cachedProvider = provider
    cachedClient = createJoeyClient(provider)
  }
  return cachedClient
}

/** Synchronous. Never sends a message, never awaits, never throws. */
export function isJoeyAvailable(): boolean {
  return readProvider() !== null
}

/** Like {@link getJoey}, but throws `JoeyRpcError` 4900 instead of returning null. */
export function requireJoey(): Joey {
  const joey = getJoey()
  if (joey === null) throw notInstalledError()
  return joey
}

export interface WaitForJoeyOptions {
  /** Default 3000. */
  timeoutMs?: number
  signal?: AbortSignal
}

/**
 * Ask any wallet already on the page to announce itself again.
 *
 * Necessary, not merely polite. `waitForJoey` exists for the case where the
 * dapp's bundle ran *after* the extension installed its provider — and in that
 * case both announcements have already been dispatched into a page with no
 * listeners attached. Listening for a second one that will never arrive is how
 * a detection helper times out against a wallet that is sitting right there,
 * and the poll below was quietly carrying the whole feature.
 *
 * Both protocols define the app's half of the handshake and Joey implements
 * both: CAIP-294's `wallet_prompt` makes it re-dispatch `wallet_announce`, and
 * Wallet Standard's `wallet-standard:app-ready` carries a `register` callback
 * that every listening wallet calls synchronously. The callback's argument is
 * discarded — the SDK wants the injected provider global, not a Wallet Standard
 * wallet object — but a wallet that can call it has finished installing, so it
 * is a reliable "look again now" signal.
 *
 * Every step is guarded, but not the way it looks: see {@link dispatchQuietly}
 * for why a `try`/`catch` is the wrong tool for a listener that throws. Failing
 * to prompt costs a poll interval, never the detection.
 */
function promptForWallets(target: EventTarget, recheck: () => void): void {
  dispatchQuietly(target, () => new CustomEvent(CAIP294_PROMPT_EVENT))

  dispatchQuietly(
    target,
    () =>
      new CustomEvent(WALLET_STANDARD_APP_READY_EVENT, {
        detail: {
          register: (): (() => void) => {
            recheck()
            return () => undefined
          },
        },
      }),
  )
}

/**
 * Dispatch one prompt event without a page listener's failure landing on
 * anybody else.
 *
 * **`dispatchEvent` does not rethrow what a listener threw.** DOM's "inner
 * invoke" *reports* the exception to the global instead and hands the
 * dispatcher a plain boolean, so the `try`/`catch` that used to sit around
 * these two calls caught nothing it claimed to. The SDK survived — it always
 * would have — while the exception went on to the page's `onerror`, its crash
 * reporter, and (in this repo) the test runner's unhandled-error channel, which
 * failed a green suite with two errors nothing had thrown at it.
 *
 * So what is contained here is the *report*, not a throw. An `error` listener
 * is installed on the global for the synchronous duration of this one dispatch
 * and removed in `finally`. Reporting runs inline inside `dispatchEvent` and
 * there is no `await` and no timer between install and removal, so the only
 * errors it can possibly see are the ones this prompt caused; `preventDefault()`
 * marks them handled, which is what suppresses the console entry and the
 * runner's failure. Everything else the page reports is untouched.
 *
 * Realms differ, and the fallback is the same either way. Where the global
 * reports asynchronously rather than through a cancellable `error` event —
 * a bare Node `EventTarget` defers to `uncaughtException` — the absorber is
 * already gone and the exception surfaces as that realm defines. Nothing about
 * detection changes: the promise is unaffected in every case, because
 * `dispatchEvent` never had the exception to give us.
 *
 * The `try`/`catch` that remains is for what genuinely does throw here: a realm
 * with no `CustomEvent` constructor, or a global that refuses the dispatch.
 */
function dispatchQuietly(target: EventTarget, build: () => Event): void {
  const absorb = (event: Event): void => {
    event.preventDefault()
  }

  let absorbing = false
  try {
    target.addEventListener('error', absorb, true)
    absorbing = true
  } catch {
    // A global that will not take an `error` listener. Nothing to absorb.
  }

  try {
    target.dispatchEvent(build())
  } catch {
    // No `CustomEvent` in this realm, or `dispatchEvent` refused it outright.
    // The poll still covers us.
  } finally {
    if (absorbing) target.removeEventListener('error', absorb, true)
  }
}

/**
 * Resolve once the provider exists.
 *
 * For the case the synchronous path cannot cover: a dapp bundle that executed
 * before the extension's `document_start` content script finished installing
 * the global. Settles on the provider's own announcement events — and, because
 * those may already have fired, asks for them again — with a slow poll as a
 * backstop for a provider that installs the global without announcing at all.
 */
export function waitForJoey(options: WaitForJoeyOptions = {}): Promise<Joey> {
  const { timeoutMs = 3000, signal } = options

  const immediate = getJoey()
  if (immediate !== null) return Promise.resolve(immediate)

  const scope = globals()
  if (scope === null || typeof (scope as { addEventListener?: unknown }).addEventListener !== 'function') {
    return Promise.reject(notInstalledError())
  }
  const target = scope as unknown as EventTarget

  return new Promise<Joey>((resolve, reject) => {
    let settled = false
    const cleanups: Array<() => void> = []

    const finish = (run: () => void): void => {
      if (settled) return
      settled = true
      for (const cleanup of cleanups) cleanup()
      run()
    }

    const check = (): void => {
      const joey = getJoey()
      if (joey !== null) finish(() => resolve(joey))
    }

    for (const event of [
      CAIP294_ANNOUNCE_EVENT,
      WALLET_STANDARD_REGISTER_EVENT,
      'DOMContentLoaded',
      'load',
    ]) {
      target.addEventListener(event, check)
      cleanups.push(() => target.removeEventListener(event, check))
    }

    const poll = setInterval(check, 50)
    cleanups.push(() => clearInterval(poll))

    const timer = setTimeout(() => {
      finish(() =>
        reject(
          new JoeyRpcError(
            JOEY_ERROR_CODES.DISCONNECTED,
            `Joey Wallet did not announce itself within ${timeoutMs}ms. It is probably not installed.`,
          ),
        ),
      )
    }, timeoutMs)
    cleanups.push(() => clearTimeout(timer))

    if (signal !== undefined) {
      const onAbort = (): void => {
        finish(() =>
          reject(new JoeyRpcError(JOEY_ERROR_CODES.INTERNAL, 'Wallet detection was aborted.')),
        )
      }
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
      cleanups.push(() => signal.removeEventListener('abort', onAbort))
    }

    // Covers a provider installed between the synchronous check above and the
    // listeners being attached.
    check()
    if (settled) return

    // Now that we are listening, ask the wallets that announced before we
    // existed to say it again.
    promptForWallets(target, check)
  })
}

/**
 * Drop the cached client.
 *
 * Only needed by tests and by SPAs that swap the provider at runtime; normal
 * dapps never call it.
 */
export function resetJoeyDetection(): void {
  cachedProvider = null
  cachedClient = null
}
