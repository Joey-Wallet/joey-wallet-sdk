/**
 * The one error type every SDK method rejects with.
 *
 * Codes are EIP-1193 numbers verbatim rather than XRPL-specific strings,
 * because every wallet aggregator in this ecosystem already branches on them.
 * Two of them are Joey extensions in the same numeric space: 4300 (locked) and
 * 4902 (unrecognised chain).
 */

export const JOEY_ERROR_CODES = {
  /** The user declined the request in the wallet. */
  USER_REJECTED: 4001,
  /** The origin has not been granted access to the requested account. */
  UNAUTHORIZED: 4100,
  /** The provider does not implement this method. */
  UNSUPPORTED_METHOD: 4200,
  /** A vault exists but is locked, and the user did not unlock it. */
  LOCKED: 4300,
  /** No provider, or the provider is not connected to this origin. */
  DISCONNECTED: 4900,
  /** The provider is connected but cannot reach the requested chain. */
  CHAIN_DISCONNECTED: 4901,
  /**
   * The requested chain is not one of `xrpl:0`, `xrpl:1`, `xrpl:2` — or the
   * wallet is on a different one and will not sign for the one you asked for.
   *
   * Spelled with a `z`. Both spellings existed: the wallet's
   * `ProviderErrorCode` used `UNRECOGNIZED_CHAIN` and this table used
   * `UNRECOGNISED_CHAIN`, which is exactly the kind of thing that survives
   * until a dapp imports the wrong one. EIP-1193 names the code
   * "Unrecognized chain ID", so the standard's spelling wins over the rest of
   * this repo's British prose, and the wallet no longer declares a second copy
   * to disagree with.
   */
  UNRECOGNIZED_CHAIN: 4902,
  /**
   * Too many requests from this origin in too short a window.
   *
   * Reachable two ways, and a dapp that does not handle it will look broken in
   * both: the content-script bridge caps concurrent in-flight requests, and the
   * wallet blocks an origin the user has rejected three times in a row. Back
   * off; do not retry in a loop.
   */
  LIMIT_EXCEEDED: -32005,
  /** The message was not a well-formed request — no method, or not an object. */
  INVALID_REQUEST: -32600,
  /** Malformed arguments; the request never reached the approval queue. */
  INVALID_PARAMS: -32602,
  /** Anything the SDK could not classify. */
  INTERNAL: -32603,
} as const

export type JoeyErrorCode = (typeof JOEY_ERROR_CODES)[keyof typeof JOEY_ERROR_CODES]

export class JoeyRpcError extends Error {
  readonly code: number
  readonly data?: unknown

  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.name = 'JoeyRpcError'
    this.code = code
    if (data !== undefined) this.data = data
    // Restores the prototype chain when this file is transpiled to ES5 by a
    // consumer's bundler, so `instanceof JoeyRpcError` keeps working.
    Object.setPrototypeOf(this, JoeyRpcError.prototype)
  }

  /**
   * Normalise anything a provider threw into a `JoeyRpcError`.
   *
   * Providers reject with plain objects at least as often as with Errors, and
   * some older shims reject with a bare string.
   */
  static from(value: unknown, fallbackCode: number = JOEY_ERROR_CODES.INTERNAL): JoeyRpcError {
    if (value instanceof JoeyRpcError) return value

    if (typeof value === 'string') {
      return new JoeyRpcError(codeFromMessage(value, fallbackCode), value)
    }

    if (typeof value === 'object' && value !== null) {
      const record = value as { code?: unknown; message?: unknown; data?: unknown }
      const message =
        typeof record.message === 'string' && record.message.length > 0
          ? record.message
          : 'The wallet request failed.'
      const code =
        typeof record.code === 'number' ? record.code : codeFromMessage(message, fallbackCode)
      return new JoeyRpcError(code, message, record.data)
    }

    return new JoeyRpcError(fallbackCode, 'The wallet request failed.')
  }
}

/**
 * True when the user declined.
 *
 * Also matches on the message, because a provider that predates the numeric
 * codes (or a shim in between) may only carry the word. This is the same
 * string match the existing XRPL adapters do, which is why every rejection the
 * SDK constructs itself is worded to contain "rejected".
 */
export function isUserRejection(error: unknown): boolean {
  if (error instanceof JoeyRpcError) {
    if (error.code === JOEY_ERROR_CODES.USER_REJECTED) return true
    return /reject/i.test(error.message)
  }
  if (typeof error === 'object' && error !== null) {
    const record = error as { code?: unknown; message?: unknown }
    if (record.code === JOEY_ERROR_CODES.USER_REJECTED) return true
    return typeof record.message === 'string' && /reject/i.test(record.message)
  }
  return typeof error === 'string' && /reject/i.test(error)
}

export function userRejectedError(what = 'The user rejected the request.'): JoeyRpcError {
  return new JoeyRpcError(JOEY_ERROR_CODES.USER_REJECTED, what)
}

export function notInstalledError(): JoeyRpcError {
  return new JoeyRpcError(
    JOEY_ERROR_CODES.DISCONNECTED,
    'Joey Wallet is not installed, or its provider has not been injected into this page.',
  )
}

function codeFromMessage(message: string, fallbackCode: number): number {
  return /reject|denied|declined|cancell?ed/i.test(message)
    ? JOEY_ERROR_CODES.USER_REJECTED
    : fallbackCode
}
