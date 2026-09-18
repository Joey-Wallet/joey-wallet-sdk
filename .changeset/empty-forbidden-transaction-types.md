---
'@joeywallet/wallet-sdk': minor
---

Empty `JOEY_DAPP_FORBIDDEN_TRANSACTION_TYPES` and mark it deprecated.

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
