/**
 * The typed API a dapp actually calls.
 *
 * Every method resolves a value or rejects with a {@link JoeyRpcError}. There is
 * deliberately no `{ type, result }` envelope: an envelope forces a branch at
 * every call site, and a promise rejection is what a JS developer already writes
 * `try`/`catch` around.
 *
 * Event payloads are normalised here rather than passed through raw. The
 * provider forwards whatever the background sent, which is the right choice for
 * a protocol layer and the wrong one for a dapp — a listener should not have to
 * guess whether `accountsChanged` carried an array, an object with an
 * `accounts` key, or a list of bare address strings.
 */
import { JOEY_ERROR_CODES, JoeyRpcError } from './errors.js'
import {
  JOEY_RPC_METHODS,
  invoke,
  subscribe,
  type JoeyInjectedProvider,
  type JoeyProviderEventName,
  type JoeyRequestArguments,
  type JoeyRpcMethod,
} from './provider.js'
import {
  isJoeyChain,
  networkIdForChain,
  type AnyTransaction,
  type ConnectParams,
  type ConnectResult,
  type JoeyAccount,
  type JoeyChain,
  type JoeyEventListener,
  type JoeyEventName,
  type JoeyNetwork,
  type SignAndSubmitTransactionResult,
  type SignInParams,
  type SignInResult,
  type SignTransactionBulkParams,
  type SignTransactionForParams,
  type SignTransactionParams,
  type SignTransactionResult,
  type TransactionLike,
} from './types.js'

export interface Joey {
  /** The raw injected object, for anything this SDK version does not model. */
  readonly provider: JoeyInjectedProvider
  /** Version of the injected surface, when the provider reports one. */
  readonly version: string | undefined
  /** Reverse-DNS identity, `xyz.joeywallet`. */
  readonly rdns: string | undefined
  /** Granted addresses, read synchronously. `[]` until the user connects. */
  readonly accounts: readonly string[]
  /** The chain the wallet is on, or `null` before the first connect. */
  readonly chain: JoeyChain | null

  /** Synchronous. True once the user has granted this origin an account. */
  isConnected(): boolean

  connect(params?: ConnectParams): Promise<ConnectResult>
  disconnect(): Promise<void>
  /** Granted addresses. `[]` for an origin with no grant — never an error. */
  getAccounts(): Promise<string[]>
  getNetwork(): Promise<JoeyNetwork>

  signTransaction<TTx extends TransactionLike = AnyTransaction>(
    params: SignTransactionParams<TTx>,
  ): Promise<SignTransactionResult>

  signAndSubmitTransaction<TTx extends TransactionLike = AnyTransaction>(
    params: SignTransactionParams<TTx>,
  ): Promise<SignAndSubmitTransactionResult>

  /** Add one signature to a multisigned transaction. */
  signTransactionFor<TTx extends TransactionLike = AnyTransaction>(
    params: SignTransactionForParams<TTx>,
  ): Promise<SignTransactionResult>

  /**
   * One approval, up to `MAX_BULK_TRANSACTIONS` transactions, signed in order.
   *
   * Resolves with one entry per transaction, in the order you sent them.
   * `engine_result` is present only when you asked for `submit: true` — with
   * `submit: false` nothing is broadcast, so there is no engine result to give.
   *
   * A batch that fails part way *rejects*, and the error's `data` is a
   * {@link SignTransactionBulkFailure} carrying every signed blob and which
   * index stopped it. Read that rather than re-prompting the user.
   */
  signTransactionBulk<TTx extends TransactionLike = AnyTransaction>(
    params: SignTransactionBulkParams<TTx>,
  ): Promise<SignAndSubmitTransactionResult[]>

  signIn(params?: SignInParams): Promise<SignInResult>

  /** Escape hatch for a method the wallet added after this SDK was published. */
  request<TResult = unknown>(args: JoeyRequestArguments): Promise<TResult>

  on<K extends JoeyEventName>(event: K, listener: JoeyEventListener<K>): () => void
  off<K extends JoeyEventName>(event: K, listener: JoeyEventListener<K>): void
}

/* --------------------------------------------------------------- normalising */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read an account list out of whatever the wallet sent.
 *
 * Accepts a bare array, `{ accounts: [...] }`, and entries that are either
 * address strings or objects — the shapes the provider and the background
 * between them can produce.
 */
export function readAccounts(value: unknown): JoeyAccount[] {
  const source = Array.isArray(value) ? value : isRecord(value) ? value.accounts : undefined
  if (!Array.isArray(source)) return []

  const out: JoeyAccount[] = []
  for (const entry of source) {
    if (typeof entry === 'string') {
      out.push({ address: entry })
      continue
    }
    if (!isRecord(entry) || typeof entry.address !== 'string') continue
    const account: JoeyAccount = { address: entry.address }
    if (typeof entry.publicKey === 'string') account.publicKey = entry.publicKey
    if (typeof entry.label === 'string') account.label = entry.label
    out.push(account)
  }
  return out
}

export function readChain(value: unknown): JoeyChain | null {
  if (isJoeyChain(value)) return value
  if (!isRecord(value)) return null
  return isJoeyChain(value.chain) ? value.chain : null
}

export function readNetwork(value: unknown): JoeyNetwork | null {
  const chain = readChain(value)
  if (chain === null) return null
  const record = isRecord(value) ? value : {}
  return {
    chain,
    networkId:
      typeof record.networkId === 'number' ? record.networkId : (networkIdForChain(chain) ?? 0),
    name: typeof record.name === 'string' ? record.name : chain,
  }
}

/* -------------------------------------------------------------------- client */

