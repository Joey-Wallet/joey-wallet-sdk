import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { bindConnectButton, createJoeySession, type JoeySessionState } from '../src/vanilla'
import {
  clearProviders,
  createMockProvider,
  installEventTargetShim,
  installProvider,
  removeEventTargetShim,
  type MockProvider,
} from './harness'

const ADDRESS = 'rLNaPoKeeBjZe2qs6x52yVPZpZ8td4dc6w'
const TESTNET = { chain: 'xrpl:1', networkId: 1, name: 'testnet' }

beforeAll(() => {
  installEventTargetShim()
})

afterAll(() => {
  removeEventTargetShim()
})

afterEach(() => {
  clearProviders()
})

/** A provider whose origin is already authorised. */
function connectedProvider(): MockProvider {
  const provider = createMockProvider()
  provider.respond('connect', () => ({
    accounts: [{ address: ADDRESS }],
    chain: 'xrpl:1',
    networkId: 1,
  }))
  provider.respond('getAccounts', () => [ADDRESS])
  provider.respond('getNetwork', () => TESTNET)
  provider.respond('disconnect', () => undefined)
  return provider
}

/** A provider that has never granted this origin anything. */
function unauthorisedProvider(): MockProvider {
  const provider = createMockProvider()
  provider.respond('connect', (params) => {
    if ((params as { silent?: boolean }).silent === true) {
      return { accounts: [], chain: null, networkId: null }
    }
    return { accounts: [{ address: ADDRESS }], chain: 'xrpl:1', networkId: 1 }
  })
  provider.respond('getAccounts', () => [])
  provider.respond('getNetwork', () => TESTNET)
  return provider
}

describe('createJoeySession', () => {
  it('is ready synchronously when the provider is already injected', () => {
    installProvider(connectedProvider())
    const session = createJoeySession({ autoConnect: false })
    expect(session.getState().isReady).toBe(true)
    expect(session.getState().isAvailable).toBe(true)
    session.destroy()
  })

  it('reports absence without throwing', () => {
    const session = createJoeySession({ autoConnect: false, detectTimeoutMs: 10 })
    expect(session.getState().isAvailable).toBe(false)
    expect(session.getState().account).toBeNull()
    session.destroy()
  })

  it('silently reconnects an already-authorised origin', async () => {
    installProvider(connectedProvider())
    const session = createJoeySession()
    await vi.waitFor(() => {
      expect(session.getState().account).toBe(ADDRESS)
      expect(session.getState().network).toEqual(TESTNET)
    })
    session.destroy()
  })

  it('a silent connect that returns nothing leaves the session usable', async () => {
    const provider = unauthorisedProvider()
    installProvider(provider)

    const session = createJoeySession()
    await vi.waitFor(() => {
      expect(session.getState().isReady).toBe(true)
    })
    expect(session.getState().account).toBeNull()

    await expect(session.connect()).resolves.toBe(ADDRESS)
    expect(session.getState().account).toBe(ADDRESS)
    session.destroy()
  })

  it('surfaces a rejection through state.error and by rejecting', async () => {
    const provider = createMockProvider()
    provider.respond('connect', () => {
      throw { code: 4001, message: 'The request was rejected by the user.' }
    })
    provider.respond('getAccounts', () => [])
    provider.respond('getNetwork', () => TESTNET)
    installProvider(provider)

    const session = createJoeySession({ autoConnect: false })
    await expect(session.connect()).rejects.toMatchObject({ code: 4001 })
    expect(session.getState().error?.code).toBe(4001)
    expect(session.getState().isConnecting).toBe(false)
    session.destroy()
  })

  it('connect rejects with 4900 when nothing is installed', async () => {
    const session = createJoeySession({ autoConnect: false, detectTimeoutMs: 10 })
    await expect(session.connect()).rejects.toMatchObject({ code: 4900 })
    session.destroy()
  })

  it('notifies subscribers immediately and on every change', async () => {
    const provider = connectedProvider()
    installProvider(provider)
    const session = createJoeySession({ autoConnect: false })

    const seen: JoeySessionState[] = []
    const unsubscribe = session.subscribe((state) => seen.push(state))
    expect(seen).toHaveLength(1)

    await vi.waitFor(() => {
      expect(session.getState().account).toBe(ADDRESS)
    })
    provider.emit('networkChanged', { chain: 'xrpl:0', networkId: 0, name: 'mainnet' })
    expect(session.getState().network?.name).toBe('mainnet')

    unsubscribe()
    const before = seen.length
    provider.emit('accountsChanged', { accounts: [] })
    expect(seen).toHaveLength(before)
    session.destroy()
  })

  it('tracks wallet-side account and disconnect events', async () => {
    const provider = connectedProvider()
    installProvider(provider)
    const session = createJoeySession()
    await vi.waitFor(() => {
      expect(session.getState().account).toBe(ADDRESS)
    })

    provider.emit('accountsChanged', { accounts: ['rOther'] })
    expect(session.getState().account).toBe('rOther')

    provider.emit('disconnect', { reason: 'locked' })
    expect(session.getState().account).toBeNull()
    expect(session.getState().accounts).toEqual([])
    session.destroy()
  })

  it('destroy detaches every provider listener', async () => {
    const provider = connectedProvider()
    installProvider(provider)
    const session = createJoeySession()
    await vi.waitFor(() => {
      expect(provider.listenerCount('accountsChanged')).toBe(1)
    })

    session.destroy()
    expect(provider.listenerCount('accountsChanged')).toBe(0)
    expect(provider.listenerCount('networkChanged')).toBe(0)
  })

  it('disconnect clears the account', async () => {
    installProvider(connectedProvider())
    const session = createJoeySession()
    await vi.waitFor(() => {
      expect(session.getState().account).toBe(ADDRESS)
    })

    await session.disconnect()
    expect(session.getState().account).toBeNull()
    session.destroy()
  })

  it('disconnect with no provider is a no-op', async () => {
    const session = createJoeySession({ autoConnect: false, detectTimeoutMs: 10 })
    await expect(session.disconnect()).resolves.toBeUndefined()
    session.destroy()
  })
})

