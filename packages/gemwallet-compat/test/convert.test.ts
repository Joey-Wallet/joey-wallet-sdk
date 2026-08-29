import { describe, expect, it } from 'vitest'

import {
  toGemNetwork,
  toGemNetworkDescription,
  toGemWebsocket,
  toPaymentTransaction,
  toTrustSetTransaction,
  toXrplCommonFields,
  toXrplMemos,
  toXrplSigners,
} from '../src/convert'

describe('memo and signer casing', () => {
  it('lifts GemWallet lowercase memos into XRPL field names', () => {
    expect(toXrplMemos([{ memo: { memoData: '4142', memoFormat: '74657874' } }])).toEqual([
      { Memo: { MemoData: '4142', MemoFormat: '74657874' } },
    ])
  })

  it('drops memo sub-fields that were not supplied', () => {
    const [entry] = toXrplMemos([{ memo: { memoData: '41' } }]) ?? []
    expect(Object.keys(entry?.Memo ?? {})).toEqual(['MemoData'])
  })

  it('returns undefined rather than an empty array for absent memos', () => {
    expect(toXrplMemos(undefined)).toBeUndefined()
    expect(toXrplSigners(undefined)).toBeUndefined()
  })

  it('lifts signers', () => {
    expect(
      toXrplSigners([
        { signer: { account: 'rA', txnSignature: '30450221', signingPubKey: 'ED01' } },
      ]),
    ).toEqual([{ Signer: { Account: 'rA', TxnSignature: '30450221', SigningPubKey: 'ED01' } }])
  })
})

describe('common transaction fields', () => {
  it('maps every documented field', () => {
    expect(
      toXrplCommonFields({
        fee: '12',
        sequence: 1,
        accountTxnID: 'AA',
        lastLedgerSequence: 100,
        networkID: 0,
        sourceTag: 9,
        signingPubKey: 'ED',
        ticketSequence: 3,
        txnSignature: '30',
      }),
    ).toEqual({
      Fee: '12',
      Sequence: 1,
      AccountTxnID: 'AA',
      LastLedgerSequence: 100,
      NetworkID: 0,
      SourceTag: 9,
      SigningPubKey: 'ED',
      TicketSequence: 3,
      TxnSignature: '30',
    })
  })

  it('keeps a zero, which a truthiness check would have dropped', () => {
    expect(toXrplCommonFields({ sequence: 0, sourceTag: 0 })).toEqual({
      Sequence: 0,
      SourceTag: 0,
    })
  })

  it('produces nothing for an empty request', () => {
    expect(toXrplCommonFields({})).toEqual({})
  })
})

describe('transaction builders', () => {
  it('sets TransactionType and the account', () => {
    expect(toPaymentTransaction({ amount: '1', destination: 'rB' }, 'rA')).toEqual({
      TransactionType: 'Payment',
      Account: 'rA',
      Amount: '1',
      Destination: 'rB',
    })
  })

  it('leaves Account out when the caller has no account yet', () => {
    expect(toPaymentTransaction({ amount: '1', destination: 'rB' })).not.toHaveProperty('Account')
  })

  /**
   * The unit of `amount`, asserted rather than assumed.
   *
   * The single most expensive mistake this package could make: GemWallet's
   * `amount` and Joey's `Payment.Amount` are both **drops**, so it crosses
   * untouched. If either side had meant XRP, every migrating dapp's first
   * payment would be wrong by a factor of a million — a 1 XRP send becoming
   * 1,000,000 XRP or 0.000001, in the first function they call.
   *
   * Established from GemWallet's own source, not from its prose:
   * `@gemwallet/api@3.8.0` types the field as xrpl.js's `Amount`, and
   * `packages/constants/src/payload/payload.types.ts` annotates it *"A string
   * representing the number of XRP to deliver, in drops."* Its `sendPayment`
   * forwards the payload with no conversion of any kind.
   *
   * The test is the guard against the plausible-sounding fix: a contributor who
   * reads "amount" as XRP and adds an `xrpToDrops` here breaks this rather than
   * a user.
   */
  describe('the unit of amount', () => {
    it('passes a drops string through with no conversion', () => {
      // 1 XRP. Not 1_000_000 XRP, and not 0.000001.
      expect(toPaymentTransaction({ amount: '1000000', destination: 'rB' }, 'rA')).toMatchObject({
        Amount: '1000000',
      })
    })

    it('does not rescale a small drops amount', () => {
      // The value a bad conversion would turn into '1000000'.
      expect(toPaymentTransaction({ amount: '1', destination: 'rB' }, 'rA')).toMatchObject({
        Amount: '1',
      })
    })

    it('leaves an issued-currency value exactly as given', () => {
      // Token amounts are in currency units on both sides and have nothing to
      // do with drops. `value` stays a decimal string: no Number, no toFixed.
      const amount = { currency: 'USD', issuer: 'rI', value: '10.500' }
      expect(toPaymentTransaction({ amount, destination: 'rB' }, 'rA')).toMatchObject({
        Amount: { currency: 'USD', issuer: 'rI', value: '10.500' },
      })
    })

    it('applies the same rule to sendMax and deliverMin', () => {
      expect(
        toPaymentTransaction(
          { amount: '1000000', destination: 'rB', sendMax: '1200000', deliverMin: '900000' },
          'rA',
        ),
      ).toMatchObject({ SendMax: '1200000', DeliverMin: '900000' })
    })
  })

  it('carries paths, sendMax and deliverMin for a cross-currency payment', () => {
    const tx = toPaymentTransaction(
      {
        amount: { currency: 'USD', issuer: 'rI', value: '10' },
        destination: 'rB',
        sendMax: '20000000',
        deliverMin: { currency: 'USD', issuer: 'rI', value: '9' },
        paths: [[{ currency: 'USD', issuer: 'rI' }]],
        invoiceID: 'FF',
        flags: 131072,
      },
      'rA',
    )
    expect(tx).toMatchObject({
      SendMax: '20000000',
      DeliverMin: { value: '9' },
      Paths: [[{ currency: 'USD', issuer: 'rI' }]],
      InvoiceID: 'FF',
      Flags: 131072,
    })
  })

  it('builds a TrustSet', () => {
    expect(
      toTrustSetTransaction(
        { limitAmount: { currency: 'USD', issuer: 'rI', value: '0' }, qualityOut: 2 },
        'rA',
      ),
    ).toEqual({
      TransactionType: 'TrustSet',
      Account: 'rA',
      LimitAmount: { currency: 'USD', issuer: 'rI', value: '0' },
      QualityOut: 2,
    })
  })
})

describe('network naming', () => {
  it('maps all three Joey networks', () => {
    expect(toGemNetwork({ chain: 'xrpl:0', networkId: 0, name: 'mainnet' })).toBe('Mainnet')
    expect(toGemNetwork({ chain: 'xrpl:1', networkId: 1, name: 'testnet' })).toBe('Testnet')
    expect(toGemNetwork({ chain: 'xrpl:2', networkId: 2, name: 'devnet' })).toBe('Devnet')
  })

  it('gives every chain a websocket endpoint and a description', () => {
    for (const chain of ['xrpl:0', 'xrpl:1', 'xrpl:2'] as const) {
      const network = { chain, networkId: 0, name: 'x' }
      expect(toGemWebsocket(network).startsWith('wss://')).toBe(true)
      expect(toGemNetworkDescription(network).length).toBeGreaterThan(0)
    }
  })
})
