/**
 * Public types for `@joeywallet/wallet-sdk`.
 *
 * These mirror the injected provider's surface field for field
 * (`apps/extension/src/provider/`). Where the two could drift, the provider
 * wins: this package is a convenience layer, not a second definition of the
 * protocol.
 *
 * Nothing here imports from `xrpl`. A published `.d.ts` that did would fail to
 * resolve for the (many) dapps that talk to a wallet without depending on
 * xrpl.js, and `skipLibCheck` only hides that, it does not fix it. Instead the
 * transaction argument of every signing method is generic over
 * {@link TransactionLike}, so a caller who *does* have xrpl.js can pass a
 * `Payment` / `TrustSet` / `SubmittableTransaction` and keep full checking on
 * their own side. `test/xrpl-types.test.ts` pins that assignability against the
 * real xrpl.js types.
 */

/* ------------------------------------------------------------------- chains */

/** CAIP-2 chain ids, as XLS-72d defines them. Mainnet 0, testnet 1, devnet 2. */
export const JOEY_CHAINS = ['xrpl:0', 'xrpl:1', 'xrpl:2'] as const

export type JoeyChain = (typeof JOEY_CHAINS)[number]

export interface JoeyNetwork {
  chain: JoeyChain
  /** The XRPL `NetworkID`. Same number as the chain id suffix. */
  networkId: number
  /** The wallet's own name for the network, e.g. `mainnet`. */
  name: string
}

export function isJoeyChain(value: unknown): value is JoeyChain {
  return typeof value === 'string' && (JOEY_CHAINS as readonly string[]).includes(value)
}

/** `xrpl:0` for network id 0, and so on. Throws for anything else. */
export function chainForNetworkId(networkId: number): JoeyChain {
  const chain = `xrpl:${networkId}`
  if (!isJoeyChain(chain)) {
    throw new RangeError(`Unrecognised XRPL network id: ${networkId}`)
  }
  return chain
}

/** The `NetworkID` a chain id refers to, or `null` when it is not an XRPL chain. */
export function networkIdForChain(chain: string): number | null {
  if (!isJoeyChain(chain)) return null
  return Number(chain.slice('xrpl:'.length))
}

/* ----------------------------------------------------------------- accounts */

/** An account as the wallet reports it. Never carries secret material. */
export interface JoeyAccount {
  /** Classic `r...` address. */
  address: string
  /** Hex-encoded public key. Absent for a watch-only account, which cannot sign. */
  publicKey?: string
  /** The nickname the user gave the account, when they chose to share it. */
  label?: string
}

/* ------------------------------------------------------- XRPL JSON primitives */

export interface IssuedCurrencyAmount {
  /** Three-character code or 40-character hex. */
  currency: string
  issuer: string
  /** Decimal string. Never a JS number — XRPL values exceed float64 precision. */
  value: string
}

export interface MPTAmount {
  mpt_issuance_id: string
  value: string
}

/** A bare string is drops of XRP. */
export type Amount = string | IssuedCurrencyAmount | MPTAmount

export interface Memo {
  Memo: {
    /** Hex-encoded. */
    MemoData?: string
    MemoType?: string
    MemoFormat?: string
  }
}

export interface Signer {
  Signer: {
    Account: string
    TxnSignature: string
    SigningPubKey: string
  }
}

export interface PathStep {
  account?: string
  currency?: string
  issuer?: string
  type?: number
  type_hex?: string
}

export type Path = PathStep[]

/**
 * The common fields of every XRPL transaction, used only as a generic
 * constraint.
 *
 * `Flags` is deliberately `number | object` rather than a flags interface:
 * xrpl.js models per-transaction flags as separate interfaces, and a TypeScript
 * interface is not assignable to an index-signature type, so anything narrower
 * here would reject a real `Payment`.
 */
export interface TransactionLike {
  TransactionType: string
  Account?: string
  Fee?: string
  Sequence?: number
  AccountTxnID?: string
  Flags?: number | object
  LastLedgerSequence?: number
  Memos?: Memo[]
  NetworkID?: number
  Signers?: Signer[]
  SourceTag?: number
  SigningPubKey?: string
  TicketSequence?: number
  TxnSignature?: string
}

