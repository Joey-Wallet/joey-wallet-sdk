/**
 * `@joeywallet/gemwallet-compat` — GemWallet's `@gemwallet/api` surface over Joey.
 *
 *   - import { isInstalled, getAddress, sendPayment } from '@gemwallet/api'
 *   + import { isInstalled, getAddress, sendPayment } from '@joeywallet/gemwallet-compat'
 *
 * Function names, argument shapes and the `{ type, result }` envelope match
 * `@gemwallet/api@3.8.0`. Four functions deliberately do not exist as working
 * calls — see `./unsupported.ts`.
 */
import {
  JOEY_ERROR_CODES,
  JoeyRpcError,
  getJoey,
  waitForJoey,
  type Joey,
  type JoeyAccount,
  type JoeyNetwork,
} from '@joeywallet/wallet-sdk'

import {
  toGemNetwork,
  toGemNetworkDescription,
  toGemWebsocket,
  toPaymentTransaction,
  toTrustSetTransaction,
} from './convert.js'
import { envelope } from './envelope.js'
import { refuse } from './unsupported.js'
import type {
  EventLoginResponse,
  EventLogoutResponse,
  EventNetworkChangedResponse,
  EventWalletChangedResponse,
  GemEventPayloadMap,
  GemEventType,
  GetAddressResponse,
  GetNetworkResponse,
  GetPublicKeyResponse,
  IsInstalledResponse,
  SendPaymentRequest,
  SendPaymentResponse,
  SetTrustlineRequest,
  SetTrustlineResponse,
  SignMessageResponse,
  SignTransactionRequest,
  SignTransactionResponse,
  SubmitBulkTransactionsRequest,
  SubmitBulkTransactionsResponse,
  SubmitTransactionRequest,
  SubmitTransactionResponse,
  TransactionBulkResponse,
} from './types.js'

/**
 * How long to wait for a provider that has not been injected yet.
 *
 * 1000ms is GemWallet's own number, and dapps written against it already treat
 * a slower answer as "not installed".
 */
const DETECT_TIMEOUT_MS = 1000

async function requireProvider(): Promise<Joey> {
  const immediate = getJoey()
  if (immediate !== null) return immediate
  return await waitForJoey({ timeoutMs: DETECT_TIMEOUT_MS })
}

/**
 * The account this origin may use, connecting first if it has to.
 *
 * `connect({ silent: true })` rather than `getAccounts()` because GemWallet's
 * `getPublicKey()` needs the public key, and only the connect result carries
 * it — `getAccounts()` answers with bare addresses. A silent connect resolves
 * with an empty list rather than throwing when the origin has no grant, so the
 * non-silent call below is what actually opens the approval window, matching
 * GemWallet's behaviour of prompting from `getAddress()`.
 */
async function requireAccount(): Promise<{ joey: Joey; account: JoeyAccount }> {
  const joey = await requireProvider()

  let result = await joey.connect({ silent: true })
  if (result.accounts.length === 0) result = await joey.connect()

  const account = result.accounts[0]
  if (account === undefined) {
    throw new JoeyRpcError(
      JOEY_ERROR_CODES.UNAUTHORIZED,
      'Joey Wallet connected without sharing an account.',
    )
  }
  return { joey, account }
}

/* ------------------------------------------------------------------ detection */

/**
 * Never rejects, and answers immediately when the provider is already present.
 *
 * Matches GemWallet's contract, including its 1-second budget for a provider
 * that has not been injected yet.
 */
export async function isInstalled(): Promise<IsInstalledResponse> {
  if (getJoey() !== null) return { result: { isInstalled: true } }
  try {
    await waitForJoey({ timeoutMs: DETECT_TIMEOUT_MS })
    return { result: { isInstalled: true } }
  } catch {
    return { result: { isInstalled: false } }
  }
}

/* -------------------------------------------------------------------- account */

export async function getAddress(): Promise<GetAddressResponse> {
  return await envelope(async () => {
    const { account } = await requireAccount()
    return { address: account.address }
  })
}

export async function getPublicKey(): Promise<GetPublicKeyResponse> {
  return await envelope(async () => {
    const { account } = await requireAccount()
    if (account.publicKey === undefined) {
      throw new JoeyRpcError(
        JOEY_ERROR_CODES.UNAUTHORIZED,
        'The selected Joey account is watch-only and has no public key.',
      )
    }
    return { address: account.address, publicKey: account.publicKey }
  })
}

