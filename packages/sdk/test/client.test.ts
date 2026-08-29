import { describe, expect, it, vi } from 'vitest'

import { createJoeyClient, readAccounts, readNetwork } from '../src/client'
import { JOEY_ERROR_CODES, JoeyRpcError } from '../src/errors'
import { createMockProvider, type MockProvider } from './harness'

const ADDRESS = 'rLNaPoKeeBjZe2qs6x52yVPZpZ8td4dc6w'
const PUBLIC_KEY = 'ED9434799226374926EDA3B54B1B461B4ABF7237962EAE18528FEA67595397FA32'
const MAINNET = { chain: 'xrpl:0', networkId: 0, name: 'mainnet' }

function wired(
  options?: Parameters<typeof createMockProvider>[0],
): { provider: MockProvider; joey: ReturnType<typeof createJoeyClient> } {
  const provider = createMockProvider(options)
  return { provider, joey: createJoeyClient(provider) }
}

describe('connect', () => {
  it('sends the wallet an object even with no arguments', async () => {
    const { provider, joey } = wired()
    provider.respond('connect', () => ({
      accounts: [{ address: ADDRESS, publicKey: PUBLIC_KEY }],
      chain: 'xrpl:0',
      networkId: 0,
    }))

    await expect(joey.connect()).resolves.toEqual({
      accounts: [{ address: ADDRESS, publicKey: PUBLIC_KEY }],
      chain: 'xrpl:0',
      networkId: 0,
    })
    expect(provider.lastCall()).toEqual({ method: 'connect', params: {} })
  })

  it('forwards chain and silent', async () => {
    const { provider, joey } = wired()
    provider.respond('connect', () => ({ accounts: [], chain: null, networkId: null }))

    await joey.connect({ chain: 'xrpl:1', silent: true })
    expect(provider.lastCall()?.params).toEqual({ chain: 'xrpl:1', silent: true })
  })

  it('a silent connect with no grant resolves empty rather than throwing', async () => {
    const { provider, joey } = wired()
    provider.respond('connect', () => ({ accounts: [], chain: null, networkId: null }))

    const result = await joey.connect({ silent: true })
    expect(result.accounts).toEqual([])
    expect(result.chain).toBeNull()
  })

  it('derives networkId from the chain when the wallet omits it', async () => {
    const { provider, joey } = wired()
    provider.respond('connect', () => ({ accounts: [{ address: ADDRESS }], chain: 'xrpl:2' }))
    await expect(joey.connect()).resolves.toMatchObject({ chain: 'xrpl:2', networkId: 2 })
  })

  it('accepts bare address strings from the wallet', async () => {
    const { provider, joey } = wired()
    provider.respond('connect', () => ({ accounts: [ADDRESS], chain: 'xrpl:0' }))
    await expect(joey.connect()).resolves.toMatchObject({ accounts: [{ address: ADDRESS }] })
  })
})

describe('accounts and network', () => {
  it('getAccounts collapses whatever the wallet sends to addresses', async () => {
    const { provider, joey } = wired()
    provider.respond('getAccounts', () => [ADDRESS])
    await expect(joey.getAccounts()).resolves.toEqual([ADDRESS])

    provider.respond('getAccounts', () => ({ accounts: [{ address: ADDRESS }] }))
    await expect(joey.getAccounts()).resolves.toEqual([ADDRESS])
  })

  it('getAccounts answers [] for an origin with no grant', async () => {
    const { provider, joey } = wired()
    provider.respond('getAccounts', () => [])
    await expect(joey.getAccounts()).resolves.toEqual([])
  })

  it('getNetwork returns the chain triple', async () => {
    const { provider, joey } = wired()
    provider.respond('getNetwork', () => MAINNET)
    await expect(joey.getNetwork()).resolves.toEqual(MAINNET)
  })

  it('getNetwork rejects with 4902 for a chain the SDK does not know', async () => {
    const { provider, joey } = wired()
    provider.respond('getNetwork', () => ({ chain: 'xrpl:21337', networkId: 21337 }))
    await expect(joey.getNetwork()).rejects.toMatchObject({
      code: JOEY_ERROR_CODES.UNRECOGNIZED_CHAIN,
    })
  })

  it('exposes the provider snapshot synchronously', () => {
    const { provider, joey } = wired()
    expect(joey.isConnected()).toBe(false)
    provider.setAccounts([ADDRESS])
    expect(joey.accounts).toEqual([ADDRESS])
    expect(joey.isConnected()).toBe(true)
  })

  it('disconnect sends an empty params object', async () => {
    const { provider, joey } = wired()
    provider.respond('disconnect', () => undefined)
    await expect(joey.disconnect()).resolves.toBeUndefined()
    expect(provider.lastCall()).toEqual({ method: 'disconnect', params: {} })
  })
})

