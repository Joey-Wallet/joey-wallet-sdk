# @joeywallet/wallet-sdk

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
