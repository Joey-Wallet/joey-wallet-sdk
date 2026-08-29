/**
 * GemWallet request shapes to XRPL transaction JSON.
 *
 * GemWallet's payloads are camelCase and its memo/signer wrappers are lowercase
 * (`{ memo: { memoData } }`), while the ledger — and therefore everything Joey
 * signs — uses XRPL's PascalCase field names. Every mapping here is mechanical;
 * it is separated out because a mistake in it would show up as a transaction
 * that silently loses a destination tag or a memo.
 */
import type {
  AnyTransaction,
  JoeyChain,
  JoeyNetwork,
  Memo as XrplMemo,
  Signer as XrplSigner,
} from '@joeywallet/wallet-sdk'

import type {
  BaseTransactionRequest,
  Memo as GemMemo,
  Network,
  SendPaymentRequest,
  SetTrustlineRequest,
  Signer as GemSigner,
} from './types.js'

/** Drops keys whose value is `undefined` so the wire message stays minimal. */
function defined<T extends Record<string, unknown>>(source: T): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) out[key] = value
  }
  return out
}

export function toXrplMemos(memos: GemMemo[] | undefined): XrplMemo[] | undefined {
  if (memos === undefined) return undefined
  return memos.map((entry) => ({
    Memo: defined({
      MemoData: entry.memo.memoData,
      MemoType: entry.memo.memoType,
      MemoFormat: entry.memo.memoFormat,
    }) as XrplMemo['Memo'],
  }))
}

export function toXrplSigners(signers: GemSigner[] | undefined): XrplSigner[] | undefined {
  if (signers === undefined) return undefined
  return signers.map((entry) => ({
    Signer: {
      Account: entry.signer.account,
      TxnSignature: entry.signer.txnSignature,
      SigningPubKey: entry.signer.signingPubKey,
    },
  }))
}

/** The fields every GemWallet transaction request shares. */
export function toXrplCommonFields(request: BaseTransactionRequest): Record<string, unknown> {
  return defined({
    Fee: request.fee,
    Sequence: request.sequence,
    AccountTxnID: request.accountTxnID,
    LastLedgerSequence: request.lastLedgerSequence,
    Memos: toXrplMemos(request.memos),
    NetworkID: request.networkID,
    Signers: toXrplSigners(request.signers),
    SourceTag: request.sourceTag,
    SigningPubKey: request.signingPubKey,
    TicketSequence: request.ticketSequence,
    TxnSignature: request.txnSignature,
  })
}

/**
 * GemWallet's `sendPayment` payload as an XRPL `Payment`.
 *
 * **`amount` crosses untouched, and that is correct — checked, not assumed.**
 * It is the one line in this package where being wrong costs a factor of a
 * million, so the source is named rather than trusted to memory:
 * `@gemwallet/api@3.8.0` types `SendPaymentRequest.amount` as xrpl.js's
 * `Amount`, and `packages/constants/src/payload/payload.types.ts` documents it
 * verbatim as *"A string representing the number of XRP to deliver, in drops."*
 * Joey's `Payment.Amount` is drops. Same unit, no conversion, and a converting
 * shim here would be the bug rather than the fix.
 *
 * The one place GemWallet does convert is its extension's `parseAmount`, and
 * only for its deprecated v1 URL-parameter path, where `amount` arrives as a
 * *number* of XRP. That path is not this API and never reaches this function:
 * `amount` here is a `string` or an issued-currency object, both of which
 * GemWallet forwards to the ledger exactly as this does.
 *
 * `convert.test.ts` pins both halves — drops for XRP, `value` untouched for an
 * issued currency — so a future "helpful" `xrpToDrops` fails a test instead of
 * a user's payment.
 */
export function toPaymentTransaction(
  request: SendPaymentRequest,
  account?: string,
): AnyTransaction {
  return {
    TransactionType: 'Payment',
    ...(account === undefined ? {} : { Account: account }),
    ...toXrplCommonFields(request),
    ...defined({
      // Drops. See the note above before changing this.
      Amount: request.amount,
      Destination: request.destination,
      DestinationTag: request.destinationTag,
      InvoiceID: request.invoiceID,
      Paths: request.paths,
      SendMax: request.sendMax,
      DeliverMin: request.deliverMin,
      Flags: request.flags,
    }),
  } as AnyTransaction
}

export function toTrustSetTransaction(
  request: SetTrustlineRequest,
  account?: string,
): AnyTransaction {
  return {
    TransactionType: 'TrustSet',
    ...(account === undefined ? {} : { Account: account }),
    ...toXrplCommonFields(request),
    ...defined({
      LimitAmount: request.limitAmount,
      QualityIn: request.qualityIn,
      QualityOut: request.qualityOut,
      Flags: request.flags,
    }),
  } as AnyTransaction
}

/* ------------------------------------------------------------------ networks */

/**
 * The public endpoints for each chain.
 *
 * Duplicated from the extension's `shared/types.ts` `NETWORKS` rather than
 * imported: this package is published to npm and cannot depend on the
 * extension's source. GemWallet's `getNetwork()` contract promises a
 * `websocket`, and dapps feed it straight into an xrpl.js `Client`, so
 * answering with an empty string would break every migrating caller. They must
 * be kept in step with the extension if an endpoint ever moves.
 */
const WEBSOCKET_BY_CHAIN: Record<JoeyChain, string> = {
  'xrpl:0': 'wss://s1.ripple.com/',
  'xrpl:1': 'wss://testnet.xrpl-labs.com/',
  'xrpl:2': 'wss://s.devnet.rippletest.net:51233/',
}

const GEM_NAME_BY_CHAIN: Record<JoeyChain, Network> = {
  'xrpl:0': 'Mainnet',
  'xrpl:1': 'Testnet',
  'xrpl:2': 'Devnet',
}

const DESCRIPTION_BY_CHAIN: Record<JoeyChain, string> = {
  'xrpl:0': 'Main XRPL network',
  'xrpl:1': 'XRPL Testnet',
  'xrpl:2': 'XRPL Devnet',
}

/**
 * Joey's network to GemWallet's `Network` string.
 *
 * GemWallet also has `Custom`, which Joey never returns: the extension ships a
 * fixed set of three endpoints.
 */
export function toGemNetwork(network: JoeyNetwork): Network {
  return GEM_NAME_BY_CHAIN[network.chain]
}

export function toGemWebsocket(network: JoeyNetwork): string {
  return WEBSOCKET_BY_CHAIN[network.chain]
}

/** GemWallet's human-readable network description, for the event payload. */
export function toGemNetworkDescription(network: JoeyNetwork): string {
  return DESCRIPTION_BY_CHAIN[network.chain]
}
