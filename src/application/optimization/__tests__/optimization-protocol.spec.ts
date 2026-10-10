import { describe, expect, it } from 'vitest'

import { isOptimizationResponse, isOptimizeRequest, isRequestId } from '../optimization-protocol'

const input = { panel: {}, parts: [], settings: {} }

describe('isRequestId', () => {
  it.each([1, 2, Number.MAX_SAFE_INTEGER])('accepts %d', (id) => {
    expect(isRequestId(id)).toBe(true)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, '1', null])('rejects %o', (id) => {
    expect(isRequestId(id)).toBe(false)
  })
})

describe('isOptimizeRequest', () => {
  it('accepts a well-formed request', () => {
    expect(isOptimizeRequest({ type: 'optimize', requestId: 1, input })).toBe(true)
  })

  it.each([
    null,
    'optimize',
    {},
    { type: 'optimise', requestId: 1, input },
    { type: 'optimize', requestId: 0, input },
    { type: 'optimize', input },
    { type: 'optimize', requestId: 1 },
    { type: 'optimize', requestId: 1, input: { ...input, parts: {} } },
    { type: 'optimize', requestId: 1, input: { parts: [], settings: {} } },
    { type: 'optimize', requestId: 1, input: { panel: {}, parts: [] } },
  ])('rejects %o', (data) => {
    expect(isOptimizeRequest(data)).toBe(false)
  })
})

describe('isOptimizationResponse', () => {
  it.each([
    { type: 'result', requestId: 3, selection: { ok: true } },
    { type: 'result', requestId: 3, selection: { ok: false } },
    { type: 'error', requestId: 3, error: { kind: 'optimizerError', message: 'boom' } },
    { type: 'error', requestId: null, error: { kind: 'invalidRequest', message: 'bad' } },
  ])('accepts %o', (data) => {
    expect(isOptimizationResponse(data)).toBe(true)
  })

  it.each([
    null,
    { type: 'result', requestId: 3 },
    { type: 'result', requestId: null, selection: { ok: true } },
    { type: 'result', requestId: 3, selection: { ok: 'yes' } },
    { type: 'error', requestId: 3, error: { kind: 'crash', message: 'x' } },
    { type: 'error', requestId: 3, error: { kind: 'optimizerError' } },
    { type: 'error', requestId: 0, error: { kind: 'optimizerError', message: 'x' } },
    { type: 'progress', requestId: 3 },
  ])('rejects %o', (data) => {
    expect(isOptimizationResponse(data)).toBe(false)
  })
})
