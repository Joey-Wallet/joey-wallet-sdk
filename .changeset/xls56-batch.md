---
'@joeywallet/wallet-sdk': minor
---

XLS-56 `Batch`: types, a capability probe, and the result field that says whether a batch applied.

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
