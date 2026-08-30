# @joeywallet/wallet-sdk

TypeScript SDK for the [Joey Wallet](https://joeywallet.xyz) browser extension, a
self-custody XRP Ledger wallet.

- **Zero runtime dependencies.** Nothing is pulled into your bundle but this
  package.
- **Synchronous detection.** `isJoeyAvailable()` and `getJoey()` answer without a
  message round trip, so a cold extension worker never reads as "not installed".
- **Promises, not envelopes.** Every method resolves a value or throws
  `JoeyRpcError`.
- **Standards-first.** Joey registers under
  [XLS-72d / Wallet Standard](https://github.com/XRPLF/XRPL-Standards/discussions/206)
  with chains `xrpl:0` / `xrpl:1` / `xrpl:2` and uses EIP-1193 error codes
  verbatim. This SDK is a convenience layer over the injected provider, not a
  replacement for either surface.

```bash
npm install @joeywallet/wallet-sdk
# pnpm add @joeywallet/wallet-sdk
# yarn add @joeywallet/wallet-sdk
```

Requires an ESM bundler. `react` is an optional peer dependency, needed only for
`@joeywallet/wallet-sdk/react`.

---

## Detect

```ts
import { getJoey, isJoeyAvailable, waitForJoey } from '@joeywallet/wallet-sdk'

// Synchronous. No message is sent to the extension.
if (isJoeyAvailable()) {
  const joey = getJoey()! // never null when isJoeyAvailable() is true
}
```

`getJoey()` returns `Joey | null` **synchronously**, reading `window.joey` and
`window.xrpl.joey`. It is also safe to `await` — awaiting a non-promise costs
one microtask.

Your bundle can execute before the extension has finished injecting its
provider. When that happens, wait for the announcement instead of polling:

```ts
try {
  const joey = await waitForJoey({ timeoutMs: 3000 })
} catch {
  // No Joey on this page. Show your "install" call to action.
}
```

`waitForJoey()` resolves immediately when the provider is already present, so it
is safe to use as your only detection call. It settles on the provider's own
CAIP-294 `wallet_announce` and Wallet Standard `register-wallet` events — and,
because a wallet that installed before your bundle ran has already dispatched
both, it also dispatches the app-side prompts (`wallet_prompt` and
`wallet-standard:app-ready`) so that wallet announces itself again.

### Why detection never awaits the wallet

Wallet aggregators give each wallet roughly one second to prove it exists. Joey
runs its logic in a Manifest V3 background service worker, which Chrome
terminates after 30 seconds idle; a detection scheme that asks the worker "are
you there?" pays a cold start on the first call and loses that race
intermittently. So detection only ever reads page globals.

---

## Connect

```ts
import { getJoey, isUserRejection } from '@joeywallet/wallet-sdk'

const joey = getJoey()
if (joey === null) throw new Error('Joey is not installed')

const { accounts, chain } = await joey.connect({
  // Shown on the approval screen. Without them the user is asked to trust an
  // origin and nothing else. `icon` must be `https:` or `data:image/`.
  name: 'Example Exchange',
  icon: 'https://example.com/icon.png',
})
const account = accounts[0]

console.log(account?.address) // rLNaPoKeeBjZe2qs6x52yVPZpZ8td4dc6w
console.log(chain) // 'xrpl:0'
```

To reconnect on page load without opening an approval window, pass `silent`. It
resolves with an **empty** `accounts` array when the origin was never
authorised, rather than throwing — so it reveals nothing about whether a wallet
is installed, locked, or in use:

```ts
const { accounts } = await joey.connect({ silent: true })
if (accounts.length > 0) setAccount(accounts[0])
```

`joey.disconnect()` revokes this origin's access. `joey.accounts` and
`joey.isConnected()` read the current grant synchronously, with no round trip.

---

## Send a payment

`signAndSubmitTransaction` signs and submits in one approval. Amounts in XRP are
**drops** (1 XRP = 1,000,000 drops) as a string.

```ts
const result = await joey.signAndSubmitTransaction({
  tx_json: {
    TransactionType: 'Payment',
    Account: account.address,
    Destination: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe',
    Amount: '1000000', // 1 XRP
    DestinationTag: 42,
  },
})

console.log(result.hash, result.engine_result) // 'A1B2…', 'tesSUCCESS'
```

An issued currency uses the object form:

```ts
Amount: { currency: 'USD', issuer: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B', value: '25' }
```

Joey fills `Fee`, `Sequence` and `LastLedgerSequence` for you. Pass
`autofill: false` if you have already set them.

To get the signed blob back without submitting it, use `signTransaction`:

```ts
const { tx_blob, hash, tx_json } = await joey.signTransaction({ tx_json: payment })
```

`tx_json` in the result is the transaction **as signed** — decoded back out of
`tx_blob`, not echoed from what you sent. It carries the `Fee`, `Sequence` and
`LastLedgerSequence` the wallet filled in, the `SigningPubKey` and
`TxnSignature` it produced, and any normalisation the serialiser applied. That
is what you want to log; if it does not say what you expected, the bytes are
what it says.

### Choosing the account, and the chain

A user may grant your origin more than one address. When they have, sign with
the one your transaction names — otherwise the wallet uses the first address it
granted you and the signature does not match the transaction's `Account`:

```ts
await joey.signTransaction({
  account: account.address,
  chain: 'xrpl:0',
  tx_json: payment,
})
```

`chain` is a guard, not a request. If the wallet is on a different network the
call is refused with `CHAIN_DISCONNECTED` (4901) rather than signed. There is
deliberately no `switchNetwork`: a page-driven, wallet-wide network switch is a
phishing surface, so the user changes network in the wallet and your dapp is
told through the `networkChanged` event.

### How long a call can take

```ts
import { APPROVAL_TIMEOUT_MS, REQUEST_TIMEOUT_MS } from '@joeywallet/wallet-sdk'
```

Anything that needs an approval — every signing method, `signIn`, and a
non-silent `connect` — is waiting on a person and may legitimately be pending
for `APPROVAL_TIMEOUT_MS` (300,000 ms), plus a few seconds of the page's own
backstop. Everything else answers within `REQUEST_TIMEOUT_MS` (30,000 ms) or the
wallet is wedged. Do not put a thirty-second timeout around `signTransaction`:
you will cancel on a user who was still reading.

### Using xrpl.js types

This package does not import from `xrpl` — a published `.d.ts` that did would
fail to resolve for dapps that do not depend on xrpl.js. Every signing method is
generic instead, so if you *do* have xrpl.js, annotate your value and keep full
checking:

```ts
import type { Payment } from 'xrpl'

const payment: Payment = { TransactionType: 'Payment', /* … */ }
await joey.signAndSubmitTransaction({ tx_json: payment })
```

---

## Multisign and bulk signing

```ts
// One signature toward a multisigned transaction. `tx_signer` is the address
// signing; the transaction's own Account stays the multisigned account. It has
// to be an address the user granted you — the wallet refuses with 4100 rather
// than substituting one of its own.
const { tx_blob, hash } = await joey.signTransactionFor({
  tx_signer: account.address,
  tx_json: { TransactionType: 'Payment', Account: 'rMultisigAccount', /* … */ },
})
```

**`signTransactionFor` does not autofill, and `autofill: true` does not make it.**
The flag exists on the type because the signing methods share a parameter shape;
on this one it is ignored. Your `tx_json` must already carry `Fee`, `Sequence`
and `LastLedgerSequence`, or you get a real signature over a transaction
`rippled` will refuse — with no error until you submit it.

The reason is that a multisign signature is one of several over *identical
bytes*, and all three fields are inside those bytes. Two signers approving a few
seconds apart would read two different `LastLedgerSequence` values, and the
assembled transaction would validate at most one of their signatures. The `Fee`
is worse: the rule is `base_fee × (1 + signatures)`, a wallet contributes one
signature and cannot know how many others the signer list requires, and raising
the `Fee` afterwards discards every signature already collected. The coordinator
assembling the transaction is the only party that can choose these — that is
you.

```ts
import { MAX_BULK_TRANSACTIONS } from '@joeywallet/wallet-sdk'

// Up to MAX_BULK_TRANSACTIONS (32), one approval, signed in order.
const results = await joey.signTransactionBulk({
  tx_list: [{ tx_json: trustSet }, { tx_json: payment }],
  submit: true,
})

for (const entry of results) console.log(entry.hash)
```

`submit` has no default and the type requires it, because signing and submitting
are not interchangeable and a dapp that guesses wrong either double-spends or
never spends. `true` signs every transaction and then broadcasts them strictly
in order; `false` signs them and broadcasts **nothing**, handing the blobs back
for you to submit.

One approval covers the whole batch and one password unlocks it — the user pages
through every transaction and then decides once. They cannot approve some and
refuse others, on this wallet or on Joey mobile: it is one queue entry, one
approve, one reject. On a Ledger it is still one password, but N confirmations
on the device, one per transaction, which is what a hardware wallet is for.

The wallet numbers the batch **up front**: one reading of the ledger, `Sequence`
counting up from the account's next number, and 15 more ledgers of validity per
position so the transaction submitted last is not the one with the least time
left. A `Sequence` you set yourself is kept as it is and is not renumbered.

### When a batch fails part way

It rejects, and the error's `data` is a `SignTransactionBulkFailure`:

```ts
import type { JoeyRpcError, SignTransactionBulkFailure } from '@joeywallet/wallet-sdk'

try {
  await joey.signTransactionBulk({ tx_list, submit: true })
} catch (e) {
  const data = (e as JoeyRpcError).data as SignTransactionBulkFailure | undefined
  if (!data) throw e

  for (const entry of data.results) {
    switch (entry.status) {
      case 'submitted': break                 // on the ledger; entry.hash is real
      case 'failed':    break                 // definite; entry.engine_result says why
      case 'unknown':   break                 // may yet be validated — resolve by hash
      case 'signed':    break                 // never broadcast; submit it as it stands
      case 'stranded':  break                 // never broadcast and now dead — re-sign
    }
  }
}
```

Every blob comes back, including the ones that were never broadcast, so you
resume from `failedIndex` instead of asking the user to approve the batch again.

The `signed` / `stranded` split is the one thing you cannot work out for
yourself. The wallet reads the account's actual sequence once the batch stops
and walks the entries it never broadcast **in the order you would resubmit
them**: an entry is `signed` when the replay protection it holds is what the
ledger is at, and `stranded` when it is not — either already consumed, or behind
a gap this batch will never fill. In the ordinary case that follows the failing
code, because a `tec*` reached a ledger and consumed its sequence number while a
`tem*`/`tef*`/`tel*` consumed nothing. It does **not** follow the code once you
set your own `Sequence` values or use tickets, which is why it is computed
rather than inferred: a ticketed entry holds no sequence at all, so a failure
ahead of it leaves it perfectly submittable and it comes back `signed`; and two
entries you numbered identically can never both be `signed`. `unknown` settles
neither question and must not be treated as `failed`: the transaction may still
be validated, so resubmitting it is not safe.

Submit the `signed` entries in the order they appear. They are a chain — each
one's number only becomes current once the one before it has applied.

`failedIndex` is zero-based and every earlier transaction succeeded, and that
meaning is identical on Joey mobile over WalletConnect. **The record around it is
not.** Mobile rejects with `data` as a JSON *string* — WalletConnect types error
`data` as one — holding `{failedIndex, signedTxs}`, where `signedTxs` is an array
of bare `tx_json` carrying no `status`, and its `message` is the bare engine
token (`tecPATH_PARTIAL`) rather than a sentence. Here `data` is an object
holding `{failedIndex, results}`. A dapp integrating both wallets branches on the
container and on the array's name; `failedIndex` is what transfers unchanged.

> **`signTransactionBulk` is not XLS-56 `Batch`.** They are different things and
> Joey keeps them apart deliberately. A `Batch` is a *single* transaction
> carrying others inside `RawTransactions`, committed atomically on-ledger; Joey
> refuses to sign one for a website, because its approval screen renders the
> outer transaction and a user cannot consent to inner ones they were never
> shown. `signTransactionBulk` is the opposite arrangement: ordinary, separate
> transactions, each rendered on its own page of one approval, each signed on
> its own — and with no atomicity at all. If transaction 3 fails, 1 and 2 have
> still happened.


---

## Sign in

`signIn` authenticates a user without a transaction. The default mode signs a
[CAIP-122](https://namespaces.chainagnostic.org/xrpl/caip122) message under a
non-transaction domain separator, so the signature is cryptographically
incapable of being replayed as a transaction signature.

```ts
const result = await joey.signIn({
  statement: 'Sign in to Example Exchange',
  // nonce defaults to one the wallet generates; supply your own if your
  // backend issues it.
})

await fetch('/api/session', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    address: result.address,
    publicKey: result.publicKey,
    message: result.message,
    signature: result.signature,
  }),
})
```

Verify the signature server-side against `result.message` and check the nonce,
the domain and the issue time inside that message before trusting it.

Pass `resources` to name the scope you are asking for. It is shown on the
approval screen and written into the message's `Resources:` section, so it is
covered by the signature — rebuild the message with the same list, in the same
order, when you verify:

```ts
const result = await joey.signIn({
  statement: 'Sign in to Example',
  resources: ['https://example.com/terms', 'https://example.com/api'],
})
```

There is no Xaman-compatible `mode: 'xaman'`. It signed the
`{TransactionType:'SignIn'}` pseudo-transaction, and the property that made that
safe — `rippled` has no such transaction type, so the blob is unsubmittable — is
also why it could never be produced: `ripple-binary-codec` has no `SignIn`
either, so serialising one throws. The wallet answers `-32602` naming the mode
rather than quietly signing a CAIP-122 message in its place, so an existing
Xaman integration gets one clear error instead of a result with no `tx_blob` in
it.

There is no `signMessage`. A bare signature over an arbitrary string carries no
domain, nonce or timestamp, which makes it replayable against another site;
`signIn` is the primitive to use instead.

---

## Events

```ts
const off = joey.on('accountsChanged', (accounts) => {
  // An empty array means the user revoked this origin.
  setAccount(accounts[0] ?? null)
})

joey.on('networkChanged', (network) => setNetwork(network))
joey.on('disconnect', () => setAccount(null))

off() // or joey.off('accountsChanged', listener)
```

| Event             | Payload                                  |
| ----------------- | ---------------------------------------- |
| `connect`         | `{ accounts: JoeyAccount[], chain }` — on a *new* grant only; re-connecting an already-authorised origin emits nothing |
| `disconnect`      | `{ reason?: string }`                    |
| `accountsChanged` | `JoeyAccount[]`                          |
| `networkChanged`  | `JoeyNetwork \| null`                    |

Payloads are normalised by this SDK: the raw provider forwards whatever the
wallet sent, which may be bare address strings or `{ accounts: [...] }`.

Registering the same function twice gives you two subscriptions, and each needs
its own `off()` — the same rule `addEventListener` follows.

---

## Errors

Every method rejects with `JoeyRpcError { code, message, data? }`. Codes are
EIP-1193 numbers.

| Code    | Meaning                                                   |
| ------- | --------------------------------------------------------- |
| `4001`  | The user rejected the request                              |
| `4100`  | This origin is not authorised for that method              |
| `4200`  | The wallet does not support that method                    |
| `4300`  | The wallet is locked                                       |
| `4900`  | Not installed, or the provider is not connected            |
| `4901`  | The wallet is on a different chain than the one you asked for |
| `4902`  | Not an XRPL chain id at all                                |
| `-32005`| Too many requests. Back off; do not retry in a loop         |
| `-32600`| The request was not well formed                            |
| `-32602`| Malformed arguments                                        |
| `-32603`| Anything the SDK could not classify                        |

`-32005` is reachable two ways and a dapp that ignores it looks broken in both:
the content script caps concurrent in-flight requests, and the wallet blocks an
origin whose user has rejected three requests in a row.

```ts
import { JOEY_ERROR_CODES, JoeyRpcError, isUserRejection } from '@joeywallet/wallet-sdk'

try {
  await joey.signAndSubmitTransaction({ tx_json })
} catch (error) {
  if (isUserRejection(error)) {
    return // the user said no; not an error worth reporting
  }
  if (error instanceof JoeyRpcError && error.code === JOEY_ERROR_CODES.LOCKED) {
    return showBanner('Unlock Joey and try again.')
  }
  reportToSentry(error)
}
```

Prefer `isUserRejection(error)` over `error.code === 4001`: it also matches
providers and adapter shims that only carry the word in the message. Note that
an unconnected origin is told `4001` rather than `4300` even when the wallet is
in fact locked — the lock state is deliberately not readable by a site the user
has not connected.

---

## React

```bash
npm install @joeywallet/wallet-sdk react
```

```tsx
import { JoeyProvider } from '@joeywallet/wallet-sdk/react'

export function App() {
  return (
    <JoeyProvider autoConnect>
      <Wallet />
    </JoeyProvider>
  )
}
```

`autoConnect` reconnects *silently*: it returns only accounts the user has
already granted this origin and never opens an approval window on page load.

`useJoey()` gives you the connection state:

```tsx
import { useJoey } from '@joeywallet/wallet-sdk/react'

function Wallet() {
  const { isReady, isAvailable, account, network, connect, disconnect } = useJoey()

  if (!isReady) return null
  if (!isAvailable) return <a href="https://joeywallet.xyz">Install Joey</a>
  if (account === null) return <button onClick={() => void connect()}>Connect</button>

  return (
    <div>
      {/* network.name is 'Mainnet', 'Testnet' or 'Devnet'. */}
      {account} on {network?.name}
      <button onClick={() => void disconnect()}>Disconnect</button>
    </div>
  )
}
```

The mutation hooks are shaped like react-query mutations, without depending on
react-query:

```tsx
import { useSignAndSubmit } from '@joeywallet/wallet-sdk/react'

function Pay({ from }: { from: string }) {
  const { mutate, isPending, error, data, reset } = useSignAndSubmit({
    onSuccess: (result) => console.log(result.hash),
  })

  return (
    <>
      <button
        disabled={isPending}
        onClick={() =>
          mutate({
            tx_json: {
              TransactionType: 'Payment',
              Account: from,
              Destination: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe',
              Amount: '1000000',
            },
          })
        }
      >
        {isPending ? 'Approve in Joey…' : 'Send 1 XRP'}
      </button>
      {error && <p onClick={reset}>{error.message}</p>}
      {data && <p>{data.hash}</p>}
    </>
  )
}
```

`mutate` never rejects — read `error`. `mutateAsync` returns the promise if you
want to `await` it. A response from a superseded call is dropped, so a
double-click cannot render the first answer next to the second spinner.

Available hooks: `useConnect`, `useDisconnect`, `useSignTransaction`,
`useSignAndSubmit`, `useSignTransactionFor`, `useSignTransactionBulk`,
`useSignIn`, and `useJoeyMutation` for anything else.

---

## Without a framework

```html
<button id="connect"></button>
<script type="module">
  import { bindConnectButton, createJoeySession } from '@joeywallet/wallet-sdk/vanilla'

  const session = createJoeySession() // detects, and silently reconnects
  bindConnectButton(document.getElementById('connect'), session, {
    installUrl: 'https://joeywallet.xyz',
    onError: (error) => console.warn(error.message),
  })

  session.subscribe((state) => {
    console.log(state.account, state.network?.name)
  })
</script>
```

`session.getState()` is synchronous; `session.subscribe(fn)` calls `fn`
immediately with the current state and again on every change, and returns an
unsubscribe function. Call `session.destroy()` when you tear the page down.

---

## Typing `window.joey`

This package does not declare `window.joey` globally, because doing so collides
with other XRPL wallet SDKs that declare `window.xrpl`. Declare it yourself if
you want it:

```ts
import type { JoeyInjectedProvider } from '@joeywallet/wallet-sdk'

declare global {
  interface Window {
    joey?: JoeyInjectedProvider
  }
}
```

---

## Migrating from GemWallet

Use [`@joeywallet/gemwallet-compat`](../gemwallet-compat), which exports GemWallet's
exact function names and `{ type, result }` envelope over this SDK. Migration is
a one-line import change.

---

## Reference

### `Joey`

| Member | Returns |
| ------ | ------- |
| `accounts` | granted addresses, synchronously |
| `chain` | `JoeyChain \| null`, synchronously |
| `isConnected()` | `boolean`, synchronously |
| `connect(params?)` | `{ accounts, chain, networkId }` |
| `disconnect()` | `void` |
| `getAccounts()` | `string[]` — `[]` for an unconnected origin, never an error |
| `getNetwork()` | `{ chain, networkId, name }` — `name` is `'Mainnet'` / `'Testnet'` / `'Devnet'` |
| `signTransaction({ tx_json, account?, chain?, autofill? })` | `{ tx_json, tx_blob, hash }` |
| `signAndSubmitTransaction(…same…)` | the above plus `engine_result`, `engine_result_message` |
| `signTransactionFor({ tx_signer, tx_json, account?, chain?, autofill? })` | `{ tx_json, tx_blob, hash }` |
| `signTransactionBulk({ tx_list, submit, account?, chain?, autofill? })` | `SignAndSubmitTransactionResult[]` — `engine_result` only when `submit: true` |
| `signIn(params?)` | `{ address, publicKey, signature, message?, tx_blob? }` |
| `request({ method, params })` | escape hatch for newer wallet methods |
| `on(event, listener)` / `off(event, listener)` | subscription |

### Chains

| Chain    | Network | `NetworkID` |
| -------- | ------- | ----------- |
| `xrpl:0` | Mainnet | 0           |
| `xrpl:1` | Testnet | 1           |
| `xrpl:2` | Devnet  | 2           |

### Transactions Joey will not sign for a dapp

Six types, rejected whichever method carries them and at every nesting level,
with a message saying so. Read the list rather than discovering it by rejection:

```ts
import { JOEY_DAPP_FORBIDDEN_TRANSACTION_TYPES } from '@joeywallet/wallet-sdk'
```

| Type | Why |
| ---- | --- |
| `SetRegularKey` | Grants permanent signing authority over the account. |
| `SignerListSet` | The same, by multisign. |
| `DelegateSet` | The same again (XLS-75). With `Payment` in its `Permissions`, a standing licence to drain every balance. |
| `AccountDelete` | Irreversible. |
| `SetHook` | Installs code that runs on every future transaction. |
| `Batch` | Carries other transactions inside `RawTransactions`, which the approval screen cannot render — see the note under bulk signing. |

Two more rules are not expressible as a type name and are enforced anyway:

- **`AccountSet` is conditionally refused.** It is permitted for routine flags
  (`asfDefaultRipple` and the rest) and refused when it sets or clears one that
  changes who controls the account — `asfDisableMaster`, `asfRequireAuth`,
  `asfNoFreeze`, `asfDisallowXRP` and that family. A `SetRegularKey` plus a
  disable-master `AccountSet` is permanent, unrevokable takeover.
- **Pseudo-transactions are refused.** `EnableAmendment`, `SetFee` and
  `UNLModify` are written into a ledger by consensus; no account signs one, and
  `rippled` rejects one submitted over the network.

None of these is distinguishable from an ordinary transaction in a confirmation
dialog someone is skimming, which is why they are refused rather than surfaced
for approval. Users perform them from the Joey UI, where the wording can be as
blunt as it needs to be.
