import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  GemWalletUnsupportedError,
  getAddress,
  getNetwork,
  getPublicKey,
  isInstalled,
  on,
  sendPayment,
  setAccount,
  setHook,
  setRegularKey,
  setTrustline,
  signMessage,
  signTransaction,
  submitBulkTransactions,
  submitTransaction,
} from '../src/index'
import {
  clearProviders,
  createMockProvider,
  installEventTargetShim,
  installProvider,
  removeEventTargetShim,
  type MockProvider,
} from './harness'

const ADDRESS = 'rLNaPoKeeBjZe2qs6x52yVPZpZ8td4dc6w'
const PUBLIC_KEY = 'ED9434799226374926EDA3B54B1B461B4ABF7237962EAE18528FEA67595397FA32'
const MAINNET = { chain: 'xrpl:0', networkId: 0, name: 'mainnet' }
const ACCOUNT = { address: ADDRESS, publicKey: PUBLIC_KEY }

let provider: MockProvider

beforeAll(() => {
  installEventTargetShim()
})

afterAll(() => {
  removeEventTargetShim()
})

beforeEach(() => {
  provider = createMockProvider()
  provider.respond('connect', () => ({ accounts: [ACCOUNT], chain: 'xrpl:0', networkId: 0 }))
  provider.respond('getAccounts', () => [ADDRESS])
  provider.respond('getNetwork', () => MAINNET)
  installProvider(provider)
})

afterEach(() => {
  clearProviders()
})

describe('isInstalled', () => {
  it('answers true immediately when the provider is present', async () => {
    await expect(isInstalled()).resolves.toEqual({ result: { isInstalled: true } })
  })

  it('resolves false rather than rejecting when there is no wallet', async () => {
    clearProviders()
    await expect(isInstalled()).resolves.toEqual({ result: { isInstalled: false } })
  })
})

describe('account queries', () => {
  it('getAddress returns the GemWallet envelope', async () => {
    await expect(getAddress()).resolves.toEqual({
      type: 'response',
      result: { address: ADDRESS },
    })
  })

  it('tries a silent connect first, so an authorised origin sees no prompt', async () => {
    await getAddress()
    expect(provider.callsTo('connect')).toEqual([{ method: 'connect', params: { silent: true } }])
  })

  it('prompts when the silent connect comes back empty', async () => {
    provider.respond('connect', (params) =>
      (params as { silent?: boolean }).silent === true
        ? { accounts: [], chain: null, networkId: null }
        : { accounts: [ACCOUNT], chain: 'xrpl:0', networkId: 0 },
    )

    await expect(getAddress()).resolves.toEqual({
      type: 'response',
      result: { address: ADDRESS },
    })
    expect(provider.callsTo('connect')).toHaveLength(2)
  })

  it('getPublicKey returns both fields', async () => {
    await expect(getPublicKey()).resolves.toEqual({
      type: 'response',
      result: { address: ADDRESS, publicKey: PUBLIC_KEY },
    })
  })

  it('getPublicKey throws for a watch-only account rather than returning empty', async () => {
    provider.respond('connect', () => ({
      accounts: [{ address: ADDRESS }],
      chain: 'xrpl:0',
      networkId: 0,
    }))
    await expect(getPublicKey()).rejects.toMatchObject({ code: 4100 })
  })

  it('getNetwork maps Joey chains onto GemWallet strings and endpoints', async () => {
    await expect(getNetwork()).resolves.toEqual({
      type: 'response',
      result: { chain: 'XRPL', network: 'Mainnet', websocket: 'wss://s1.ripple.com/' },
    })
  })

  it('getNetwork reports Testnet and Devnet too', async () => {
    provider.respond('getNetwork', () => ({ chain: 'xrpl:1', networkId: 1, name: 'testnet' }))
    await expect(getNetwork()).resolves.toMatchObject({
      result: { network: 'Testnet', websocket: 'wss://testnet.xrpl-labs.com/' },
    })
  })
})

describe('the reject envelope', () => {
  it('turns a 4001 into { type: reject } instead of throwing', async () => {
    provider.respond('connect', (params) => {
      if ((params as { silent?: boolean }).silent === true) {
        return { accounts: [], chain: null, networkId: null }
      }
      throw { code: 4001, message: 'The request was rejected by the user.' }
    })
    await expect(getAddress()).resolves.toEqual({ type: 'reject', result: undefined })
  })

  it('rethrows every other failure, as GemWallet does', async () => {
    provider.respond('getNetwork', () => {
      throw { code: 4300, message: 'The wallet is locked.' }
    })
    await expect(getNetwork()).rejects.toMatchObject({ code: 4300 })
  })
})