/**
 * A transaction written inline, with no xrpl.js types to hand. The index
 * signature is what lets an object literal carry `Destination`, `Amount` and
 * the rest without an excess-property error.
 */
export interface AnyTransaction extends TransactionLike {
  [field: string]: unknown
}

/* ---------------------------------------------------------- method arguments */

export interface ConnectParams {
  /** Chain the dapp wants. Rejected with 4902 when it is not an XRPL chain. */
  chain?: JoeyChain
  /**
   * Only return accounts this origin has already been granted, with no prompt.
   * Resolves with an empty `accounts` array rather than an error, so it says
   * nothing about whether a wallet is installed, locked, or in use.
   */
  silent?: boolean
  /** Your dapp's name, shown on the approval screen. Up to 128 characters. */
  name?: string
  /**
   * An `https:` or `data:` URL for your dapp's icon, shown beside the name.
   * Anything else is ignored rather than rendered.
   */
  icon?: string
}

/**
 * The fields every signing method accepts on top of its own.
 *
 * Both are optional and both are worth sending. Omitting `account` is only safe
 * for an origin the user granted exactly one address; omitting `chain` means
 * you are signing whatever network the wallet happens to be on.
 */
export interface SigningContextParams {
  /**
   * Which granted address signs. Defaults to the first the user granted.
   *
   * A user may grant several, so send this whenever your transaction carries an
   * `Account`. The wallet refuses to sign a transaction whose `Account` is not
   * the signing address — `INVALID_PARAMS` (-32602), before the user is
   * prompted — rather than producing a valid signature over somebody else's
   * transaction and resolving as if it had worked.
   *
   * `signTransactionFor` is the exception, and there `tx_signer` says who
   * signs: a multisign entry is by definition a signature over a transaction
   * belonging to another account.
   */
  account?: string
  /**
   * The chain you believe you are on.
   *
   * When it is not the chain the wallet is on, the request is refused with
   * `CHAIN_DISCONNECTED` (4901) rather than signed. Joey has no
   * `switchNetwork`: a page-driven, wallet-wide network switch is a phishing
   * surface, so the user changes network in the wallet and the dapp is told
   * through `networkChanged`.
   */
  chain?: JoeyChain
}

export interface ConnectResult {
  accounts: JoeyAccount[]
  /** `null` when the wallet granted no accounts, so there is no chain to report. */
  chain: JoeyChain | null
  networkId: number | null
}

export interface SignTransactionParams<TTx extends TransactionLike = AnyTransaction>
  extends SigningContextParams {
  tx_json: TTx
  /** Let the wallet fill Fee / Sequence / LastLedgerSequence. Default true. */
  autofill?: boolean
}

export interface SignTransactionResult {
  /**
   * The transaction as signed — decoded back out of `tx_blob`, not echoed from
   * what you sent.
   *
   * That is the point of it: it carries the `Fee`, `Sequence` and
   * `LastLedgerSequence` the wallet filled in, the `SigningPubKey` and
   * `TxnSignature` it produced, and any normalisation the serialiser applied.
   * If it does not say what you expected, the bytes are what it says and not
   * what you sent.
   */
  tx_json: Record<string, unknown>
  /** Hex-encoded signed transaction blob, ready to submit. */
  tx_blob: string
  /** Hash of the signed blob. Not a confirmation on its own. */
  hash: string
}

export interface SignAndSubmitTransactionResult extends SignTransactionResult {
  /** Preliminary engine result, e.g. `tesSUCCESS`. Not final until validated. */
  engine_result?: string
  engine_result_message?: string
}

