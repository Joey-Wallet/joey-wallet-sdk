/**
 * GemWallet's public types, restated.
 *
 * Copied by shape from `@gemwallet/api@3.8.0` rather than imported, so a
 * migrating dapp can delete the `@gemwallet/api` dependency entirely — which is
 * the whole point of this package. Field names, casing and optionality are
 * deliberately identical to GemWallet's, including the parts that differ from
 * XRPL's own JSON (lowercase `memos`, `{ memo: { memoData } }` instead of
 * `{ Memo: { MemoData } }`); `../src/convert.ts` does the translation.
 */
import type { Amount, IssuedCurrencyAmount, Path, TransactionLike } from '@joeywallet/wallet-sdk'

export type { Amount, IssuedCurrencyAmount, Path }

/** GemWallet's envelope discriminant. `reject` means the user declined. */
export type ResponseType = 'response' | 'reject'

export interface BaseResponse<T> {
  type: ResponseType
  result?: T
}

/** GemWallet's own `Network` enum values, as string literals. */
export type Network = 'Mainnet' | 'Testnet' | 'Devnet' | 'Custom'

export type Chain = 'XRPL' | 'XAHAU'

/** GemWallet spells memos lowercase and singular-nested. */
export interface Memo {
  memo: {
    memoType?: string
    memoData?: string
    memoFormat?: string
  }
}

export interface Signer {
  signer: {
    account: string
    txnSignature: string
    signingPubKey: string
  }
}

export type PaymentFlags = number | object
export type TrustSetFlags = number | object

export interface BaseTransactionRequest {
  fee?: string
  sequence?: number
  accountTxnID?: string
  lastLedgerSequence?: number
  memos?: Memo[]
  networkID?: number
  signers?: Signer[]
  sourceTag?: number
  signingPubKey?: string
  ticketSequence?: number
  txnSignature?: string
}

export interface SendPaymentRequest extends BaseTransactionRequest {
  amount: Amount
  destination: string
  destinationTag?: number
  invoiceID?: string
  paths?: Path[]
  sendMax?: Amount
  deliverMin?: Amount
  flags?: PaymentFlags
}

export interface SetTrustlineRequest extends BaseTransactionRequest {
  limitAmount: IssuedCurrencyAmount
  qualityIn?: number
  qualityOut?: number
  flags?: TrustSetFlags
}

/**
 * GemWallet types this as xrpl.js's `SubmittableTransaction`. Restated as the
 * SDK's structural constraint so this package stays free of xrpl.js, and left
 * generic so a caller who has xrpl.js keeps full checking on their own side.
 */
export type Transaction = TransactionLike

export type TransactionWithID = TransactionLike & { ID?: string }

export interface SignTransactionRequest {
  transaction: Transaction
}

export interface SubmitTransactionRequest {
  transaction: Transaction
}

export type TransactionErrorHandling = 'abort' | 'continue'

export const DEFAULT_SUBMIT_TX_BULK_ON_ERROR: TransactionErrorHandling = 'abort'

export interface SubmitBulkTransactionsRequest {
  transactions: TransactionWithID[]
  /**
   * Accepted for source compatibility. Joey always waits for the hashes it
   * reports, so `false` does not make the call return early.
   */
  waitForHashes?: boolean
  /**
   * Accepted for source compatibility and ignored. Joey always aborts the batch
   * at the first failure, which is GemWallet's own default and the safer of the
   * two behaviours — `'continue'` would keep signing after a transaction the
   * user or the ledger already refused.
   */
  onError?: TransactionErrorHandling
}

export interface IsInstalledResponse {
  result: { isInstalled: boolean }
}

export interface GetAddressResponse extends BaseResponse<{ address: string }> {}

export interface GetPublicKeyResponse
  extends BaseResponse<{ address: string; publicKey: string }> {}

export interface GetNetworkResponse
  extends BaseResponse<{ chain: string; network: Network; websocket: string }> {}

export interface SignMessageResponse extends BaseResponse<{ signedMessage: string }> {}

export interface SendPaymentResponse extends BaseResponse<{ hash: string }> {}

export interface SetTrustlineResponse extends BaseResponse<{ hash: string }> {}

export interface SignTransactionResponse
  extends BaseResponse<{ signature: string | null | undefined }> {}

export interface SubmitTransactionResponse extends BaseResponse<{ hash: string }> {}

export interface TransactionBulkResponse {
  id?: string
  accepted?: boolean
  hash?: string
  error?: string
}

export interface SubmitBulkTransactionsResponse
  extends BaseResponse<{ transactions: TransactionBulkResponse[] }> {}

/* -------------------------------------------------------------------- events */

export interface EventLoginResponse {
  loggedIn: boolean
}

export interface EventLogoutResponse {
  loggedIn: boolean
}

export interface EventNetworkChangedResponse {
  network: { name: string; server: string; description: string }
}

export interface EventWalletChangedResponse {
  wallet: { publicAddress: string }
}

/**
 * Event names.
 *
 * `@gemwallet/api`'s `on()` compares against the raw wire constants
 * (`EVENT_LOGIN` and friends), while GemWallet's documentation and most dapp
 * code use the short names. Both are accepted.
 */
export type GemEventType =
  | 'login'
  | 'logout'
  | 'networkChanged'
  | 'walletChanged'
  | 'EVENT_LOGIN'
  | 'EVENT_LOGOUT'
  | 'EVENT_NETWORK_CHANGED'
  | 'EVENT_WALLET_CHANGED'

export interface GemEventPayloadMap {
  login: EventLoginResponse
  logout: EventLogoutResponse
  networkChanged: EventNetworkChangedResponse
  walletChanged: EventWalletChangedResponse
}
