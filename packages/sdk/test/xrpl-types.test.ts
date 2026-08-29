/**
 * Pins the SDK's transaction typing against the real xrpl.js types.
 *
 * The published `.d.ts` deliberately does not import from `xrpl` — dapps that
 * talk to a wallet without depending on xrpl.js must still be able to resolve
 * it. That decision is only safe if a real `Payment`, `TrustSet` or
 * `SubmittableTransaction` still satisfies {@link TransactionLike}, so xrpl is a
 * devDependency and the assertions below are compiled by `tsconfig.test.json`.
 * Most of the value here is at compile time; the runtime assertions exist so
 * the file is a test rather than a comment.
 */
import { describe, expect, it } from 'vitest'
import type { Payment, SubmittableTransaction, TrustSet } from 'xrpl'

import { createJoeyClient } from '../src/client'
import type { AnyTransaction, TransactionLike } from '../src/types'
import { createMockProvider } from './harness'

type Assignable<T extends TransactionLike> = T

// If any of these stop compiling, the SDK's constraint has drifted from xrpl.js
// and the "no xrpl import in the public types" decision needs revisiting.
type _Payment = Assignable<Payment>
type _TrustSet = Assignable<TrustSet>
type _Submittable = Assignable<SubmittableTransaction>
type _Any = Assignable<AnyTransaction>

describe('xrpl.js interoperability', () => {
  it('accepts a value typed as xrpl.js Payment', async () => {
    const provider = createMockProvider()
    provider.respond('signTransaction', () => ({
      tx_json: {},
      tx_blob: '12000',
      hash: 'HASH',
    }))
    const joey = createJoeyClient(provider)

    const payment: Payment = {
      TransactionType: 'Payment',
      Account: 'rLNaPoKeeBjZe2qs6x52yVPZpZ8td4dc6w',
      Destination: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe',
      Amount: '1000000',
    }

    await expect(joey.signTransaction({ tx_json: payment })).resolves.toMatchObject({
      hash: 'HASH',
    })
    expect(provider.lastCall()?.params).toEqual({ tx_json: payment })
  })

  it('accepts an inline object literal with no xrpl.js types in sight', async () => {
    const provider = createMockProvider()
    provider.respond('signAndSubmitTransaction', () => ({
      tx_json: {},
      tx_blob: '12000',
      hash: 'HASH',
    }))
    const joey = createJoeyClient(provider)

    await expect(
      joey.signAndSubmitTransaction({
        tx_json: {
          TransactionType: 'TrustSet',
          Account: 'rLNaPoKeeBjZe2qs6x52yVPZpZ8td4dc6w',
          LimitAmount: {
            currency: 'USD',
            issuer: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B',
            value: '100',
          },
        },
      }),
    ).resolves.toMatchObject({ hash: 'HASH' })
  })

  it('accepts an xrpl.js flags interface, which is why Flags is number | object', () => {
    const payment: Payment = {
      TransactionType: 'Payment',
      Account: 'rLNaPoKeeBjZe2qs6x52yVPZpZ8td4dc6w',
      Destination: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe',
      Amount: '1000000',
      Flags: { tfPartialPayment: true },
    }
    const asConstraint: TransactionLike = payment
    expect(asConstraint.TransactionType).toBe('Payment')
  })
})