export interface SignTransactionForParams<TTx extends TransactionLike = AnyTransaction>
  extends SigningContextParams {
  /**
   * The address whose signature is being produced, which is *not* the
   * transaction's `Account` — that stays the multisigned account.
   *
   * It must be one of the addresses the user granted this origin; the wallet
   * answers `UNAUTHORIZED` (4100) rather than substituting one of its own.
   */
  tx_signer: string
  tx_json: TTx
  /**
   * **Ignored on this method.** Joey never autofills a multisign entry, and
   * passing `true` does not make it.
   *
   * The field is here because the parameter shape is shared with the other
   * signing methods, not because it does anything. Your `tx_json` is signed
   * exactly as you sent it, so it must already carry `Fee`, `Sequence` and
   * `LastLedgerSequence` — otherwise you get a real signature over a
   * transaction `rippled` will not accept, and no error until you submit it.
   *
   * The reason is that a multisign signature is one of several over *identical
   * bytes*. All three fields are inside the signed bytes, so two signers who
   * approve a few seconds apart would read two different `LastLedgerSequence`
   * values and the assembled transaction would validate at most one of their
   * signatures. The `Fee` is worse: the rule is `base_fee x (1 + signatures)`,
   * a wallet contributes one signature and cannot know how many others the
   * signer list requires, and a coordinator cannot raise a `Fee` afterwards
   * without discarding every signature it has already collected. The one party
   * who can choose these is the coordinator assembling the transaction — you.
   */
  autofill?: boolean
}

/**
 * N independent transactions, one approval, signed in order.
 *
 * **This is not XLS-56 `Batch`, and the two must not be confused.** A `Batch`
 * is a single transaction that carries others inside `RawTransactions` and
 * commits them atomically on-ledger; Joey refuses to sign one for a website
 * (see {@link JOEY_DAPP_FORBIDDEN_TRANSACTION_TYPES}) because its approval
 * screen renders the outer transaction and a user cannot consent to inner ones
 * they were never shown. `signTransactionBulk` is the opposite arrangement:
 * ordinary, separate transactions, each rendered on its own page of the
 * approval, each signed on its own, with no on-ledger atomicity at all. If
 * transaction 3 fails, 1 and 2 have still happened.
 */
export interface SignTransactionBulkParams<TTx extends TransactionLike = AnyTransaction>
  extends SigningContextParams {
  /** At most `MAX_BULK_TRANSACTIONS` entries; the wallet rejects a longer list. */
  tx_list: Array<{ tx_json: TTx }>
  autofill?: boolean
  /**
   * Whether the wallet broadcasts each transaction after signing it, or hands
   * the signed blobs back for you to submit.
   *
   * Required, with no default, because the two are not interchangeable and a
   * dapp that guesses wrong either double-spends or never spends. Joey mobile
   * defaults this to `true` over WalletConnect and the extension defaults it to
   * `false`; state your intent and neither default applies to you.
   */
  submit: boolean
}

/**
 * What became of one transaction of a bulk request that failed part way.
 *
 * The five values divide on two questions only the wallet can answer: did this
 * transaction get a definite answer, and is the replay protection it holds —
 * its sequence number, or its ticket — still reachable?
 *
 *  - `submitted` — validated `tesSUCCESS`. It happened; `hash` is on the ledger.
 *  - `failed` — a definite answer that is not success. `engine_result` says
 *    which. Resubmitting this blob is pointless.
 *  - `unknown` — **do not treat this as `failed`.** Either the submission got
 *    no answer at all, or it sits behind one that did not. It may yet be
 *    validated, so resubmitting is not safe. Resolve it by its `hash` first.
 *  - `signed` — signed, never broadcast, and still submittable exactly as it
 *    stands: it spends a ticket nothing touched, or it holds the sequence
 *    number the account is now at. Submit the `signed` entries in the order
 *    they appear — they are a chain.
 *  - `stranded` — signed, never broadcast, and dead. The sequence it holds is
 *    either already consumed or sits behind a gap this batch will never fill,
 *    so it can never apply. Discard it and ask the user again.
 *
 * The last two are decided per entry against the account's actual sequence, not
 * per batch off the failing transaction's code — the code alone is right only
 * for a contiguous run the wallet numbered itself, and both a ticket and a
 * `Sequence` you set yourself break that assumption, in opposite directions.
 */
export type BulkEntryStatus = 'submitted' | 'failed' | 'unknown' | 'signed' | 'stranded'

