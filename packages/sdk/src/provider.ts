/**
 * The object the extension injects into the page's MAIN world, as this SDK sees
 * it.
 *
 * It is mounted at both `window.joey` and `window.xrpl.joey` (the latter by a
 * non-destructive merge, so Crossmark's `window.xrpl` keeps working). The
 * declaration below is a structural view of
 * `apps/extension/src/provider/provider.ts`; anything the wallet adds later is
 * still reachable through `request()`.
 */
import type {
  ConnectParams,
  ConnectResult,
  JoeyChain,
  JoeyNetwork,
  SignAndSubmitTransactionResult,
  SignInParams,
  SignInResult,
  SignTransactionBulkParams,
  SignTransactionForParams,
  SignTransactionParams,
  SignTransactionResult,
} from './types.js'

/**
 * Wire method names.
 *
 * Short, unprefixed names: the injected provider is already a Joey-specific
 * object, and the same table is what the content-script bridge and the
 * background validate against. The three that also exist over WalletConnect
 * (`signTransaction`, `signTransactionFor`, `signTransactionBulk`) carry the
 * same parameter shapes as Joey mobile, minus the `xrpl_` namespace prefix that
 * only WalletConnect needs.
 */
export const JOEY_RPC_METHODS = {
  connect: 'connect',
  disconnect: 'disconnect',
  getAccounts: 'getAccounts',
  getNetwork: 'getNetwork',
  signTransaction: 'signTransaction',
  signAndSubmitTransaction: 'signAndSubmitTransaction',
  signTransactionFor: 'signTransactionFor',
  signTransactionBulk: 'signTransactionBulk',
  signIn: 'signIn',
} as const

export type JoeyRpcMethod = (typeof JOEY_RPC_METHODS)[keyof typeof JOEY_RPC_METHODS]

export interface JoeyRequestArguments {
  method: string
  params?: unknown
}

/** Events the wallet pushes. Payloads are unnormalised at this layer. */
export type JoeyProviderEventName = 'connect' | 'disconnect' | 'accountsChanged' | 'networkChanged'

export interface JoeyInjectedProvider {
  readonly isJoey?: boolean
  /** Reverse-DNS identity, `xyz.joeywallet`. Used by CAIP-294 and aggregators. */
  readonly rdns?: string
  /** Version of the injected surface, not of the extension. */
  readonly version?: string
  /** Granted addresses for this origin. `[]` until the user connects. */
  readonly accounts?: readonly string[]
  readonly chain?: JoeyChain | null

  isAvailable?(): boolean
  isConnected?(): boolean

  connect?(params?: ConnectParams): Promise<ConnectResult>
  disconnect?(): Promise<void>
  getAccounts?(): Promise<string[]>
  getNetwork?(): Promise<JoeyNetwork>
  signTransaction?(params: SignTransactionParams): Promise<SignTransactionResult>
  signAndSubmitTransaction?(
    params: SignTransactionParams,
  ): Promise<SignAndSubmitTransactionResult>
  signTransactionFor?(params: SignTransactionForParams): Promise<SignTransactionResult>
  signTransactionBulk?(params: SignTransactionBulkParams): Promise<SignTransactionResult[]>
  signIn?(params?: SignInParams): Promise<SignInResult>

  /** EIP-1193-shaped escape hatch. Always present. */
  request<TResult = unknown>(args: JoeyRequestArguments): Promise<TResult>

  /** Returns an unsubscribe function. */
  on(event: JoeyProviderEventName, listener: (payload: never) => void): (() => void) | void
  removeListener?(event: JoeyProviderEventName, listener: (payload: never) => void): void
  /** Not implemented by Joey, but common enough elsewhere to be worth trying. */
  off?(event: JoeyProviderEventName, listener: (payload: never) => void): void
}

/** The name Joey registers under with the Wallet Standard. */
export const JOEY_WALLET_NAME = 'Joey'
export const JOEY_RDNS = 'xyz.joeywallet'

/**
 * Events that mean "the provider just finished installing itself".
 *
 * Both are dispatched synchronously by the provider's install step, so a page
 * whose bundle ran before `document_start` injection completed can wait on them
 * instead of polling. There is no Joey-specific ready event on purpose: an
 * extra global signal is one more thing a page can probe to fingerprint the
 * extension, and these two already exist for discovery.
 */
export const CAIP294_ANNOUNCE_EVENT = 'wallet_announce'
export const WALLET_STANDARD_REGISTER_EVENT = 'wallet-standard:register-wallet'

/**
 * Events an *app* dispatches to make wallets announce themselves again.
 *
 * The counterparts to the two above, and the half that matters for a late
 * bundle: a wallet that installed before your code ran has already dispatched
 * its announcement into a page with nobody listening. Waiting for a second one
 * that will never come is how a detection helper times out against a wallet
 * that is sitting right there. {@link waitForJoey} dispatches both.
 */