export async function getNetwork(): Promise<GetNetworkResponse> {
  return await envelope(async () => {
    const joey = await requireProvider()
    const network = await joey.getNetwork()
    return {
      // Joey is XRPL-only. GemWallet's other value, XAHAU, is never returned.
      chain: 'XRPL',
      network: toGemNetwork(network),
      websocket: toGemWebsocket(network),
    }
  })
}

/* -------------------------------------------------------------------- signing */

/**
 * Not implemented. Throws {@link GemWalletUnsupportedError} synchronously.
 *
 * Joey has no raw message-signing method: a bare signature over a string
 * carries no domain, nonce or timestamp and is replayable against another site.
 * Use `signIn()` from `@joeywallet/wallet-sdk`, which signs a CAIP-122 message bound
 * to this origin.
 */
export function signMessage(_message: string, _isHex?: boolean): Promise<SignMessageResponse> {
  return refuse('signMessage')
}

export async function sendPayment(
  paymentPayload: SendPaymentRequest,
): Promise<SendPaymentResponse> {
  return await envelope(async () => {
    const { joey, account } = await requireAccount()
    const result = await joey.signAndSubmitTransaction({
      tx_json: toPaymentTransaction(paymentPayload, account.address),
    })
    return { hash: result.hash }
  })
}

export async function setTrustline(
  payload: SetTrustlineRequest,
): Promise<SetTrustlineResponse> {
  return await envelope(async () => {
    const { joey, account } = await requireAccount()
    const result = await joey.signAndSubmitTransaction({
      tx_json: toTrustSetTransaction(payload, account.address),
    })
    return { hash: result.hash }
  })
}

export async function signTransaction(
  payload: SignTransactionRequest,
): Promise<SignTransactionResponse> {
  return await envelope(async () => {
    const { joey } = await requireAccount()
    const result = await joey.signTransaction({ tx_json: payload.transaction })
    // GemWallet calls the signed blob `signature`. It is the full signed
    // transaction, not the `TxnSignature` field.
    return { signature: result.tx_blob }
  })
}

export async function submitTransaction(
  payload: SubmitTransactionRequest,
): Promise<SubmitTransactionResponse> {
  return await envelope(async () => {
    const { joey } = await requireAccount()
    const result = await joey.signAndSubmitTransaction({ tx_json: payload.transaction })
    return { hash: result.hash }
  })
}

export async function submitBulkTransactions(
  payload: SubmitBulkTransactionsRequest,
): Promise<SubmitBulkTransactionsResponse> {
  return await envelope(async () => {
    const { joey } = await requireAccount()

    // GemWallet correlates results by an `ID` field carried inside each
    // transaction. `ID` is not an XRPL field and would break serialisation, so
    // it is stripped here and re-attached by position — Joey signs the batch in
    // the order it was given.
    const ids: Array<string | undefined> = []
    const tx_list = payload.transactions.map((entry) => {
      const { ID, ...tx_json } = entry
      ids.push(ID)
      return { tx_json }
    })

    const results = await joey.signTransactionBulk({ tx_list, submit: true })

    const transactions: TransactionBulkResponse[] = ids.map((id, index) => {
      const result = results[index]
      return {
        ...(id === undefined ? {} : { id }),
        // A resolved bulk request carries one entry per transaction, so every
        // one of these is `true`. The guard stays because the alternative
        // reading — an index with no entry silently becoming `accepted: true`
        // with no hash — is the failure this shape exists to prevent.
        //
        // A batch that fails part way *rejects*, and `envelope` turns that into
        // GemWallet's error response. The signed blobs and the failing index
        // are on the error's `data` (`SignTransactionBulkFailure`); mapping
        // them onto per-transaction `accepted` flags would be a better answer
        // for a GemWallet dapp than an error, and is deliberately left as a
        // change to this package's own contract rather than smuggled in with
        // the wallet's.
        accepted: result !== undefined,
        ...(result === undefined ? {} : { hash: result.hash }),
      }
    })

    return { transactions }
  })
}

/* --------------------------------------------------------------- unsupported */

/**
 * Not implemented. Throws {@link GemWalletUnsupportedError} synchronously.
 *
 * @see ./unsupported.ts for why.
 */