/** One entry of {@link SignTransactionBulkFailure.results}. */
export interface BulkEntryResult extends SignTransactionResult {
  status: BulkEntryStatus
  /** The ledger's own token for this transaction, when it produced one. */
  engine_result?: string
  engine_result_message?: string
}

/**
 * The `data` on the error a partially-executed `signTransactionBulk` rejects
 * with.
 *
 * A bulk request with `submit: true` signs every transaction before it
 * broadcasts any of them, so the blobs exist whatever happens at index 3 and
 * you get all of them back. Resume from `failedIndex` rather than asking the
 * user to approve the whole batch again.
 *
 * ```ts
 * try {
 *   await joey.signTransactionBulk({ tx_list, submit: true })
 * } catch (error) {
 *   const data = (error as JoeyRpcError).data as SignTransactionBulkFailure | undefined
 *   if (data) {
 *     // data.results[i].status tells you what to do with entry i.
 *   }
 * }
 * ```
 *
 * Joey mobile rejects a bulk request over WalletConnect with the same
 * `failedIndex` — zero-based, every earlier transaction succeeded, and the one
 * thing that transfers between the two wallets unchanged. The record carrying
 * it does not: mobile's `data` is a JSON *string* (WalletConnect types error
 * `data` as one) holding `{failedIndex, signedTxs}`, where `signedTxs` is bare
 * `tx_json` with no `status` on it, and its `message` is the engine token
 * alone. Branch on the container and the array name; do not write one handler
 * for both and expect it to parse.
 */
export interface SignTransactionBulkFailure {
  /** Zero-based index of the first entry that did not succeed. */
  failedIndex: number
  /** Every transaction in the batch, in the order you sent them. */
  results: BulkEntryResult[]
}

/**
 * Sign-in modes.
 *
 * One, and it is the safe one: `caip122` signs a human-readable CAIP-122 /
 * EIP-4361 string under a non-transaction domain separator, so the signature is
 * cryptographically incapable of being a transaction signature.
 *
 * **`xaman` has been removed.** It signed the `{TransactionType:'SignIn'}`
 * pseudo-transaction, and the property that made it safe — `rippled` has no
 * such type, so the blob is unsubmittable — is exactly why it could not be
 * produced: `ripple-binary-codec` has no `SignIn` either, so serialising one
 * threw, every time, *after* the user had approved. The wallet refuses
 * `mode: 'xaman'` by name rather than silently signing a CAIP-122 message in
 * its place, so an existing Xaman integration gets one clear error instead of a
 * result with no `tx_blob` in it.
 */
export type SignInMode = 'caip122'

export interface SignInParams {
  /** Default, and the only value. */
  mode?: SignInMode
  /** Human-readable line the wallet shows. At most 512 characters. */
  statement?: string
  /** The wallet generates one when omitted. At most 128 characters. */
  nonce?: string
  /**
   * Up to 16 URI strings naming the scope you are asking for.
   *
   * Shown on the approval screen and written into the message's `Resources:`
   * section, so they are part of what the signature covers: rebuild the message
   * with the same list, in the same order, to verify one.
   */
  resources?: string[]
}

export interface SignInResult {
  address: string
  publicKey: string
  /** Hex-encoded signature. */
  signature: string
  /** The exact string that was signed. Rebuild it to verify the signature. */
  message: string
}

/* -------------------------------------------------------------------- events */

export interface JoeyEventMap {
  /** The origin became authorised. */
  connect: { accounts: JoeyAccount[]; chain: JoeyChain | null }
  /** The origin lost authorisation, or the wallet locked. */
  disconnect: { reason?: string }
  /** The granted account set changed. Empty means the grant was revoked. */
  accountsChanged: JoeyAccount[]
  /** `null` when the wallet reported a chain this SDK does not recognise. */
  networkChanged: JoeyNetwork | null
}

export type JoeyEventName = keyof JoeyEventMap

export type JoeyEventListener<K extends JoeyEventName> = (payload: JoeyEventMap[K]) => void