export const CAIP294_PROMPT_EVENT = 'wallet_prompt'
export const WALLET_STANDARD_APP_READY_EVENT = 'wallet-standard:app-ready'

/* ------------------------------------------------------------------ limits */

/**
 * How long the wallet's own plumbing will wait before answering for it.
 *
 * Published because a dapp cannot otherwise size its own spinner or its own
 * retry, and the two numbers are three orders of magnitude apart on purpose. A
 * method that never touches the approval queue — `getAccounts`, `getNetwork`,
 * `disconnect` — answers in milliseconds or the extension's worker is wedged,
 * so it gets {@link REQUEST_TIMEOUT_MS}. A method that does touch the queue is
 * waiting on a person reading a transaction, and its ceiling is
 * {@link APPROVAL_TIMEOUT_MS}, which matches the approval's own expiry: a
 * shorter one would fail a dapp for a signature the user did in fact give.
 *
 * So `signTransaction` can legitimately be pending for five minutes, and with
 * the page's own backstop on top of it, a little over five. Do not put a
 * thirty-second timeout around it.
 */
export const REQUEST_TIMEOUT_MS = 30_000
export const APPROVAL_TIMEOUT_MS = 300_000

/**
 * The most transactions `signTransactionBulk` will accept in one call.
 *
 * Exported so a dapp can split its own work rather than discover the rule by
 * rejection. The wallet enforces it; this is the same constant, imported by the
 * wallet from here.
 */
export const MAX_BULK_TRANSACTIONS = 32

/**
 * Transaction types Joey refuses to sign for a website, whatever the user
 * clicks and whichever method carries them.
 *
 * Published so a dapp can check before it builds a flow around one, and so the
 * refusal is a documented rule rather than a surprise `4100`. Every entry hands
 * over or destroys the account itself:
 *
 * - `SetRegularKey`, `SignerListSet` and `DelegateSet` (XLS-75) each grant
 *   permanent authority to act as the account, by three separate mechanisms.
 * - `AccountDelete` is irreversible.
 * - `SetHook` installs code that runs on every future transaction.
 * - `Batch` (XLS-56) carries other transactions inside `RawTransactions`, and
 *   Joey's approval screen renders the outer transaction. A user cannot consent
 *   to something they were never shown, so it is refused until the review
 *   screen can render inner transactions individually.
 *
 * Two rules are not expressible as a type name and are enforced anyway:
 * `AccountSet` is refused when it sets or clears a flag that changes who
 * controls the account (`asfDisableMaster`, `asfRequireAuth`, `asfNoFreeze` and
 * the rest of that family) and permitted otherwise; and the ledger's
 * pseudo-transactions — `EnableAmendment`, `SetFee`, `UNLModify` — are refused
 * because no account signs one.
 *
 * The wallet checks at every nesting level, not just the top.
 */
export const JOEY_DAPP_FORBIDDEN_TRANSACTION_TYPES: readonly string[] = Object.freeze([
  'SetRegularKey',
  'SignerListSet',
  'DelegateSet',
  'AccountDelete',
  'SetHook',
  'Batch',
])

export function isJoeyInjectedProvider(value: unknown): value is JoeyInjectedProvider {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<JoeyInjectedProvider>
  return typeof candidate.request === 'function' && typeof candidate.on === 'function'
}

/**
 * Call a provider method by name, preferring the typed method over `request()`.
 *
 * The typed methods are not just sugar: `connect`, `disconnect` and
 * `getAccounts` update the provider's own `accounts` and `chain` state, which a
 * dapp reads synchronously through `joey.accounts` / `joey.isConnected()`.
 * Routing those through `request()` would leave that state stale. `request()`
 * remains the fallback for a provider older or newer than this SDK.
 */
export async function invoke<TResult>(
  provider: JoeyInjectedProvider,
  method: JoeyRpcMethod,
  params?: unknown,
): Promise<TResult> {
  const implementation = (provider as unknown as Record<string, unknown>)[method]
  if (typeof implementation === 'function') {
    return (await (implementation as (arg?: unknown) => Promise<unknown>).call(
      provider,
      params,
    )) as TResult
  }
  return await provider.request<TResult>(
    params === undefined ? { method } : { method, params },
  )
}

/** Subscribe, tolerating a provider that reports removal three different ways. */
export function subscribe(
  provider: JoeyInjectedProvider,
  event: JoeyProviderEventName,
  listener: (payload: never) => void,
): () => void {
  const returned = provider.on(event, listener)
  if (typeof returned === 'function') return returned
  return () => {
    if (typeof provider.removeListener === 'function') provider.removeListener(event, listener)
    else if (typeof provider.off === 'function') provider.off(event, listener)
  }
}
