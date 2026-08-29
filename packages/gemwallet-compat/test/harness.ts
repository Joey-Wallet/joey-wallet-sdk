/**
 * A mock Joey provider for the compatibility tests.
 *
 * Deliberately injected through `globalThis` rather than by importing the SDK's
 * internals: that is the same path a real page takes, and it exercises the
 * detection this package relies on.
 */
import { resetJoeyDetection, type JoeyInjectedProvider } from '@joeywallet/wallet-sdk'

export interface RecordedCall {
  method: string
  params: unknown
}

export interface MockProvider extends JoeyInjectedProvider {
  readonly calls: RecordedCall[]
  respond(method: string, handler: (params: unknown) => unknown): void
  emit(event: string, payload: unknown): void
  listenerCount(event: string): number
  lastCall(): RecordedCall | undefined
  callsTo(method: string): RecordedCall[]
}

const METHODS = [
  'connect',
  'disconnect',
  'getAccounts',
  'getNetwork',
  'signTransaction',
  'signAndSubmitTransaction',
  'signTransactionFor',
  'signTransactionBulk',
  'signIn',
] as const

export function createMockProvider(): MockProvider {
  const calls: RecordedCall[] = []
  const handlers = new Map<string, (params: unknown) => unknown>()
  const listeners = new Map<string, Set<(payload: never) => void>>()

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
    version: '1.0.0-test',
    calls,

    async request<TResult>({
      method,
      params,
    }: {
      method: string
      params?: unknown
    }): Promise<TResult> {
      return (await dispatch(method, params)) as TResult
    },

    on(event, listener) {
      let forEvent = listeners.get(event)
      if (forEvent === undefined) {
        forEvent = new Set()
        listeners.set(event, forEvent)
      }
      forEvent.add(listener)
      return () => {
        forEvent?.delete(listener)
      }
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
  }

  const mutable = provider as unknown as Record<string, (params?: unknown) => Promise<unknown>>
  for (const method of METHODS) {
    mutable[method] = (params?: unknown) => dispatch(method, params)
  }

  return provider
}

interface MutableGlobals {
  joey?: unknown
  addEventListener?: unknown
  removeEventListener?: unknown
  dispatchEvent?: unknown
}

const scope = globalThis as unknown as MutableGlobals
let shimInstalled = false

/** `globalThis` is not an EventTarget in Node; detection needs one. */
export function installEventTargetShim(): void {
  if (shimInstalled || typeof scope.addEventListener === 'function') return
  const target = new EventTarget()
  scope.addEventListener = target.addEventListener.bind(target)
  scope.removeEventListener = target.removeEventListener.bind(target)
  scope.dispatchEvent = target.dispatchEvent.bind(target)
  shimInstalled = true
}

export function removeEventTargetShim(): void {
  if (!shimInstalled) return
  delete scope.addEventListener
  delete scope.removeEventListener
  delete scope.dispatchEvent
  shimInstalled = false
}

export function installProvider(provider: JoeyInjectedProvider): void {
  scope.joey = provider
  resetJoeyDetection()
}

export function clearProviders(): void {
  delete scope.joey
  resetJoeyDetection()
}
