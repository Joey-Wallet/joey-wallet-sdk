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

/* --------------------------------------------------------------- XLS-56 Batch */

/**
 * XLS-56 `Batch` mode flags: what the ledger does when an inner transaction
 * fails. Exactly one goes in the outer `Flags`; the wallet refuses none or two.
 *
 * `tfAllOrNothing` is the one to reach for: every inner transaction applies, or
 * none does. Under it a batch that fails is still `tesSUCCESS` (its fee is
 * charged and its sequence consumed) with **no inner transaction on the ledger
 * at all** — read {@link SignAndSubmitTransactionResult.batch}, never the outer
 * `engine_result`, to know whether it did anything.
 */
export const BATCH_FLAGS = {
  tfAllOrNothing: 0x00010000,
  tfOnlyOne: 0x00020000,
  tfUntilFailure: 0x00040000,
  tfIndependent: 0x00080000,
} as const

/**
 * The flag every inner transaction of a `Batch` carries, `tfInnerBatchTxn`.
 * It is what makes an inner transaction unsubmittable outside its batch.
 */
export const TF_INNER_BATCH_TXN = 0x40000000

/**
 * Another account's signature over a batch: one entry of `BatchSigners`.
 *
 * Under the `BatchV1_1` amendment it signs the outer `Account`, the outer
 * `Sequence` (or its `TicketSequence`), the outer `Flags`, every inner
 * transaction id, and its own `Account` — **not** the outer `Fee` or
 * `LastLedgerSequence`. So once it is attached the batch may not be renumbered,
 * re-moded or have an inner transaction changed; the fee may still be raised.
 * The outer account's own signature does not cover `BatchSigners`.
 */
export interface BatchSigner {
  BatchSigner: {
    Account: string
    SigningPubKey: string
    TxnSignature: string
  }
}

/**
 * One inner transaction of a `Batch`, as it must arrive for
 * `autofill: false`: `Fee: "0"`, an empty `SigningPubKey`, no signature, and
 * `Flags` carrying {@link TF_INNER_BATCH_TXN}. A `Sequence` — or `Sequence: 0`
 * with a `TicketSequence`. The signing account's own inner transactions take
 * the outer `Sequence` + 1, + 2, … in order and carry no `LastLedgerSequence`;
 * another account's number themselves on that account (usually by ticket).
 */
export interface BatchInnerTransaction extends AnyTransaction {
  Account: string
  Fee: '0'
  SigningPubKey: ''
  Flags: number
}

/**
 * An XLS-56 `Batch`, as Joey signs one for a website.
 *
 * Joey signs the **outer** transaction as the signing account, and renders
 * every inner transaction on its own card first. Every inner transaction is
 * held to the same rules as a top-level one — an account-control type inside a
 * batch is refused exactly as it is outside one, whoever's it is. Inner
 * transactions belonging to other accounts are allowed when each of those
 * accounts has signed through `BatchSigners`; Joey verifies every such
 * signature (and that its key is the account's) before the user's key is
 * used, and refuses a batch whose co-signatures do not match it. Joey never
 * produces a `BatchSigner` itself.
 *
 * Send a co-signed batch complete, with `autofill: false`: every field is
 * signed as given, and a `Batch` that carries `BatchSigners` or another
 * account's inner transaction is refused with autofill on, because filling
 * would invalidate the co-signatures. Check `supportsBatch()` first — an
 * extension older than this SDK refuses every `Batch` with `4100`. A Ledger
 * account cannot sign a `Batch` at all; the XRP app cannot display one.
 */
export interface BatchTransaction extends TransactionLike {
  TransactionType: 'Batch'
  Account: string
  /** Exactly one of {@link BATCH_FLAGS}. */
  Flags: number
  Sequence: number
  Fee: string
  /** Two to eight. */
  RawTransactions: Array<{ RawTransaction: BatchInnerTransaction }>
  BatchSigners?: BatchSigner[]
  [field: string]: unknown
}

/**
 * What became of a submitted batch's inner transactions, as the ledger
 * recorded them in the outer transaction's own ledger.
 */
