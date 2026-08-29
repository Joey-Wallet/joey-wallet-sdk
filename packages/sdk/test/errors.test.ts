import { describe, expect, it } from 'vitest'

import {
  JOEY_ERROR_CODES,
  JoeyRpcError,
  isUserRejection,
  notInstalledError,
  userRejectedError,
} from '../src/errors'

describe('JoeyRpcError.from', () => {
  it('passes an existing JoeyRpcError through unchanged', () => {
    const original = new JoeyRpcError(4100, 'nope')
    expect(JoeyRpcError.from(original)).toBe(original)
  })

  it('adopts code, message and data from a plain object', () => {
    const error = JoeyRpcError.from({ code: 4300, message: 'Locked', data: { at: 1 } })
    expect(error.code).toBe(4300)
    expect(error.message).toBe('Locked')
    expect(error.data).toEqual({ at: 1 })
  })

  it('infers 4001 from a message when the provider sent no code', () => {
    expect(JoeyRpcError.from({ message: 'User rejected the signature' }).code).toBe(4001)
    expect(JoeyRpcError.from('Request was cancelled').code).toBe(4001)
  })

  it('falls back to an internal code for anything unclassifiable', () => {
    expect(JoeyRpcError.from(undefined).code).toBe(JOEY_ERROR_CODES.INTERNAL)
    expect(JoeyRpcError.from(42).code).toBe(JOEY_ERROR_CODES.INTERNAL)
    expect(JoeyRpcError.from({}).code).toBe(JOEY_ERROR_CODES.INTERNAL)
  })

  it('promotes a native Error, keeping its message', () => {
    const error = JoeyRpcError.from(new Error('the socket died'))
    expect(error).toBeInstanceOf(JoeyRpcError)
    expect(error.message).toBe('the socket died')
    expect(error.code).toBe(JOEY_ERROR_CODES.INTERNAL)
  })

  it('is an Error, so existing catch blocks keep working', () => {
    const error = JoeyRpcError.from({ code: 1, message: 'x' })
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('JoeyRpcError')
  })
})

describe('isUserRejection', () => {
  it('matches the numeric code', () => {
    expect(isUserRejection(new JoeyRpcError(4001, 'no'))).toBe(true)
    expect(isUserRejection({ code: 4001 })).toBe(true)
  })

  it('matches on the word, which is what older adapters string-match', () => {
    expect(isUserRejection({ code: -1, message: 'User rejected' })).toBe(true)
    expect(isUserRejection('rejected in the wallet')).toBe(true)
  })

  it('does not match an unrelated failure', () => {
    expect(isUserRejection(new JoeyRpcError(4900, 'Not installed.'))).toBe(false)
    expect(isUserRejection(null)).toBe(false)
    expect(isUserRejection(new Error('network down'))).toBe(false)
  })
})

describe('constructed errors', () => {
  it('the rejection message contains the word adapters look for', () => {
    expect(userRejectedError().message.toLowerCase()).toContain('rejected')
    expect(userRejectedError().code).toBe(4001)
  })

  it('not-installed is 4900, not 4001', () => {
    expect(notInstalledError().code).toBe(JOEY_ERROR_CODES.DISCONNECTED)
    expect(isUserRejection(notInstalledError())).toBe(false)
  })

  it('leaves data undefined when none was given', () => {
    expect(new JoeyRpcError(4001, 'x').data).toBeUndefined()
  })
})
