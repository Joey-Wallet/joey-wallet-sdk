/**
 * `@joeywallet/wallet-sdk/vanilla`.
 *
 * A connection session with a subscribe/getState store, for pages that have no
 * framework. It holds the two pieces of state every dapp ends up re-writing by
 * hand — the connected account and the current network — and keeps them correct
 * when the user switches account or network in the wallet.
 */
import type { Joey } from './client.js'
import { getJoey, waitForJoey } from './detect.js'
import { JOEY_ERROR_CODES, JoeyRpcError } from './errors.js'
import type { ConnectParams, JoeyNetwork } from './types.js'

export interface JoeySessionState {
  /** `null` while detection is still running, and if it never finds a provider. */
  joey: Joey | null
  isAvailable: boolean
  isReady: boolean
  isConnecting: boolean
  accounts: string[]
  /** The first granted address. `null` when this origin has no grant. */
  account: string | null
  network: JoeyNetwork | null
  error: JoeyRpcError | null
}

export interface JoeySession {
  getState(): JoeySessionState
  /** Called immediately with the current state, then on every change. */
  subscribe(listener: (state: JoeySessionState) => void): () => void
  connect(params?: ConnectParams): Promise<string | null>
  disconnect(): Promise<void>
  /** Removes every listener this session registered. */
  destroy(): void
}

export interface CreateJoeySessionOptions {
  /** Try a silent reconnect once the provider is found. Default true. */
  autoConnect?: boolean
  /** How long to wait for a late-injected provider. Default 3000ms. */
  detectTimeoutMs?: number
}

export function createJoeySession(options: CreateJoeySessionOptions = {}): JoeySession {
  const { autoConnect = true, detectTimeoutMs = 3000 } = options

  const initial = getJoey()
  let state: JoeySessionState = {
    joey: initial,
    isAvailable: initial !== null,
    isReady: initial !== null,
    isConnecting: false,
    accounts: [],
    account: null,
    network: null,
    error: null,
  }

  const listeners = new Set<(state: JoeySessionState) => void>()
  const teardown: Array<() => void> = []
  let destroyed = false

  const set = (patch: Partial<JoeySessionState>): void => {
    const next = { ...state, ...patch }
    // `account` is always derived, never set directly, so the two can't drift.
    next.account = next.accounts[0] ?? null
    state = next
    for (const listener of listeners) listener(state)
  }

  const attach = (joey: Joey): void => {
    teardown.push(
      joey.on('accountsChanged', (accounts) =>
        set({ accounts: accounts.map((account) => account.address) }),
      ),
    )
    teardown.push(joey.on('networkChanged', (network) => set({ network })))
    teardown.push(
      joey.on('connect', (result) =>
        set({ accounts: result.accounts.map((account) => account.address) }),
      ),
    )
    teardown.push(joey.on('disconnect', () => set({ accounts: [] })))
  }

  const hydrate = async (joey: Joey): Promise<void> => {
    const [accounts, network] = await Promise.all([
      joey.getAccounts().catch(() => [] as string[]),
      joey.getNetwork().catch(() => null),
    ])
    if (!destroyed) set({ accounts, network })
  }

  const adopt = async (joey: Joey): Promise<void> => {
    if (destroyed) return
    set({ joey, isAvailable: true, isReady: true })
    attach(joey)
    if (autoConnect) {
      try {
        const result = await joey.connect({ silent: true })
        if (destroyed) return
        if (result.accounts.length > 0) {
          set({ accounts: result.accounts.map((account) => account.address) })
          const network = await joey.getNetwork().catch(() => null)
          if (!destroyed) set({ network })
          return
        }
      } catch {
        // Not yet authorised. Expected on a first visit.
      }
    }
    await hydrate(joey)
  }

  if (initial !== null) {
    void adopt(initial)
  } else {
    void waitForJoey({ timeoutMs: detectTimeoutMs })
      .then(adopt)
      .catch(() => {
        if (!destroyed) set({ isReady: true })
      })
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    },

    async connect(params) {
      const joey = state.joey ?? getJoey()
      if (joey === null) {
        const error = new JoeyRpcError(
          JOEY_ERROR_CODES.DISCONNECTED,
          'Joey Wallet is not installed, or its provider has not been injected into this page.',
        )
        set({ error })
        throw error
      }
      set({ isConnecting: true, error: null })
      try {
        const result = await joey.connect(params)
        const accounts = result.accounts.map((account) => account.address)
        const network = await joey.getNetwork().catch(() => state.network)
        set({ accounts, network, isConnecting: false })
        return accounts[0] ?? null
      } catch (cause) {
        const error = JoeyRpcError.from(cause)
        set({ isConnecting: false, error })
        throw error
      }
    },

    async disconnect() {
      const joey = state.joey
      if (joey === null) return
      await joey.disconnect()
      set({ accounts: [] })
    },

    destroy() {
      destroyed = true
      for (const off of teardown.splice(0)) off()
      listeners.clear()
    },
  }
}

export interface BindConnectButtonOptions {
  /** Text while disconnected. Default "Connect Joey". */
  connectLabel?: string
  /** Rendered with the connected address. Default is a truncated address. */
  connectedLabel?(address: string): string
  /** Text when no provider was found. Default "Install Joey". */
  notInstalledLabel?: string
  /** Where to send a user with no wallet. Opened in a new tab when clicked. */
  installUrl?: string
  onError?(error: JoeyRpcError): void
}

/**
 * Wire a `<button>` to a session: label, disabled state and click handler.
 *
 * The whole point of the vanilla entry point — this is the twenty lines every
 * script-tag dapp writes, and gets subtly wrong around the not-installed case.
 */
export function bindConnectButton(
  button: HTMLButtonElement,
  session: JoeySession,
  options: BindConnectButtonOptions = {},
): () => void {
  const {
    connectLabel = 'Connect Joey',
    connectedLabel = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`,
    notInstalledLabel = 'Install Joey',
    installUrl,
    onError,
  } = options

  const render = (state: JoeySessionState): void => {
    if (!state.isReady) {
      button.disabled = true
      button.textContent = connectLabel
      return
    }
    if (!state.isAvailable) {
      button.disabled = installUrl === undefined
      button.textContent = notInstalledLabel
      return
    }
    button.disabled = state.isConnecting
    button.textContent = state.account !== null ? connectedLabel(state.account) : connectLabel
  }

  const onClick = (): void => {
    const state = session.getState()
    if (!state.isAvailable) {
      if (installUrl !== undefined) window.open(installUrl, '_blank', 'noopener,noreferrer')
      return
    }
    // `session.connect` already stored the error in state; this catch only
    // exists so the rejection is not unhandled.
    void session.connect().catch((error: unknown) => {
      onError?.(JoeyRpcError.from(error))
    })
  }

  button.addEventListener('click', onClick)
  const unsubscribe = session.subscribe(render)

  return () => {
    button.removeEventListener('click', onClick)
    unsubscribe()
  }
}
