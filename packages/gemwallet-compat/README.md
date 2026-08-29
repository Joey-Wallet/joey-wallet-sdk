# @joeywallet/gemwallet-compat

GemWallet's `@gemwallet/api` surface, implemented over
[Joey Wallet](https://joeywallet.xyz). Migrate an existing GemWallet dapp by
changing one import.

```diff
- import { isInstalled, getAddress, sendPayment } from '@gemwallet/api'
+ import { isInstalled, getAddress, sendPayment } from '@joeywallet/gemwallet-compat'
```

```bash
npm install @joeywallet/gemwallet-compat
```

Function names, argument shapes and the `{ type, result }` envelope match
`@gemwallet/api@3.8.0`. You can keep your existing `result.type === 'reject'`
branches and your existing `try`/`catch` blocks.

---

## What is implemented

| Function | Behaviour |
| -------- | --------- |
| `isInstalled()` | `{ result: { isInstalled } }`. Answers immediately when Joey is present, otherwise gives it GemWallet's 1-second budget. Never rejects. |
| `getAddress()` | `{ type, result: { address } }`. Tries a silent connect first, then prompts if the origin is not yet authorised. |
| `getPublicKey()` | `{ type, result: { address, publicKey } }`. Throws for a watch-only account. |
| `getNetwork()` | `{ type, result: { chain, network, websocket } }` where `chain` is always `'XRPL'` and `network` is `Mainnet` / `Testnet` / `Devnet`. |
| `sendPayment(payload)` | Builds a `Payment`, signs and submits. `{ type, result: { hash } }` |
| `setTrustline(payload)` | Builds a `TrustSet`, signs and submits. `{ type, result: { hash } }` |
| `signTransaction({ transaction })` | `{ type, result: { signature } }` — `signature` is the signed blob, as in GemWallet. |
| `submitTransaction({ transaction })` | `{ type, result: { hash } }` |
| `submitBulkTransactions({ transactions })` | `{ type, result: { transactions: [{ id?, accepted, hash? }] } }` |
| `on(event, callback)` | `login`, `logout`, `networkChanged`, `walletChanged` |

Payload field casing is GemWallet's, not XRPL's: `{ fee, sequence, memos: [{ memo: { memoData } }] }`
is translated to `{ Fee, Sequence, Memos: [{ Memo: { MemoData } }] }` before
signing.

### Behavioural differences worth knowing

- **`on()` returns an unsubscribe function.** `@gemwallet/api` returns `void`.
  Existing call sites that ignore the return value are unaffected; SPAs that
  re-subscribe on every route change now have a way to avoid leaking listeners.
- **`on()` accepts both spellings.** `'login'` and the raw wire constant
  `'EVENT_LOGIN'` both work, because `@gemwallet/api`'s implementation compares
  against the latter while its documentation uses the former.
- **`submitBulkTransactions` always aborts at the first failure.** `onError` is
  accepted and ignored. `'abort'` is GemWallet's own default and the safer of
  the two: `'continue'` would keep signing after a transaction the user or the
  ledger already refused. Entries the aborted batch never reached come back as
  `{ accepted: false }` with no `hash`, correlated to your `ID` by position.
- **`getNetwork().websocket`** is the public endpoint for the chain Joey is on,
  so it can still be fed to an xrpl.js `Client` the way GemWallet dapps do.

---

## What is deliberately **not** implemented

`setRegularKey()`, `setHook()`, `setAccount()` and `signMessage()` throw
`GemWalletUnsupportedError` (code `4200`) **synchronously**, so you find out at
the first call in development rather than shipping a dead code path.

### The three account-control transactions

- **`SetRegularKey`** assigns an alternate signing key. Combined with
  `AccountSet asfDisableMaster` it hands the holder permanent, unrevokable
  control of the account — and the balance looks untouched while it drains over
  later ledgers.
- **`SetHook`** installs code that runs on every future transaction for the
  account.
- **`AccountSet`** can disable the master key, set an NFT minter, or change the
  transfer rate.

No approval dialog makes these safe, because the user cannot evaluate the
consequence from the transaction JSON. Joey supports them from its own UI,
behind a typed confirmation and step-up authentication, and the extension
hard-rejects `SetRegularKey`, `SignerListSet` and `AccountDelete` at the
deserialisation layer for any dapp-originated request — so routing one through
`signTransaction()` or `submitTransaction()` by hand does not work either.

```ts
import { GemWalletUnsupportedError, setRegularKey } from '@joeywallet/gemwallet-compat'

try {
  await setRegularKey({ regularKey: 'r…' })
} catch (error) {
  if (error instanceof GemWalletUnsupportedError) {
    // error.method  -> 'setRegularKey'
    // error.code    -> 4200
    showMessage('Change your account keys from the Joey Wallet extension.')
  }
}
```

### `signMessage`

Joey has no raw message-signing method. A bare signature over an arbitrary
string carries no domain, no nonce and no timestamp, so a signature a user
produced on one site can be replayed against another. Use `signIn()` from
[`@joeywallet/wallet-sdk`](../sdk) instead, which signs a CAIP-122 message bound to
this origin and returns the exact string that was signed for your backend to
verify:

```ts
import { requireJoey } from '@joeywallet/wallet-sdk'

const { address, publicKey, signature, message } = await requireJoey().signIn({
  statement: 'Sign in to Example',
})
```

### NFT and offer helpers

GemWallet's `mintNFT`, `createNFTOffer`, `acceptNFTOffer`, `cancelNFTOffer`,
`burnNFT`, `getNFT`, `createOffer` and `cancelOffer` are not in this package.
They carry no security objection — they are ordinary transactions — so build
them with `submitTransaction({ transaction })`, or use `@joeywallet/wallet-sdk`
directly.

---

## Once you have migrated

This package exists to make the switch free, not to be the destination. When you
have time, move to [`@joeywallet/wallet-sdk`](../sdk): promise rejections instead of a
`{ type, result }` envelope, typed events, React hooks, multisign and bulk
signing.

```ts
// @joeywallet/gemwallet-compat
const result = await sendPayment({ amount: '1000000', destination })
if (result.type === 'reject') return
console.log(result.result?.hash)

// @joeywallet/wallet-sdk
const { hash } = await joey.signAndSubmitTransaction({
  tx_json: {
    TransactionType: 'Payment',
    Account: address,
    Destination: destination,
    Amount: '1000000',
  },
})
```
