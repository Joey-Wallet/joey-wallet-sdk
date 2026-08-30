# Joey Wallet SDK

The client libraries for talking to [Joey Wallet](https://joeywallet.xyz), an
XRPL wallet browser extension. Two packages, both MIT, both published to npm.

| Package | What it is |
| --- | --- |
| [`@joeywallet/wallet-sdk`](packages/sdk) | The SDK. Detect the wallet, connect, sign and submit XRPL transactions, sign in. Typed, zero runtime dependencies, framework-agnostic with optional React bindings. |
| [`@joeywallet/gemwallet-compat`](packages/gemwallet-compat) | GemWallet's `@gemwallet/api` surface implemented over Joey. Migrate an existing dapp by changing one import. |

```bash
npm install @joeywallet/wallet-sdk
```

```ts
import { waitForJoey } from '@joeywallet/wallet-sdk'

const joey = await waitForJoey()
if (!joey) return // no wallet installed — show your own install prompt

const { accounts } = await joey.connect({ name: 'My Dapp' })

const { hash } = await joey.signAndSubmitTransaction({
  tx_json: {
    TransactionType: 'Payment',
    Account: accounts[0],
    Destination: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe',
    Amount: '1000000', // drops
  },
})
```

Full documentation lives in **[packages/sdk/README.md](packages/sdk/README.md)** —
detection, connection, payments, multisign and bulk signing, sign-in, events,
the error taxonomy, React hooks, and the transaction types Joey will not sign
for a dapp under any circumstances.

Migrating from GemWallet? See
**[packages/gemwallet-compat/README.md](packages/gemwallet-compat/README.md)**.

## Zero runtime dependencies

Both packages ship with no `dependencies`. A wallet SDK sits on the path
between a dapp and a user's private keys, so every transitive package it pulls
in is a package that can reach that path. `react` is an optional peer, needed
only if you import the hooks from `@joeywallet/wallet-sdk/react`; `xrpl` is a
dev dependency used to prove the transaction types stay assignable to
xrpl.js's, and is never imported at runtime.

The lockfile is installed with `hoist=false` and an empty
`onlyBuiltDependencies` allowlist: no dependency may run an install script, and
no package may resolve an import it did not declare.

## Development

Requires Node 22+ and pnpm 9.

```bash
pnpm install
pnpm verify   # ts:check, lint, and the full test suite
```

Individual steps: `pnpm build`, `pnpm ts:check`, `pnpm lint`, `pnpm test`.

`pnpm test` builds the packages first, deliberately — `gemwallet-compat`'s
tests import `@joeywallet/wallet-sdk` through its `exports` map, which points
at `dist/`, so a bare `vitest run` would grade whatever was last built. Use
`pnpm test:only` when you know `dist/` is fresh.

### Developing against the extension

The Joey Wallet extension consumes this SDK as a published dependency and keeps
a **wire contract test** that drives the real extension background against the
real built SDK. That test is the thing that catches protocol drift between the
two repos, and it lives with the wallet because the wallet is what must honour
the contract.

To develop both together, link this workspace into the extension checkout:

```bash
pnpm --dir ../joey-browser-extension/apps/extension link ../../../joey-wallet-sdk/packages/sdk
```

Run the extension's contract suite before opening a PR that changes anything in
`src/types.ts`, `src/client.ts`, or the error codes.

## Releasing

Contributor guide: [CONTRIBUTING.md](CONTRIBUTING.md).

Releases are driven by [changesets](https://github.com/changesets/changesets).
Add one in the same PR as your change:

```bash
pnpm changeset
```

Merging to `main` opens a release PR; merging that publishes both packages to
npm with [provenance](https://docs.npmjs.com/generating-provenance-statements).
The two packages are **linked** — they always share a version number, because
`gemwallet-compat` is a thin adapter over the SDK's exact runtime behaviour and
a consumer running mismatched versions is in a combination nobody tested.

## Versioning

Semantic versioning, where the public API is the TypeScript surface exported
from each package's `exports` map, plus the JSON-RPC method names, parameter
shapes and error codes the SDK sends over the wire.

A change that makes the wallet refuse a call it previously accepted is a
breaking change even when the TypeScript surface is unchanged.

## Security

These packages never see a private key, a seed, or a password — those stay in
the extension. The SDK's job is to shape a request and hand it to the wallet,
which is what asks the user.

Found a vulnerability? Please report it privately rather than opening a public
issue. See [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE).
