# Contributing

Thanks for looking. This repository holds the client SDK for
[Joey Wallet](https://joeywallet.xyz); the wallet extension itself is separate
and closed-source.

## Setup

Node 22+ and pnpm 9.

```bash
pnpm install
pnpm verify   # ts:check, lint, tests — what CI runs
```

## What to know before changing the protocol

The types in `packages/sdk/src/types.ts` are not a description of the wallet's
behaviour — they **are** the protocol. The extension imports them and is
verified against them by a wire contract test that lives in the wallet
repository and drives the real extension background against the built SDK.

So a change to a method name, a parameter shape or an error code is a change to
a contract with a consumer that cannot see your PR. Two consequences:

- Describe the wire effect in your changeset, not just the type change.
- Expect protocol changes to take longer to land than the diff suggests.

## Semver

The public API is every TypeScript symbol reachable from an `exports` entry
point, **plus** the JSON-RPC method names, parameter shapes and error codes sent
over the wire. Making the wallet refuse a call it previously accepted is a
breaking change even when nothing in the type surface moved. See
[docs/PUBLISHING.md](docs/PUBLISHING.md).

## Changesets

Every PR that changes published behaviour needs one:

```bash
pnpm changeset
```

The body becomes the changelog entry — write it for a dapp author reading
release notes.

## Tests

`pnpm test` builds first, deliberately: `gemwallet-compat`'s tests import the
SDK through its `exports` map, which points at `dist/`, so a bare `vitest run`
grades whatever was last built.

Most of the suite runs under `node`. Files needing a DOM opt in with a
`// @vitest-environment jsdom` pragma. That is not incidental — `detect.ts`
reports listener exceptions to the global, and only a real DOM realm routes them
somewhere userland can contain them.

## What will not be merged

- `signMessage`, or anything else that signs an arbitrary string. A bare
  signature carries no domain, nonce or timestamp, so it is replayable against
  another site. `signIn()` signs a CAIP-122 message bound to the origin.
- Dapp-facing support for `SetRegularKey`, `SignerListSet`, `AccountDelete`,
  `AccountSet` or `DelegateSet`. These hand a website standing or irreversible
  control of an account, and no approval dialog makes that safe, because the
  user cannot evaluate the consequence from transaction JSON. See
  `packages/gemwallet-compat/src/unsupported.ts`.
- XLS-56 `Batch`. Its `RawTransactions` are invisible on an approval screen, and
  a user cannot consent to what they were never shown. `signTransactionBulk` is
  a different thing — N independent transactions, each rendered on its own page
  — and the two must stay distinct in the code, the types, and the docs.
- A runtime dependency, unless there is no alternative. This package sits on the
  path between a dapp and a user's keys.