/** Just enough of a `<button>` for `bindConnectButton`, without jsdom. */
function fakeButton(): HTMLButtonElement & { click(): void } {
  const handlers = new Set<() => void>()
  return {
    disabled: false,
    textContent: '',
    addEventListener: (_event: string, handler: () => void) => handlers.add(handler),
    removeEventListener: (_event: string, handler: () => void) => handlers.delete(handler),
    click: () => {
      for (const handler of handlers) handler()
    },
  } as unknown as HTMLButtonElement & { click(): void }
}

describe('bindConnectButton', () => {
  it('offers the install path when no wallet is present', async () => {
    const session = createJoeySession({ autoConnect: false, detectTimeoutMs: 5 })
    const button = fakeButton()
    const unbind = bindConnectButton(button, session)

    expect(button.disabled).toBe(true)
    await vi.waitFor(() => {
      expect(button.textContent).toBe('Install Joey')
    })

    unbind()
    session.destroy()
  })

  it('connects on click and then shows the truncated address', async () => {
    installProvider(unauthorisedProvider())
    const session = createJoeySession({ autoConnect: false })
    const button = fakeButton()
    const unbind = bindConnectButton(button, session)

    expect(button.textContent).toBe('Connect Joey')
    button.click()
    await vi.waitFor(() => {
      expect(button.textContent).toContain('…')
    })

    unbind()
    button.click()
    session.destroy()
  })

  it('reports a rejection through onError', async () => {
    const provider = createMockProvider()
    provider.respond('connect', () => {
      throw { code: 4001, message: 'The request was rejected by the user.' }
    })
    provider.respond('getAccounts', () => [])
    provider.respond('getNetwork', () => TESTNET)
    installProvider(provider)

    const onError = vi.fn()
    const session = createJoeySession({ autoConnect: false })
    const button = fakeButton()
    const unbind = bindConnectButton(button, session, { onError })

    button.click()
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 4001 }))
    })

    unbind()
    session.destroy()
  })
})
