/**
 * `@joeywallet/wallet-sdk/react`.
 *
 * The hooks are shaped like react-query mutations — `{ mutate, mutateAsync,
 * isPending, error, data, reset }` — because that is the shape web3 developers
 * already have muscle memory for. They do not depend on react-query: a wallet
 * SDK that drags a cache library into every dapp is a tax on integration, and
 * none of react-query's real features (caching, invalidation, retries) apply to
 * a call whose side effect is a human clicking Approve.
 *
 * `react` is an optional peer dependency. Nothing in the core entry point
 * imports this file.
 */
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import type { Joey } from './client.js'
import { getJoey, waitForJoey } from './detect.js'
import { JOEY_ERROR_CODES, JoeyRpcError } from './errors.js'
import {
  initialMutationState,
  mutationReducer,
  toPublicState,
  type MutationState,
} from './mutation.js'
import type {
  AnyTransaction,
  ConnectParams,
  ConnectResult,
  JoeyNetwork,
  SignAndSubmitTransactionResult,
  SignInParams,
  SignInResult,
  SignTransactionBulkParams,
  SignTransactionForParams,
  SignTransactionParams,
  SignTransactionResult,
  TransactionLike,
} from './types.js'

function notInstalled(): JoeyRpcError {
  return new JoeyRpcError(
    JOEY_ERROR_CODES.DISCONNECTED,
    'Joey Wallet is not installed, or its provider has not been injected into this page.',
  )
}

/* ------------------------------------------------------------------ context */

export interface JoeyContextValue {
  /** `null` until the provider is found, and forever if it never appears. */
  joey: Joey | null
  isAvailable: boolean
  /** True once detection has finished, whether or not it found anything. */
  isReady: boolean
  /** Every address granted to this origin. */
  accounts: string[]
  /** The first granted address, which is what most dapps mean by "the account". */
  account: string | null
  network: JoeyNetwork | null
  isConnected: boolean
  connect(params?: ConnectParams): Promise<ConnectResult>
  disconnect(): Promise<void>
  /** Re-read the accounts and network from the wallet. */
  refresh(): Promise<void>
}

const JoeyContext = createContext<JoeyContextValue | null>(null)

export interface JoeyProviderProps {
  children?: ReactNode
  /**
   * Attempt a silent reconnect on mount. Only returns accounts the user already
   * granted this origin, so it never opens an approval window.
   */
  autoConnect?: boolean
  /** How long to wait for a late-injected provider. Default 3000ms. */
  detectTimeoutMs?: number
}