describe('signing', () => {
  it('signTransaction forwards tx_json untouched', async () => {
    const { provider, joey } = wired()
    provider.respond('signTransaction', () => ({
      tx_json: { TransactionType: 'Payment' },
      tx_blob: '1200002280000000',
      hash: 'ABC',
    }))

    const tx_json = {
      TransactionType: 'Payment',
      Account: ADDRESS,
      Destination: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe',
      Amount: '1000000',
    }
    await expect(joey.signTransaction({ tx_json })).resolves.toMatchObject({ hash: 'ABC' })
    expect(provider.lastCall()).toEqual({ method: 'signTransaction', params: { tx_json } })
  })

  it('passes autofill through when the caller sets it', async () => {
    const { provider, joey } = wired()
    provider.respond('signTransaction', () => ({ tx_json: {}, tx_blob: '', hash: '' }))
    await joey.signTransaction({ tx_json: { TransactionType: 'Payment' }, autofill: false })
    expect(provider.lastCall()?.params).toMatchObject({ autofill: false })
  })

  it('signAndSubmitTransaction reports the engine result', async () => {
    const { provider, joey } = wired()
    provider.respond('signAndSubmitTransaction', () => ({
      tx_json: {},
      tx_blob: '12000',
      hash: 'DEADBEEF',
      engine_result: 'tesSUCCESS',
      engine_result_message: 'The transaction was applied.',
    }))

    await expect(
      joey.signAndSubmitTransaction({ tx_json: { TransactionType: 'Payment' } }),
    ).resolves.toMatchObject({ hash: 'DEADBEEF', engine_result: 'tesSUCCESS' })
  })

  it('signTransactionFor carries tx_signer separately from the transaction Account', async () => {
    const { provider, joey } = wired()
    provider.respond('signTransactionFor', () => ({ tx_json: {}, tx_blob: '12000', hash: 'H' }))

    await joey.signTransactionFor({
      tx_signer: ADDRESS,
      tx_json: { TransactionType: 'Payment', Account: 'rMultisigAccount' },
    })

    expect(provider.lastCall()?.params).toEqual({
      tx_signer: ADDRESS,
      tx_json: { TransactionType: 'Payment', Account: 'rMultisigAccount' },
    })
  })

  /**
   * What the client does with a bulk answer, NOT what the wallet answers.
   *
   * This case used to be titled "signTransactionBulk resolves one result per
   * transaction", which reads as a statement about Joey and is not one: in
   * production the method returns `-32602` to every caller, because the
   * provider sends `tx_list` and the background reads `tx_json_list`. The mock
   * agreed with the SDK because the mock is the SDK's own beliefs with a
   * `respond()` on the front.
   *
   * The behaviour of the real wallet is asserted in
   * `apps/extension/test/contract/sdkWire.test.ts`, against the real
   * `handleDappRequest`, and that file records the gap as Phase 2 work. What is
   * left here is the honest scope: given an array, the client hands it back
   * untouched and forwards `submit` verbatim.
   */
  it('passes a bulk result through untouched and forwards submit', async () => {
    const { provider, joey } = wired()
    provider.respond('signTransactionBulk', () => [
      { tx_json: {}, tx_blob: 'a', hash: 'H1' },
      { tx_json: {}, tx_blob: 'b', hash: 'H2' },
    ])

    const results = await joey.signTransactionBulk({
      tx_list: [
        { tx_json: { TransactionType: 'TrustSet' } },
        { tx_json: { TransactionType: 'Payment' } },
      ],
      submit: true,
    })

    expect(results.map((entry) => entry.hash)).toEqual(['H1', 'H2'])
    expect(provider.lastCall()?.params).toMatchObject({ submit: true })
  })

  it('signIn defaults to no explicit mode, letting the wallet pick CAIP-122', async () => {
    const { provider, joey } = wired()
    provider.respond('signIn', () => ({
      address: ADDRESS,
      publicKey: PUBLIC_KEY,
      signature: '30',
      message: 'example.com wants you to sign in…',
    }))

    await joey.signIn()
    expect(provider.lastCall()?.params).toEqual({})

    await joey.signIn({
      mode: 'caip122',
      statement: 'Sign in',
      resources: ['https://example.com/api'],
    })
    expect(provider.lastCall()?.params).toEqual({
      mode: 'caip122',
      statement: 'Sign in',
      resources: ['https://example.com/api'],
    })
  })
})

