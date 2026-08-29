/**
 * A stand-in for the injected provider, plus just enough of a page for
 * detection to work under `environment: 'node'`.
 *
 * Node's `globalThis` is not an `EventTarget`, so `waitForJoey` has nothing to
 * listen on. Rather than pull in jsdom for four event listeners, the harness
 * borrows a real `EventTarget`'s methods onto `globalThis` and takes them off
 * again afterwards.
 */
import { resetJoeyDetection } from '../src/detect'
import {
  JOEY_RPC_METHODS,
  type JoeyInjectedProvider,
  type JoeyProviderEventName,
  type JoeyRequestArguments,
} from '../src/provider'

export interface RecordedCall {
  method: string
  params: unknown
}

export interface MockProviderOptions {
  version?: string
  /**
   * Mount the typed methods the real provider exposes. Off simulates an older
   * or newer provider that only offers `request()`.
   */
  typedMethods?: boolean
  /** `on` returns an unsubscribe function, as Joey's provider does. */
  onReturnsUnsubscribe?: boolean
}

export interface MockProvider extends JoeyInjectedProvider {
  readonly calls: RecordedCall[]
  /** Register a handler. Returning a value resolves; throwing rejects. */
  respond(method: string, handler: (params: unknown) => unknown): void
  emit(event: JoeyProviderEventName, payload: unknown): void
  listenerCount(event: string): number
  lastCall(): RecordedCall | undefined
  callsTo(method: string): RecordedCall[]
  setAccounts(accounts: readonly string[]): void
}

export function createMockProvider(options: MockProviderOptions = {}): MockProvider {
  const { version = '1.0.0-test', typedMethods = true, onReturnsUnsubscribe = true } = options

  const calls: RecordedCall[] = []
  const handlers = new Map<string, (params: unknown) => unknown>()
  const listeners = new Map<string, Set<(payload: never) => void>>()
  let accounts: readonly string[] = []

  const dispatch = async (method: string, params: unknown): Promise<unknown> => {
    calls.push({ method, params })
    const handler = handlers.get(method)
    if (handler === undefined) {
      throw { code: 4200, message: `The wallet does not support ${method}.` }
    }
    return await handler(params)
  }

  const provider: MockProvider = {
    isJoey: true,
    rdns: 'xyz.joeywallet',
    version,
    calls,

    get accounts() {
      return accounts
    },
    chain: null,

    isConnected() {
      return accounts.length > 0
    },

    async request<TResult>({ method, params }: JoeyRequestArguments): Promise<TResult> {
      return (await dispatch(method, params)) as TResult
    },

    on(event, listener) {
      let forEvent = listeners.get(event)
      if (forEvent === undefined) {
        forEvent = new Set()
        listeners.set(event, forEvent)
      }
      forEvent.add(listener)
      if (!onReturnsUnsubscribe) return
      return () => {
        forEvent?.delete(listener)
      }
    },

    removeListener(event, listener) {
      listeners.get(event)?.delete(listener)
    },

    respond(method, handler) {
      handlers.set(method, handler)
    },

    emit(event, payload) {
      for (const listener of listeners.get(event) ?? []) {
        ;(listener as (value: unknown) => void)(payload)
      }
    },

    listenerCount(event) {
      return listeners.get(event)?.size ?? 0
    },

    lastCall() {
      return calls[calls.length - 1]
    },

    callsTo(method) {
      return calls.filter((call) => call.method === method)
    },

    setAccounts(next) {
      accounts = next
    },
  }

  if (typedMethods) {
    const mutable = provider as unknown as Record<string, (params?: unknown) => Promise<unknown>>
    for (const method of Object.values(JOEY_RPC_METHODS)) {
      mutable[method] = (params?: unknown) => dispatch(method, params)
    }
  }

  return provider
}

interface MutableGlobals {
  joey?: unknown
  xrpl?: unknown
  addEventListener?: unknown
  removeEventListener?: unknown
  dispatchEvent?: unknown
}

const scope = globalThis as unknown as MutableGlobals
let eventShimInstalled = false

/** Make `globalThis` behave like a page for the duration of a test file. */
export function installEventTargetShim(): void {
  if (eventShimInstalled || typeof scope.addEventListener === 'function') return
  const target = new EventTarget()
  scope.addEventListener = target.addEventListener.bind(target)
  scope.removeEventListener = target.removeEventListener.bind(target)
  scope.dispatchEvent = target.dispatchEvent.bind(target)
  eventShimInstalled = true
}

export function removeEventTargetShim(): void {
  if (!eventShimInstalled) return
  delete scope.addEventListener
  delete scope.removeEventListener
  delete scope.dispatchEvent
  eventShimInstalled = false
}

export function announce(event: string): void {
  const dispatchEvent = scope.dispatchEvent
  if (typeof dispatchEvent === 'function') {
    ;(dispatchEvent as (e: Event) => boolean)(new Event(event))
  }
}

/** Put a provider on `window.joey`. */
export function installProvider(provider: JoeyInjectedProvider): void {
  scope.joey = provider
  resetJoeyDetection()
}

/** Put a provider on `window.xrpl.joey`, alongside a pretend Crossmark. */
export function installNestedProvider(provider: JoeyInjectedProvider): void {
  scope.xrpl = { crossmark: {}, isCrossmark: true, joey: provider }
  resetJoeyDetection()
}

export function clearProviders(): void {
  delete scope.joey
  delete scope.xrpl
  resetJoeyDetection()
}