export function JoeyProvider(props: JoeyProviderProps): ReactNode {
  const { children, autoConnect = false, detectTimeoutMs = 3000 } = props

  // Seeded synchronously: when the provider is already on the page the first
  // render is already correct, and no dapp has to render a "detecting" state.
  const [joey, setJoey] = useState<Joey | null>(() => getJoey())
  const [isReady, setIsReady] = useState<boolean>(() => getJoey() !== null)
  const [accounts, setAccounts] = useState<string[]>([])
  const [network, setNetwork] = useState<JoeyNetwork | null>(null)

  useEffect(() => {
    if (joey !== null) return
    let cancelled = false
    const controller = new AbortController()
    waitForJoey({ timeoutMs: detectTimeoutMs, signal: controller.signal })
      .then((found) => {
        if (!cancelled) setJoey(found)
      })
      .catch(() => {
        /* absence is a state, not an error the dapp needs to handle here */
      })
      .finally(() => {
        if (!cancelled) setIsReady(true)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [joey, detectTimeoutMs])

  const refresh = useCallback(async (): Promise<void> => {
    if (joey === null) return
    const [nextAccounts, nextNetwork] = await Promise.all([
      joey.getAccounts().catch(() => [] as string[]),
      joey.getNetwork().catch(() => null),
    ])
    setAccounts(nextAccounts)
    setNetwork(nextNetwork)
  }, [joey])

  useEffect(() => {
    if (joey === null) return
    const offs = [
      joey.on('accountsChanged', (next) => setAccounts(next.map((a) => a.address))),
      joey.on('networkChanged', (next) => setNetwork(next)),
      joey.on('connect', (result) => setAccounts(result.accounts.map((a) => a.address))),
      joey.on('disconnect', () => setAccounts([])),
    ]
    return () => {
      for (const off of offs) off()
    }
  }, [joey])

  useEffect(() => {
    if (joey === null) return
    let cancelled = false

    const run = async (): Promise<void> => {
      if (autoConnect) {
        try {
          const result = await joey.connect({ silent: true })
          if (cancelled) return
          if (result.accounts.length > 0) {
            setAccounts(result.accounts.map((account) => account.address))
            const next = await joey.getNetwork().catch(() => null)
            if (!cancelled) setNetwork(next)
            return
          }
        } catch {
          // A silent connect is best-effort. Fall through to the plain refresh.
        }
      }
      if (!cancelled) await refresh()
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [joey, autoConnect, refresh])

  const connect = useCallback(
    async (params?: ConnectParams): Promise<ConnectResult> => {
      if (joey === null) throw notInstalled()
      const result = await joey.connect(params)
      setAccounts(result.accounts.map((account) => account.address))
      if (result.chain !== null) {
        setNetwork(await joey.getNetwork().catch(() => null))
      }
      return result
    },
    [joey],
  )

  const disconnect = useCallback(async (): Promise<void> => {
    if (joey === null) return
    await joey.disconnect()
    setAccounts([])
  }, [joey])

  const value = useMemo<JoeyContextValue>(
    () => ({
      joey,
      isAvailable: joey !== null,
      isReady,
      accounts,
      account: accounts[0] ?? null,
      network,
      isConnected: accounts.length > 0,
      connect,
      disconnect,
      refresh,
    }),
    [joey, isReady, accounts, network, connect, disconnect, refresh],
  )

  return createElement(JoeyContext.Provider, { value }, children)
}

export function useJoey(): JoeyContextValue {
  const value = useContext(JoeyContext)
  if (value === null) {
    throw new Error('useJoey must be used inside a <JoeyProvider>.')
  }
  return value
}

/* ----------------------------------------------------------------- mutations */

export interface UseJoeyMutationOptions<TData, TVariables> {
  onSuccess?(data: TData, variables: TVariables): void
  onError?(error: JoeyRpcError, variables: TVariables): void
  onSettled?(data: TData | undefined, error: JoeyRpcError | undefined, variables: TVariables): void
}

export interface UseJoeyMutationResult<TData, TVariables>
  extends MutationState<TData, TVariables> {
  /** Fire and forget. Never rejects — read `error` instead. */
  mutate(variables: TVariables): void
  /** Resolves the result, or rejects with `JoeyRpcError`. */
  mutateAsync(variables: TVariables): Promise<TData>
  reset(): void
}

/**
 * Build a mutation hook over a Joey method.
 *
 * Exported so a dapp can wrap a method this SDK version does not model, using
 * `joey.request()`, and still get the same `{ mutate, isPending, error }` shape
 * as the built-in hooks.
 */
export function useJoeyMutation<TData, TVariables>(
  run: (joey: Joey, variables: TVariables) => Promise<TData>,
  options: UseJoeyMutationOptions<TData, TVariables> = {},
): UseJoeyMutationResult<TData, TVariables> {
  const { joey } = useJoey()
  const [state, dispatch] = useReducer(
    mutationReducer<TData, TVariables>,
    undefined,
    initialMutationState<TData, TVariables>,
  )

  const runIdRef = useRef(0)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Held in refs so a callback identity that changes between renders does not
  // change the identity of `mutate`, which dapps put in dependency arrays.
  const runRef = useRef(run)
  runRef.current = run
  const optionsRef = useRef(options)
  optionsRef.current = options

  const mutateAsync = useCallback(
    async (variables: TVariables): Promise<TData> => {
      const runId = ++runIdRef.current
      dispatch({ type: 'start', variables, runId })

      try {
        if (joey === null) throw notInstalled()
        const data = await runRef.current(joey, variables)
        if (mountedRef.current) dispatch({ type: 'success', data, runId })
        optionsRef.current.onSuccess?.(data, variables)
        optionsRef.current.onSettled?.(data, undefined, variables)
        return data
      } catch (cause) {
        const error = JoeyRpcError.from(cause)
        if (mountedRef.current) dispatch({ type: 'error', error, runId })
        optionsRef.current.onError?.(error, variables)
        optionsRef.current.onSettled?.(undefined, error, variables)
        throw error
      }
    },
    [joey],
  )

  const mutate = useCallback(
    (variables: TVariables): void => {
      void mutateAsync(variables).catch(() => {
        /* surfaced through `error`; swallowing keeps `mutate` unrejectable */
      })
    },
    [mutateAsync],
  )

  const reset = useCallback((): void => {
    dispatch({ type: 'reset' })
  }, [])

  return { ...toPublicState(state), mutate, mutateAsync, reset }
}

export function useConnect(
  options?: UseJoeyMutationOptions<ConnectResult, ConnectParams | undefined>,
): UseJoeyMutationResult<ConnectResult, ConnectParams | undefined> {
  const { connect } = useJoey()
  return useJoeyMutation<ConnectResult, ConnectParams | undefined>(
    // Routed through the context so the provider's account/network state is
    // updated by the same call that resolves the mutation.
    (_joey, params) => connect(params),
    options,
  )
}

export function useDisconnect(
  options?: UseJoeyMutationOptions<void, void>,
): UseJoeyMutationResult<void, void> {
  const { disconnect } = useJoey()
  return useJoeyMutation<void, void>(() => disconnect(), options)
}

export function useSignTransaction<TTx extends TransactionLike = AnyTransaction>(
  options?: UseJoeyMutationOptions<SignTransactionResult, SignTransactionParams<TTx>>,
): UseJoeyMutationResult<SignTransactionResult, SignTransactionParams<TTx>> {
  return useJoeyMutation<SignTransactionResult, SignTransactionParams<TTx>>(
    (joey, params) => joey.signTransaction(params),
    options,
  )
}

export function useSignAndSubmit<TTx extends TransactionLike = AnyTransaction>(
  options?: UseJoeyMutationOptions<SignAndSubmitTransactionResult, SignTransactionParams<TTx>>,
): UseJoeyMutationResult<SignAndSubmitTransactionResult, SignTransactionParams<TTx>> {
  return useJoeyMutation<SignAndSubmitTransactionResult, SignTransactionParams<TTx>>(
    (joey, params) => joey.signAndSubmitTransaction(params),
    options,
  )
}

export function useSignTransactionFor<TTx extends TransactionLike = AnyTransaction>(
  options?: UseJoeyMutationOptions<SignTransactionResult, SignTransactionForParams<TTx>>,
): UseJoeyMutationResult<SignTransactionResult, SignTransactionForParams<TTx>> {
  return useJoeyMutation<SignTransactionResult, SignTransactionForParams<TTx>>(
    (joey, params) => joey.signTransactionFor(params),
    options,
  )
}

export function useSignTransactionBulk<TTx extends TransactionLike = AnyTransaction>(
  options?: UseJoeyMutationOptions<
    SignAndSubmitTransactionResult[],
    SignTransactionBulkParams<TTx>
  >,
): UseJoeyMutationResult<SignAndSubmitTransactionResult[], SignTransactionBulkParams<TTx>> {
  return useJoeyMutation<SignAndSubmitTransactionResult[], SignTransactionBulkParams<TTx>>(
    (joey, params) => joey.signTransactionBulk(params),
    options,
  )
}

export function useSignIn(
  options?: UseJoeyMutationOptions<SignInResult, SignInParams | undefined>,
): UseJoeyMutationResult<SignInResult, SignInParams | undefined> {
  return useJoeyMutation<SignInResult, SignInParams | undefined>(
    (joey, params) => joey.signIn(params),
    options,
  )
}

export type { MutationState, MutationStatus } from './mutation.js'
