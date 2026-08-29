/**
 * The GemWallet methods Joey will not implement.
 *
 * `setRegularKey`, `setHook` and `setAccount` are account-control transactions.
 * `SetRegularKey` combined with `AccountSet asfDisableMaster` hands the caller
 * permanent, unrevokable control of an XRPL account, and the balance looks
 * untouched while it drains over later ledgers; `SetHook` installs code that
 * runs on every future transaction. Exposing any of them to an arbitrary
 * website is how XRPL accounts get taken over, and no approval dialog makes
 * that safe, because the user cannot evaluate the consequence from the
 * transaction JSON.
 *
 * Joey supports all three from its own UI, behind a typed confirmation and
 * step-up authentication. It does not expose them to dapps at all — the
 * extension hard-rejects `SetRegularKey`, `SignerListSet` and `AccountDelete`
 * at the deserialisation layer, so even a hand-rolled `signTransaction` call
 * carrying one of these transaction types fails.
 *
 * `signMessage` is here for a different reason: Joey has no raw
 * message-signing method at all. See below.
 *
 * The three account-control functions throw synchronously rather than returning
 * a rejected promise or a `{ type: 'reject' }` envelope, so a migrating dapp
 * finds out at the first call in development instead of shipping a silently
 * dead code path.
 */
export const UNSUPPORTED_METHODS = [
  'setRegularKey',
  'setHook',
  'setAccount',
  'signMessage',
] as const

export type UnsupportedMethod = (typeof UNSUPPORTED_METHODS)[number]

const REASONS: Record<UnsupportedMethod, string> = {
  setRegularKey:
    'SetRegularKey assigns an alternate signing key to the account. Together with AccountSet asfDisableMaster it is an irreversible account takeover, so Joey never exposes it to a website. Change your account keys from the Joey Wallet UI instead.',
  setHook:
    'SetHook installs code that runs on every future transaction for the account. Joey never exposes it to a website. Install hooks from the Joey Wallet UI instead.',
  setAccount:
    'AccountSet can disable the master key, set an NFT minter, or change the transfer rate. Joey never exposes it to a website. Change account settings from the Joey Wallet UI instead.',
  signMessage:
    'Joey does not sign arbitrary strings for a website: a bare signature carries no domain, nonce or timestamp, so it can be replayed against another site. Use signIn() from @joeywallet/wallet-sdk instead, which signs a CAIP-122 message bound to this origin.',
}

export class GemWalletUnsupportedError extends Error {
  /** EIP-1193 "unsupported method". */
  readonly code = 4200
  readonly method: UnsupportedMethod

  constructor(method: UnsupportedMethod) {
    super(`@joeywallet/gemwallet-compat does not implement ${method}(). ${REASONS[method]}`)
    this.name = 'GemWalletUnsupportedError'
    this.method = method
    Object.setPrototypeOf(this, GemWalletUnsupportedError.prototype)
  }
}

export function refuse(method: UnsupportedMethod): never {
  throw new GemWalletUnsupportedError(method)
}