describe('transport preference', () => {
  it('prefers the provider typed method, which is what keeps its state fresh', async () => {
    const { provider, joey } = wired({ typedMethods: true })
    const spy = vi.spyOn(provider, 'request')
    provider.respond('getAccounts', () => [])

    await joey.getAccounts()
    expect(spy).not.toHaveBeenCalled()
    expect(provider.callsTo('getAccounts')).toHaveLength(1)
  })

  it('falls back to request() for a provider without the typed method', async () => {
    const { provider, joey } = wired({ typedMethods: false })
    const spy = vi.spyOn(provider, 'request')
    provider.respond('getAccounts', () => [])

    await joey.getAccounts()
    expect(spy).toHaveBeenCalledWith({ method: 'getAccounts', params: {} })
  })
})

describe('errors', () => {
  it('normalises a plain rejected object into JoeyRpcError', async () => {
    const { provider, joey } = wired()
    provider.respond('signTransaction', () => {
      throw { code: JOEY_ERROR_CODES.USER_REJECTED, message: 'The request was rejected by the user.' }
    })

    const error = await joey
      .signTransaction({ tx_json: { TransactionType: 'Payment' } })
      .catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(JoeyRpcError)
    expect((error as JoeyRpcError).code).toBe(4001)
    expect((error as JoeyRpcError).message).toContain('rejected')
  })

  it('reports an unknown method as 4200', async () => {
    const { joey } = wired({ typedMethods: false })
    await expect(joey.request({ method: 'somethingNew' })).rejects.toMatchObject({
      code: JOEY_ERROR_CODES.UNSUPPORTED_METHOD,
    })
  })

  it('keeps the data field', async () => {
    const { provider, joey } = wired()
    provider.respond('getNetwork', () => {
      throw { code: 4902, message: 'Unrecognised chain', data: { chain: 'xrpl:99' } }
    })
    await expect(joey.getNetwork()).rejects.toMatchObject({
      code: 4902,
      data: { chain: 'xrpl:99' },
    })
  })
})

