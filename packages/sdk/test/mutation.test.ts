import { describe, expect, it } from 'vitest'

import { JoeyRpcError } from '../src/errors'
import { initialMutationState, mutationReducer, toPublicState } from '../src/mutation'

type State = ReturnType<typeof initialMutationState<string, number>>

const reduce = (state: State, action: Parameters<typeof mutationReducer<string, number>>[1]): State =>
  mutationReducer<string, number>(state, action)

describe('mutation reducer', () => {
  it('starts idle', () => {
    const state = initialMutationState<string, number>()
    expect(state.status).toBe('idle')
    expect(state.isIdle).toBe(true)
    expect(state.isPending).toBe(false)
  })

  it('moves to pending and records the variables', () => {
    const state = reduce(initialMutationState<string, number>(), {
      type: 'start',
      variables: 7,
      runId: 1,
    })
    expect(state.status).toBe('pending')
    expect(state.isPending).toBe(true)
    expect(state.variables).toBe(7)
  })

  it('clears a previous result when a new call starts', () => {
    let state = reduce(initialMutationState<string, number>(), {
      type: 'start',
      variables: 1,
      runId: 1,
    })
    state = reduce(state, { type: 'success', data: 'first', runId: 1 })
    state = reduce(state, { type: 'start', variables: 2, runId: 2 })
    expect(state.data).toBeUndefined()
    expect(state.error).toBeUndefined()
  })

  it('resolves to success', () => {
    let state = reduce(initialMutationState<string, number>(), {
      type: 'start',
      variables: 1,
      runId: 1,
    })
    state = reduce(state, { type: 'success', data: 'hash', runId: 1 })
    expect(state).toMatchObject({ status: 'success', data: 'hash', isSuccess: true })
  })

  it('resolves to error and drops any stale data', () => {
    let state = reduce(initialMutationState<string, number>(), {
      type: 'start',
      variables: 1,
      runId: 1,
    })
    const error = new JoeyRpcError(4001, 'The user rejected the request.')
    state = reduce(state, { type: 'error', error, runId: 1 })
    expect(state).toMatchObject({ status: 'error', error, isError: true })
    expect(state.data).toBeUndefined()
  })

  it('drops the answer to a superseded call', () => {
    let state = reduce(initialMutationState<string, number>(), {
      type: 'start',
      variables: 1,
      runId: 1,
    })
    state = reduce(state, { type: 'start', variables: 2, runId: 2 })

    // The first call finally answers. It must not overwrite the second.
    const stale = reduce(state, { type: 'success', data: 'first', runId: 1 })
    expect(stale).toBe(state)
    expect(stale.status).toBe('pending')

    const staleError = reduce(state, {
      type: 'error',
      error: new JoeyRpcError(4001, 'rejected'),
      runId: 1,
    })
    expect(staleError).toBe(state)
  })

  it('reset returns to idle but keeps the run counter', () => {
    let state = reduce(initialMutationState<string, number>(), {
      type: 'start',
      variables: 1,
      runId: 4,
    })
    state = reduce(state, { type: 'reset' })
    expect(state.status).toBe('idle')
    expect(state.variables).toBeUndefined()
    // Reset clears the view, it does not cancel the call: run 4 is still the
    // current run, so its answer still lands. Only a superseded run is dropped.
    expect(reduce(state, { type: 'success', data: 'late', runId: 4 }).status).toBe('success')
    expect(reduce(state, { type: 'success', data: 'late', runId: 1 }).status).toBe('idle')
  })

  it('the public state has no internal run id', () => {
    const state = toPublicState(initialMutationState<string, number>())
    expect('runId' in state).toBe(false)
  })
})
