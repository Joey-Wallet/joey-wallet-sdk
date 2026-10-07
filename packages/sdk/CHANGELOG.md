# @joeywallet/wallet-sdk

## 0.5.0

### Minor Changes

- 8f8d8cb: XLS-56 `Batch`: types, a capability probe, and the result field that says whether a batch applied.

  A Joey extension that advertises the new `batch` capability signs an XLS-56
  `Batch` for a website, including one another account has co-signed through
  `BatchSigners` (a marketplace's broker accepting the offer your user's own inner
  transaction creates). Every inner transaction is rendered on its own card and
  held to the same rules as a top-level one; Joey signs the outer transaction and
  never produces a `BatchSigner` itself.

  New exports, no runtime dependency:

  - `joey.supportsBatch()` and `joey.capabilities`; `JOEY_CAPABILITIES`,
    `hasCapability(provider, name)`, and `capabilities?: readonly string[]` on
    `JoeyInjectedProvider`. An extension older than the field has no list and
    answers `false` — it refuses every `Batch` with `4100`.
  - `BATCH_FLAGS`, `TF_INNER_BATCH_TXN`, and the types `BatchTransaction`,
    `BatchInnerTransaction`, `BatchSigner`, `BatchSubmitOutcome`.
  - `SignAndSubmitTransactionResult.batch`: for a submitted `Batch`, what became
    of its inner transactions — `applied: 'all' | 'some' | 'none' | 'unknown'`
    and one `{ hash, account, status, engine_result }` per inner transaction.
    **Decide success from `batch.applied`, not `engine_result`**: an
    all-or-nothing batch that rolled back is `tesSUCCESS` with nothing applied.

  Wire rules a dapp must follow (enforced by the wallet, documented under
  "XLS-56 Batch" in the README): send a co-signed batch complete with
  `autofill: false` — with autofill on it is refused with `-32602`, because the
  co-signatures cover its `Sequence` and every inner transaction; every
  `BatchSigners` signature must verify over the batch as sent and be made with a
  key its account authorises; the user's own inner transactions take the outer
  `Sequence` + 1, + 2, … and carry no `LastLedgerSequence`. A Ledger account
  cannot sign a `Batch`.

  Nothing that worked before changes: a wallet without the capability behaves as
  it did, and no existing type was narrowed.

## 0.4.0

### Minor Changes

- 64bfd27: Empty `JOEY_DAPP_FORBIDDEN_TRANSACTION_TYPES` and mark it deprecated.

  The constant is now `[]`. It was never an enforcement point — no SDK method
  read it, and `signTransaction`, `signTransactionFor` and `signTransactionBulk`
  pass `tx_json` to the provider unread — so this removes a published warning,
  not a restriction.

  The wallet's own refusals are unchanged and still applied at approval time, at
  every nesting level: `SetRegularKey`, `SignerListSet`, `DelegateSet`,
  `AccountDelete`, `SetHook` and `Batch`, plus a control-flag `AccountSet`
  (`asfDisableMaster` and that family) and the pseudo-transactions
  `EnableAmendment`, `SetFee` and `UNLModify`.

  **If you gate on this constant, that gate now passes everything.** A passing
  check is not permission to sign; those transactions will be rejected with a
  `4100` from the approval queue instead, so handle the rejection there.

## 0.3.0

### Minor Changes

- 2ae6cab: `SignInResult` is now a union, because a hardware account signs in differently.

  A Ledger cannot produce a CAIP-122 signature — the XRP app signs transactions and
  has no message primitive, so there is no command to ask it for one. Rather than
  refuse the sign-in, the wallet has the device sign a canonical, unsubmittable
  1-drop Payment and returns that instead, as `ChallengeSignInResult`:

  ```ts
  {
    address: string;
    signedTx: string;
    mode: "challenge-v1";
  }
  ```

  `signedTx` is `JSON.stringify` of the bare signed transaction, byte-identical to
  what the Joey mobile wallet puts in a WalletConnect session's
  `xrpl_signin_v1_signed_tx` — so a backend that already verifies mobile Joey
  sign-ins verifies these unchanged.

  **This is a breaking type change.** Code that reads `result.message`,
  `result.publicKey` or `result.signature` without narrowing no longer compiles.
  That is the point: it did not fail at compile time before, it failed at runtime,
  and it failed in the least legible way available — the CAIP-122 verifier was
  handed three `undefined`s, answered with no session, and the user was told their
  signature did not verify, seconds after making it correctly on their device.

  Narrow with the new `isChallengeSignIn` guard:

  ```ts
  import { isChallengeSignIn } from "@joeywallet/wallet-sdk";

  const result = await joey.signIn({ statement: "Sign in to Example" });
  if (isChallengeSignIn(result)) {
    // verify result.signedTx
  } else {
    // verify result.message against result.signature
  }
  ```

  It tests for the `signedTx` field rather than for `mode`, deliberately: wallets
  older than this shape send no `mode` at all, and a check written the other way
  round would misroute every one of them.

  The CAIP-122 shape is otherwise unchanged and is now exported by name as
  `Caip122SignInResult`. It gains an optional `mode?: 'caip122'`, which the wallet
  sends and older builds do not.

## 0.2.0

### Minor Changes

- 831d8fd: First published release.

  The SDK and the GemWallet compatibility layer, extracted from the Joey Wallet
  extension. Pre-1.0 deliberately: the wire protocol is still moving, and 0.x is
  where a breaking change costs a minor bump rather than a migration note.