describe('events', () => {
  it('normalises accountsChanged into account objects', () => {
    const { provider, joey } = wired()
    const listener = vi.fn()

    const off = joey.on('accountsChanged', listener)
    provider.emit('accountsChanged', { accounts: [{ address: ADDRESS, publicKey: PUBLIC_KEY }] })
    expect(listener).toHaveBeenCalledWith([{ address: ADDRESS, publicKey: PUBLIC_KEY }])

    provider.emit('accountsChanged', { accounts: [] })
    expect(listener).toHaveBeenLastCalledWith([])

    off()
    provider.emit('accountsChanged', { accounts: [ADDRESS] })
    expect(listener).toHaveBeenCalledTimes(2)
    expect(provider.listenerCount('accountsChanged')).toBe(0)
  })

  it('normalises networkChanged, and reports null for an unknown chain', () => {
    const { provider, joey } = wired()
    const listener = vi.fn()
    joey.on('networkChanged', listener)

    provider.emit('networkChanged', { chain: 'xrpl:1' })
    expect(listener).toHaveBeenCalledWith({ chain: 'xrpl:1', networkId: 1, name: 'xrpl:1' })

    provider.emit('networkChanged', { chain: 'solana:1' })
    expect(listener).toHaveBeenLastCalledWith(null)
  })

  it('normalises connect and disconnect', () => {
    const { provider, joey } = wired()
    const onConnect = vi.fn()
    const onDisconnect = vi.fn()
    joey.on('connect', onConnect)
    joey.on('disconnect', onDisconnect)

    provider.emit('connect', { accounts: [ADDRESS], chain: 'xrpl:0' })
    expect(onConnect).toHaveBeenCalledWith({ accounts: [{ address: ADDRESS }], chain: 'xrpl:0' })

    provider.emit('disconnect', { reason: 'locked' })
    expect(onDisconnect).toHaveBeenCalledWith({ reason: 'locked' })

    provider.emit('disconnect', undefined)
    expect(onDisconnect).toHaveBeenLastCalledWith({})
  })

  it('unsubscribes through off(event, listener)', () => {
    const { provider, joey } = wired()
    const listener = vi.fn()
    joey.on('networkChanged', listener)
    joey.off('networkChanged', listener)
    provider.emit('networkChanged', { chain: 'xrpl:0' })
    expect(listener).not.toHaveBeenCalled()
  })

  /**
   * The same listener, registered twice.
   *
   * Unsubscribers used to be kept in a `Map` keyed by the caller's function, so
   * the second `on()` overwrote the first entry: one subscription became
   * unreachable, kept firing after `off()`, and no call the dapp could make
   * would ever remove it. A React effect that re-subscribes on a dependency
   * change and unsubscribes on cleanup does exactly this on every render, so
   * the leak compounds — and `react.ts` registers four listeners in one effect.
   */
  describe('a listener registered more than once', () => {
    it('fires once per registration and needs one off() each', () => {
      const { provider, joey } = wired()
      const listener = vi.fn()

      joey.on('disconnect', listener)
      joey.on('disconnect', listener)
      expect(provider.listenerCount('disconnect')).toBe(2)

      joey.off('disconnect', listener)
      provider.emit('disconnect', {})
      expect(listener).toHaveBeenCalledTimes(1)

      joey.off('disconnect', listener)
      provider.emit('disconnect', {})
      expect(listener).toHaveBeenCalledTimes(1)
      expect(provider.listenerCount('disconnect')).toBe(0)
    })

    it('gives each registration its own unsubscribe function', () => {
      const { provider, joey } = wired()
      const listener = vi.fn()

      const offFirst = joey.on('disconnect', listener)
      joey.on('disconnect', listener)

      offFirst()
      // Idempotent: calling it again must not take the sibling down with it.
      offFirst()
      expect(provider.listenerCount('disconnect')).toBe(1)

      provider.emit('disconnect', {})
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('leaves nothing behind once every registration is released', () => {
      const { provider, joey } = wired()
      const listener = vi.fn()
      const offs = [joey.on('accountsChanged', listener), joey.on('accountsChanged', listener)]
      for (const off of offs) off()
      expect(provider.listenerCount('accountsChanged')).toBe(0)
    })
  })

  it('falls back to removeListener when on() returns nothing', () => {
    const { provider, joey } = wired({ onReturnsUnsubscribe: false })
    const listener = vi.fn()

    const off = joey.on('disconnect', listener)
    off()
    provider.emit('disconnect', { reason: 'locked' })
    expect(listener).not.toHaveBeenCalled()
  })

  it('off for a listener that was never registered is a no-op', () => {
    const { joey } = wired()
    expect(() => joey.off('connect', vi.fn())).not.toThrow()
  })
})

describe('escape hatch', () => {
  it('request forwards an arbitrary method', async () => {
    const { provider, joey } = wired()
    provider.respond('futureMethod', (params) => ({ echoed: params }))
    await expect(joey.request({ method: 'futureMethod', params: { a: 1 } })).resolves.toEqual({
      echoed: { a: 1 },
    })
  })

  it('exposes the raw provider and its identity', () => {
    const { provider, joey } = wired()
    expect(joey.provider).toBe(provider)
    expect(joey.rdns).toBe('xyz.joeywallet')
    expect(joey.version).toBe('1.0.0-test')
  })
})

describe('normalisers', () => {
  it('readAccounts tolerates junk', () => {
    expect(readAccounts(undefined)).toEqual([])
    expect(readAccounts({ accounts: 'nope' })).toEqual([])
    expect(readAccounts([{ notAnAddress: true }, 42, null])).toEqual([])
    expect(readAccounts([{ address: ADDRESS, label: 'Main' }])).toEqual([
      { address: ADDRESS, label: 'Main' },
    ])
  })

  it('readNetwork keeps a wallet-supplied name and networkId', () => {
    expect(readNetwork({ chain: 'xrpl:1', networkId: 1, name: 'testnet' })).toEqual({
      chain: 'xrpl:1',
      networkId: 1,
      name: 'testnet',
    })
    expect(readNetwork('xrpl:0')).toEqual({ chain: 'xrpl:0', networkId: 0, name: 'xrpl:0' })
    expect(readNetwork(null)).toBeNull()
  })
})
