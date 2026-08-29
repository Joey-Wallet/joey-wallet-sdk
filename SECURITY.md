# Security Policy

## Reporting a vulnerability

Please report security issues privately, not as a public GitHub issue.

Use GitHub's [private vulnerability
reporting](https://github.com/joeywallet/joey-wallet-sdk/security/advisories/new)
on this repository.

Include what the issue is, the versions affected, and a reproduction if you
have one. You will get an acknowledgement within 72 hours.

## Scope

This repository holds the client SDK. It runs in the dapp's page and in the
extension's injected provider. It never has access to a private key, a seed, a
mnemonic or the wallet password — those live in the extension and never cross
this boundary.

Issues that are in scope here:

- A way to make the SDK send a request the dapp did not author.
- A way to make a call resolve with data belonging to an account the user did
  not share with that origin.
- A way to make the SDK misreport what the user approved — a resolved promise
  for a rejected approval, a transaction shape that differs from what the
  approval screen displayed, a hash that does not correspond to what was
  submitted.
- Prototype pollution, injection, or supply-chain exposure in the published
  tarballs.

Issues in the **wallet extension itself** — key storage, the approval screens,
transaction risk analysis — are not in this repository. Report those to the
same address; they will be routed.

## What is deliberately refused

The SDK cannot ask the wallet to sign `SetRegularKey`, `SignerListSet`,
`AccountDelete`, `AccountSet`, or `DelegateSet` on a dapp's behalf. The
extension rejects these at deserialisation, so a hand-rolled request carrying
one fails regardless of what the SDK sends. This is by design and is not a bug
report — see `packages/gemwallet-compat/src/unsupported.ts` for the reasoning.