export function setRegularKey(_payload?: unknown): Promise<never> {
  return refuse('setRegularKey')
}

/** Not implemented. Throws {@link GemWalletUnsupportedError} synchronously. */
export function setHook(_payload?: unknown): Promise<never> {
  return refuse('setHook')
}

/** Not implemented. Throws {@link GemWalletUnsupportedError} synchronously. */
export function setAccount(_payload?: unknown): Promise<never> {
  return refuse('setAccount')
}

/* -------------------------------------------------------------------- events */

type NormalisedEvent<E extends GemEventType> = E extends 'login' | 'EVENT_LOGIN'
  ? 'login'
  : E extends 'logout' | 'EVENT_LOGOUT'
    ? 'logout'
    : E extends 'networkChanged' | 'EVENT_NETWORK_CHANGED'
      ? 'networkChanged'
      : E extends 'walletChanged' | 'EVENT_WALLET_CHANGED'
        ? 'walletChanged'
        : never

function normaliseEvent(eventType: GemEventType): keyof GemEventPayloadMap {
  switch (eventType) {
    case 'login':
    case 'EVENT_LOGIN':
      return 'login'
    case 'logout':
    case 'EVENT_LOGOUT':
      return 'logout'
    case 'networkChanged':
    case 'EVENT_NETWORK_CHANGED':
      return 'networkChanged'
    case 'walletChanged':
    case 'EVENT_WALLET_CHANGED':
      return 'walletChanged'
  }
}

function toGemNetworkEvent(network: JoeyNetwork): EventNetworkChangedResponse {
  return {
    network: {
      name: toGemNetwork(network),
      server: toGemWebsocket(network),
      description: toGemNetworkDescription(network),
    },
  }
}

function attach(
  joey: Joey,
  event: keyof GemEventPayloadMap,
  callback: (payload: never) => void,
): () => void {
  const emit = (payload: unknown): void => {
    ;(callback as (value: unknown) => void)(payload)
  }

  switch (event) {
    case 'login':
      return joey.on('connect', () => emit({ loggedIn: true } satisfies EventLoginResponse))
    case 'logout':
      return joey.on('disconnect', () => emit({ loggedIn: false } satisfies EventLogoutResponse))
    case 'networkChanged':
      return joey.on('networkChanged', (network) => {
        if (network !== null) emit(toGemNetworkEvent(network))
      })
    case 'walletChanged':
      return joey.on('accountsChanged', (accounts) =>
        emit({
          wallet: { publicAddress: accounts[0]?.address ?? '' },
        } satisfies EventWalletChangedResponse),
      )
  }
}

/**
 * Subscribe to a wallet event.
 *
 * `@gemwallet/api`'s `on()` returns `void`; this returns an unsubscribe
 * function. That is a superset — existing call sites that ignore the return
 * value are unaffected — and it is what a single-page app needs to avoid
 * leaking a listener on every route change.
 */
export function on<E extends GemEventType>(
  eventType: E,
  callback: (payload: GemEventPayloadMap[NormalisedEvent<E>]) => void,
): () => void {
  const event = normaliseEvent(eventType)
  let detach: (() => void) | null = null
  let cancelled = false

  const bind = (joey: Joey): void => {
    if (cancelled) return
    detach = attach(joey, event, callback as (payload: never) => void)
  }

  const immediate = getJoey()
  if (immediate !== null) bind(immediate)
  else {
    void waitForJoey({ timeoutMs: DETECT_TIMEOUT_MS })
      .then(bind)
      .catch(() => {
        /* no wallet, nothing to listen to */
      })
  }

  return () => {
    cancelled = true
    detach?.()
    detach = null
  }
}

/* -------------------------------------------------------------------- exports */

export {
  GemWalletUnsupportedError,
  UNSUPPORTED_METHODS,
  type UnsupportedMethod,
} from './unsupported.js'
export { envelope, rejected, response } from './envelope.js'
export {
  toGemNetwork,
  toGemWebsocket,
  toPaymentTransaction,
  toTrustSetTransaction,
  toXrplMemos,
  toXrplSigners,
} from './convert.js'
export { DEFAULT_SUBMIT_TX_BULK_ON_ERROR } from './types.js'
export type * from './types.js'
