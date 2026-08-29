/**
 * The state machine behind the react-query-shaped hooks.
 *
 * Kept here, free of React, for two reasons: the reducer is the part with the
 * interesting edge cases (a stale response landing after a newer one), and it is
 * testable without a DOM. `@joeywallet/wallet-sdk/react` is a thin binding over it, so
 * the SDK gains react-query's ergonomics without react-query's dependency.
 */
import { JoeyRpcError } from './errors.js'

export type MutationStatus = 'idle' | 'pending' | 'success' | 'error'

export interface MutationState<TData, TVariables> {
  status: MutationStatus
  data: TData | undefined
  error: JoeyRpcError | undefined
  /** The arguments of the most recent call, kept so a retry needs no closure. */
  variables: TVariables | undefined
  isIdle: boolean
  isPending: boolean
  isSuccess: boolean
  isError: boolean
}

export type MutationAction<TData, TVariables> =
  | { type: 'reset' }
  | { type: 'start'; variables: TVariables; runId: number }
  | { type: 'success'; data: TData; runId: number }
  | { type: 'error'; error: JoeyRpcError; runId: number }

interface InternalState<TData, TVariables> extends MutationState<TData, TVariables> {
  /** Identifies the call whose result may still write to this state. */
  runId: number
}

export function initialMutationState<TData, TVariables>(): InternalState<TData, TVariables> {
  return {
    status: 'idle',
    data: undefined,
    error: undefined,
    variables: undefined,
    isIdle: true,
    isPending: false,
    isSuccess: false,
    isError: false,
    runId: 0,
  }
}

export function mutationReducer<TData, TVariables>(
  state: InternalState<TData, TVariables>,
  action: MutationAction<TData, TVariables>,
): InternalState<TData, TVariables> {
  switch (action.type) {
    case 'reset':
      return { ...initialMutationState<TData, TVariables>(), runId: state.runId }

    case 'start':
      return {
        status: 'pending',
        // The previous result is cleared so a stale success cannot be rendered
        // next to a spinner for the call that superseded it.
        data: undefined,
        error: undefined,
        variables: action.variables,
        isIdle: false,
        isPending: true,
        isSuccess: false,
        isError: false,
        runId: action.runId,
      }

    case 'success':
      // A response from a superseded call is dropped: the user clicked twice,
      // and the answer to the first click must not overwrite the second.
      if (action.runId !== state.runId) return state
      return {
        ...state,
        status: 'success',
        data: action.data,
        error: undefined,
        isIdle: false,
        isPending: false,
        isSuccess: true,
        isError: false,
      }

    case 'error':
      if (action.runId !== state.runId) return state
      return {
        ...state,
        status: 'error',
        data: undefined,
        error: action.error,
        isIdle: false,
        isPending: false,
        isSuccess: false,
        isError: true,
      }
  }
}

/** The public half of {@link InternalState}, with `runId` dropped. */
export function toPublicState<TData, TVariables>(
  state: InternalState<TData, TVariables>,
): MutationState<TData, TVariables> {
  const { runId: _runId, ...rest } = state
  return rest
}