export interface BatchSubmitOutcome {
  /** The batch's mode, by name — `tfAllOrNothing` and the rest. */
  mode?: keyof typeof BATCH_FLAGS
  /**
   * - `all` — every inner transaction applied.
   * - `none` — none did. Under `tfAllOrNothing` this is a rolled-back batch:
   *   the outer `engine_result` is still `tesSUCCESS`.
   * - `some` — some did (the other three modes only).
   * - `unknown` — the node could not say for at least one of them. Look the
   *   `inner` hashes up yourself before acting on it.
   */
  applied: 'all' | 'some' | 'none' | 'unknown'
  /** One entry per inner transaction, in `RawTransactions` order. */
  inner: Array<{
    /** The inner transaction's id: the hash it is recorded under if it applied. */
    hash: string
    account?: string
    /**
     * - `applied` — validated `tesSUCCESS`, its metadata's `ParentBatchID` the
     *   outer transaction's hash.
     * - `failed` — recorded with another result.
     * - `not_applied` — the node holds the outer's ledger and this is not in it.
     * - `unknown` — no definite answer.
     */
    status: 'applied' | 'failed' | 'not_applied' | 'unknown'
    engine_result?: string
  }>
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
  /**
   * Let the wallet fill Fee / Sequence / LastLedgerSequence. Default true.
   *
   * With `true` the wallet fills only fields you left out; it never replaces
   * one you set. **Send a co-signed `Batch` with `false`** — one carrying
   * `BatchSigners` or another account's inner transaction is refused with
   * autofill on, because the co-signatures cover its `Sequence` and every
   * inner transaction. See {@link BatchTransaction}.
   */
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
  /**
   * Preliminary engine result, e.g. `tesSUCCESS`. Not final until validated.
   * For a `Batch` it is the **outer** transaction's, and says nothing about the
   * inner ones — read `batch`.
   */
  engine_result?: string
  engine_result_message?: string
  /**
   * Present when the transaction submitted was an XLS-56 `Batch`: what became
   * of its inner transactions. **Decide success from `batch.applied`, never
   * from `engine_result`.** An all-or-nothing batch whose inner transaction
   * failed is `tesSUCCESS` with nothing applied.
   */
  batch?: BatchSubmitOutcome
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
 * ({@link BatchTransaction}) is a single transaction that carries others inside
 * `RawTransactions` and commits them atomically on-ledger; send one through
 * `signTransaction` or `signAndSubmitTransaction`, and the approval screen
 * renders every inner transaction on its own card. `signTransactionBulk` is the
 * opposite arrangement: ordinary, separate transactions, each signed on its
 * own, with no on-ledger atomicity at all. If transaction 3 fails, 1 and 2 have
 * still happened.
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
  /**
   * Zero-based index of the first entry that did not succeed.
   *
   * The error's `message` names the same number the same way — "transaction at
   * index 2 of 5 did not succeed: tecUNFUNDED_PAYMENT" — so the sentence and
   * the field cannot be read as disagreeing. It said "transaction 2 of 5" for
   * that case until this was written, which is the third transaction and the
   * one wording that can be read two ways.
   */
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

/**
 * What a software account answers with: a signature over a CAIP-122 message.
 *
 * `mode` is optional because wallets predating the second shape do not send
 * it. Do not branch on it being `caip122` — branch on the *other* shape, with
 * {@link isChallengeSignIn}, so an older wallet still takes this path.
 */
export interface Caip122SignInResult {
  address: string
  publicKey: string
  /** Hex-encoded signature. */
  signature: string
  /** The exact string that was signed. Rebuild it to verify the signature. */
  message: string
  mode?: 'caip122'
}

/**
 * What a hardware account answers with instead.
 *
 * A Ledger cannot produce the result above. The XRP app signs transactions and
 * has no message primitive at all, so there is no command to ask it for a
 * CAIP-122 signature — the wallet proves ownership by signing a canonical
 * 1-drop Payment on the device instead, and hands you the signed transaction.
 *
 * The transaction is built entirely by the wallet and is unsubmittable twice
 * over: `Sequence` is `0`, which is never valid for a funded account, and the
 * destination is the signing account itself, which `rippled` refuses as
 * `temREDUNDANT`. It carries your challenge in a memo, as
 * `{"wallet":"joey","challenge":"<nonce>"}` hex-encoded.
 *
 * ## Verifying one
 *
 * `signedTx` is `JSON.stringify` of the *bare* decoded transaction — not
 * wrapped in `{ tx_json: … }` — so `JSON.parse` it and use the result as a
 * transaction object. Re-encode it with `ripple-binary-codec` and check the
 * signature, then check the signer is the address you are about to trust.
 *
 * There is no `message` or `signature` field here, and that is the trap this
 * type exists to close: a verifier written for the CAIP-122 shape reads three
 * `undefined`s, sends them, and reports "signature did not verify" for a
 * signature the user made correctly on their device.
 */
export interface ChallengeSignInResult {
  address: string
  /** The bare signed transaction, JSON-encoded. */
  signedTx: string
  mode: 'challenge-v1'
}

/**
 * The result of {@link SignInParams}, in whichever form the account can make.
 *
 * Which one you get is the wallet’s decision and not yours: it depends on the
 * account the user picks, and they pick it after your call has been made.
 * Narrow with {@link isChallengeSignIn} before reading either shape.
 */
export type SignInResult = Caip122SignInResult | ChallengeSignInResult

/**
 * Whether a sign-in came back as a signed transaction rather than a message.
 *
 * Tests for the field rather than for `mode`, deliberately: wallets older than
 * the second shape send no `mode` at all, and a check written the other way
 * round would misroute every one of them.
 */
export function isChallengeSignIn(
  result: SignInResult,
): result is ChallengeSignInResult {
  return 'signedTx' in result
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
