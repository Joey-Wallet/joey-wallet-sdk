/**
 * GemWallet's `{ type, result }` envelope, reconstructed on top of Joey's
 * promise-rejection API.
 *
 * The two models disagree about exactly one thing, and this file is where that
 * disagreement is resolved: GemWallet reports a user declining as a *resolved*
 * `{ type: 'reject' }`, and reports everything else by throwing. Joey rejects
 * with a `JoeyRpcError` in both cases. So a 4001 becomes `{ type: 'reject' }`
 * and every other code is rethrown, which is what a GemWallet dapp's existing
 * `if (result.type === 'reject')` branch and its `try`/`catch` already expect.
 */
import { JoeyRpcError, isUserRejection } from '@joeywallet/wallet-sdk'

import type { BaseResponse } from './types.js'

export function response<T>(result: T): BaseResponse<T> & { type: 'response'; result: T } {
  return { type: 'response', result }
}

export function rejected<T>(): BaseResponse<T> & { type: 'reject' } {
  return { type: 'reject', result: undefined }
}

export async function envelope<T>(run: () => Promise<T>): Promise<BaseResponse<T>> {
  try {
    return response(await run())
  } catch (cause) {
    if (isUserRejection(cause)) return rejected<T>()
    throw JoeyRpcError.from(cause)
  }
}