/** Wrap a raw injected provider in the typed API. */
export function createJoeyClient(provider: JoeyInjectedProvider): Joey {
  /**
   * Unsubscribe functions, keyed by the exact listener the caller handed us.
   *
   * Needed because the SDK subscribes a *wrapper* that normalises the payload,
   * so the provider never sees the caller's own function.
   *
   * The value is a stack, not a single function, because a listener may be
   * registered more than once and each registration is a separate subscription
   * on the provider. Storing one function per listener silently dropped the
   * earlier registration's unsubscriber: `off()` then removed the newest, the
   * oldest kept firing, and nothing the dapp could call would ever remove it.
   * A React effect that re-subscribes on a dependency change and unsubscribes
   * on cleanup does exactly this, in that order, on every render — so the leak
   * compounds. Each `off()` removes one registration, newest first, which is
   * what `addEventListener`-shaped APIs do.
   */
  const unsubscribers = new Map<JoeyEventName, Map<unknown, Array<() => void>>>()

  const call = async <TResult>(method: JoeyRpcMethod, params?: unknown): Promise<TResult> => {
    try {
      return await invoke<TResult>(provider, method, params)
    } catch (cause) {
      throw JoeyRpcError.from(cause)
    }
  }

  /** Drop one specific registration, wherever it sits in the stack. */
  const release = (
    event: JoeyEventName,
    listener: unknown,
    unsubscribe: () => void,
  ): void => {
    const forEvent = unsubscribers.get(event)
    const stack = forEvent?.get(listener)
    if (stack === undefined) return
    const at = stack.lastIndexOf(unsubscribe)
    if (at === -1) return
    stack.splice(at, 1)
    if (stack.length === 0) forEvent?.delete(listener)
    unsubscribe()
  }

  const normalise: {
    [K in JoeyEventName]: (payload: unknown) => Parameters<JoeyEventListener<K>>[0]
  } = {
    connect: (payload) => ({ accounts: readAccounts(payload), chain: readChain(payload) }),
    disconnect: (payload) =>
      isRecord(payload) && typeof payload.reason === 'string' ? { reason: payload.reason } : {},
    accountsChanged: (payload) => readAccounts(payload),
    networkChanged: (payload) => readNetwork(payload),
  }

  const client: Joey = {
    provider,
    version: typeof provider.version === 'string' ? provider.version : undefined,
    rdns: typeof provider.rdns === 'string' ? provider.rdns : undefined,

    get accounts() {
      return provider.accounts ?? []
    },

    get chain() {
      return provider.chain ?? null
    },

    isConnected() {
      if (typeof provider.isConnected === 'function') return provider.isConnected()
      return (provider.accounts ?? []).length > 0
    },

    async connect(params) {
      const result = await call<unknown>(JOEY_RPC_METHODS.connect, params ?? {})
      const record = isRecord(result) ? result : {}
      const chain = readChain(record)
      return {
        accounts: readAccounts(record),
        chain,
        networkId:
          typeof record.networkId === 'number'
            ? record.networkId
            : chain === null
              ? null
              : networkIdForChain(chain),
      }
    },

    async disconnect() {
      await call<unknown>(JOEY_RPC_METHODS.disconnect, {})
    },

    async getAccounts() {
      const result = await call<unknown>(JOEY_RPC_METHODS.getAccounts, {})
      // The provider answers with bare addresses; the background may answer with
      // account objects. Both collapse to addresses here.
      return readAccounts(result).map((account) => account.address)
    },

    async getNetwork() {
      const result = await call<unknown>(JOEY_RPC_METHODS.getNetwork, {})
      const network = readNetwork(result)
      if (network === null) {
        throw new JoeyRpcError(
          JOEY_ERROR_CODES.UNRECOGNIZED_CHAIN,
          'The wallet reported a chain this SDK does not recognise.',
        )
      }
      return network
    },

    signTransaction(params) {
      return call<SignTransactionResult>(JOEY_RPC_METHODS.signTransaction, params)
    },

    signAndSubmitTransaction(params) {
      return call<SignAndSubmitTransactionResult>(
        JOEY_RPC_METHODS.signAndSubmitTransaction,
        params,
      )
    },

    signTransactionFor(params) {
      return call<SignTransactionResult>(JOEY_RPC_METHODS.signTransactionFor, params)
    },

    signTransactionBulk(params) {
      return call<SignAndSubmitTransactionResult[]>(
        JOEY_RPC_METHODS.signTransactionBulk,
        params,
      )
    },

    signIn(params) {
      return call<SignInResult>(JOEY_RPC_METHODS.signIn, params ?? {})
    },

    async request(args) {
      try {
        return await provider.request(args)
      } catch (cause) {
        throw JoeyRpcError.from(cause)
      }
    },

    on(event, listener) {
      const wrapped = (payload: unknown): void => {
        ;(listener as (value: unknown) => void)(normalise[event](payload))
      }
      const unsubscribe = subscribe(
        provider,
        event as JoeyProviderEventName,
        wrapped as (payload: never) => void,
      )

      let forEvent = unsubscribers.get(event)
      if (forEvent === undefined) {
        forEvent = new Map()
        unsubscribers.set(event, forEvent)
      }
      const stack = forEvent.get(listener)
      if (stack === undefined) forEvent.set(listener, [unsubscribe])
      else stack.push(unsubscribe)

      // The returned function removes *this* registration, once. Calling it
      // twice must not take a sibling registration down with it.
      let released = false
      return () => {
        if (released) return
        released = true
        release(event, listener, unsubscribe)
      }
    },

    off(event, listener) {
      const stack = unsubscribers.get(event)?.get(listener)
      const unsubscribe = stack?.pop()
      if (unsubscribe === undefined) return
      unsubscribe()
      if (stack !== undefined && stack.length === 0) {
        unsubscribers.get(event)?.delete(listener)
      }
    },
  }

  return Object.freeze(client)
}