describe('sendPayment', () => {
  it('converts the GemWallet payload into XRPL Payment JSON', async () => {
    provider.respond('signAndSubmitTransaction', () => ({
      tx_json: {},
      tx_blob: '12000',
      hash: 'HASH',
    }))

    await expect(
      sendPayment({
        amount: '1000000',
        destination: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe',
        destinationTag: 42,
        fee: '12',
        memos: [{ memo: { memoData: '68690A', memoType: '746578742F706C61696E' } }],
        sourceTag: 7,
      }),
    ).resolves.toEqual({ type: 'response', result: { hash: 'HASH' } })

    expect(provider.lastCall()).toEqual({
      method: 'signAndSubmitTransaction',
      params: {
        tx_json: {
          TransactionType: 'Payment',
          Account: ADDRESS,
          Fee: '12',
          SourceTag: 7,
          Memos: [{ Memo: { MemoData: '68690A', MemoType: '746578742F706C61696E' } }],
          Amount: '1000000',
          Destination: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe',
          DestinationTag: 42,
        },
      },
    })
  })

  it('omits fields the caller did not set', async () => {
    provider.respond('signAndSubmitTransaction', () => ({
      tx_json: {},
      tx_blob: '12000',
      hash: 'HASH',
    }))
    await sendPayment({ amount: '1', destination: 'rDest' })

    const params = provider.lastCall()?.params as { tx_json: Record<string, unknown> }
    expect(Object.keys(params.tx_json).sort()).toEqual([
      'Account',
      'Amount',
      'Destination',
      'TransactionType',
    ])
  })

  it('carries an issued-currency amount through unchanged', async () => {
    provider.respond('signAndSubmitTransaction', () => ({
      tx_json: {},
      tx_blob: '12000',
      hash: 'HASH',
    }))
    const amount = { currency: 'USD', issuer: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B', value: '10' }
    await sendPayment({ amount, destination: 'rDest' })

    const params = provider.lastCall()?.params as { tx_json: Record<string, unknown> }
    expect(params.tx_json.Amount).toEqual(amount)
  })
})

describe('setTrustline', () => {
  it('builds a TrustSet', async () => {
    provider.respond('signAndSubmitTransaction', () => ({
      tx_json: {},
      tx_blob: '12014',
      hash: 'TRUST',
    }))

    await expect(
      setTrustline({
        limitAmount: { currency: 'USD', issuer: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B', value: '100' },
        qualityIn: 1,
      }),
    ).resolves.toEqual({ type: 'response', result: { hash: 'TRUST' } })

    expect(provider.lastCall()?.params).toMatchObject({
      tx_json: {
        TransactionType: 'TrustSet',
        Account: ADDRESS,
        QualityIn: 1,
        LimitAmount: { currency: 'USD', value: '100' },
      },
    })
  })
})

describe('signing and submitting', () => {
  it('signTransaction returns the signed blob under GemWallet name "signature"', async () => {
    provider.respond('signTransaction', () => ({
      tx_json: {},
      tx_blob: '120000228000',
      hash: 'HASH',
    }))

    await expect(
      signTransaction({ transaction: { TransactionType: 'Payment', Account: ADDRESS } }),
    ).resolves.toEqual({ type: 'response', result: { signature: '120000228000' } })
  })

  it('submitTransaction signs and submits', async () => {
    provider.respond('signAndSubmitTransaction', () => ({
      tx_json: {},
      tx_blob: '12000',
      hash: 'SUBMITTED',
    }))

    await expect(
      submitTransaction({ transaction: { TransactionType: 'Payment', Account: ADDRESS } }),
    ).resolves.toEqual({ type: 'response', result: { hash: 'SUBMITTED' } })
  })
})

describe('submitBulkTransactions', () => {
  it('moves ID out of the transaction and back onto the result by position', async () => {
    provider.respond('signTransactionBulk', () => [
      { tx_json: {}, tx_blob: 'a', hash: 'H1' },
      { tx_json: {}, tx_blob: 'b', hash: 'H2' },
    ])

    await expect(
      submitBulkTransactions({
        transactions: [
          { ID: 'one', TransactionType: 'Payment', Account: ADDRESS },
          { ID: 'two', TransactionType: 'Payment', Account: ADDRESS },
        ],
      }),
    ).resolves.toEqual({
      type: 'response',
      result: {
        transactions: [
          { id: 'one', accepted: true, hash: 'H1' },
          { id: 'two', accepted: true, hash: 'H2' },
        ],
      },
    })

    const params = provider.lastCall()?.params as {
      tx_list: Array<{ tx_json: Record<string, unknown> }>
      submit?: boolean
    }
    // `ID` is GemWallet's correlation key and would break XRPL serialisation.
    expect(params.tx_list[0]?.tx_json).not.toHaveProperty('ID')
    expect(params.submit).toBe(true)
  })

  it('marks the transactions an aborted batch never reached as not accepted', async () => {
    provider.respond('signTransactionBulk', () => [{ tx_json: {}, tx_blob: 'a', hash: 'H1' }])

    const result = await submitBulkTransactions({
      transactions: [
        { ID: 'one', TransactionType: 'Payment', Account: ADDRESS },
        { ID: 'two', TransactionType: 'Payment', Account: ADDRESS },
      ],
    })

    expect(result.result?.transactions).toEqual([
      { id: 'one', accepted: true, hash: 'H1' },
      { id: 'two', accepted: false },
    ])
  })

  it('handles a transaction with no ID', async () => {
    provider.respond('signTransactionBulk', () => [{ tx_json: {}, tx_blob: 'a', hash: 'H' }])

    const result = await submitBulkTransactions({
      transactions: [{ TransactionType: 'Payment', Account: ADDRESS }],
    })
    expect(result.result?.transactions[0]).toEqual({ accepted: true, hash: 'H' })
  })
})

describe('the methods Joey refuses to expose', () => {
  it.each([
    ['setRegularKey', setRegularKey],
    ['setHook', setHook],
    ['setAccount', setAccount],
  ])('%s throws synchronously', (name, fn) => {
    expect(() => (fn as () => unknown)()).toThrow(GemWalletUnsupportedError)
    try {
      ;(fn as () => unknown)()
    } catch (error) {
      expect((error as GemWalletUnsupportedError).method).toBe(name)
      expect((error as GemWalletUnsupportedError).code).toBe(4200)
      // The message must say what to do instead, not just "unsupported".
      expect((error as Error).message).toContain('Joey Wallet UI')
    }
  })

  it('signMessage explains that signIn is the replacement', () => {
    expect(() => signMessage('hello')).toThrow(GemWalletUnsupportedError)
    try {
      signMessage('hello')
    } catch (error) {
      expect((error as GemWalletUnsupportedError).method).toBe('signMessage')
      expect((error as Error).message).toContain('signIn()')
    }
  })

  it('rejects when awaited, so a call site that ignores the sync throw still fails', async () => {
    await expect((async () => setRegularKey())()).rejects.toBeInstanceOf(
      GemWalletUnsupportedError,
    )
  })
})

describe('on', () => {
  it('maps a Joey connect to a GemWallet login', () => {
    const callback = vi.fn()
    const off = on('login', callback)
    provider.emit('connect', { accounts: [ACCOUNT], chain: 'xrpl:0' })
    expect(callback).toHaveBeenCalledWith({ loggedIn: true })
    off()
  })

  it('accepts the raw wire constant as well as the short name', () => {
    const callback = vi.fn()
    const off = on('EVENT_LOGOUT', callback)
    provider.emit('disconnect', { reason: 'locked' })
    expect(callback).toHaveBeenCalledWith({ loggedIn: false })
    off()
  })

  it('shapes networkChanged like GemWallet does', () => {
    const callback = vi.fn()
    const off = on('networkChanged', callback)
    provider.emit('networkChanged', { chain: 'xrpl:1', networkId: 1, name: 'testnet' })
    expect(callback).toHaveBeenCalledWith({
      network: {
        name: 'Testnet',
        server: 'wss://testnet.xrpl-labs.com/',
        description: 'XRPL Testnet',
      },
    })
    off()
  })

  it('ignores a networkChanged for a chain the SDK does not recognise', () => {
    const callback = vi.fn()
    const off = on('networkChanged', callback)
    provider.emit('networkChanged', { chain: 'xrpl:21337' })
    expect(callback).not.toHaveBeenCalled()
    off()
  })

  it('shapes walletChanged like GemWallet does, including a revoked grant', () => {
    const callback = vi.fn()
    const off = on('walletChanged', callback)
    provider.emit('accountsChanged', { accounts: [ACCOUNT] })
    expect(callback).toHaveBeenCalledWith({ wallet: { publicAddress: ADDRESS } })

    provider.emit('accountsChanged', { accounts: [] })
    expect(callback).toHaveBeenLastCalledWith({ wallet: { publicAddress: '' } })
    off()
  })

  it('the returned function detaches the listener', () => {
    const callback = vi.fn()
    const off = on('login', callback)
    expect(provider.listenerCount('connect')).toBe(1)
    off()
    expect(provider.listenerCount('connect')).toBe(0)
    provider.emit('connect', { accounts: [ACCOUNT], chain: 'xrpl:0' })
    expect(callback).not.toHaveBeenCalled()
  })
})
