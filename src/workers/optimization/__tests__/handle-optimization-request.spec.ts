import { describe, expect, it } from 'vitest'

import { isOptimizationResponse } from '../../../application/optimization/optimization-protocol'
import { optimizePanel } from '../../../domain/optimizer/optimize-panel'
import { partSchema } from '../../../domain/model/part'
import { supplierProductSchema } from '../../../domain/model/supplier-product'
import { validPartInput, validSupplierProductInput } from '../../../domain/model/__tests__/fixtures'
import { handleOptimizationRequest } from '@/infrastructure/optimization/handle-optimization-request'

const input = {
  panel: supplierProductSchema.parse(validSupplierProductInput),
  parts: [partSchema.parse(validPartInput)],
  settings: { kerfMm: 3.2, edgeMarginMm: 10 },
}

describe('handleOptimizationRequest', () => {
  it('delegates to the domain optimizer and echoes the request ID', () => {
    const response = handleOptimizationRequest({ type: 'optimize', requestId: 7, input })

    expect(response).toEqual({ type: 'result', requestId: 7, selection: optimizePanel(input) })
    expect(isOptimizationResponse(response)).toBe(true)
  })

  it('survives structured cloning in both directions', () => {
    const response = handleOptimizationRequest(structuredClone({ type: 'optimize', requestId: 1, input }))

    expect(structuredClone(response)).toEqual(response)
  })

  it('returns domain failures as results', () => {
    const response = handleOptimizationRequest({ type: 'optimize', requestId: 2, input: { ...input, settings: { kerfMm: 3, edgeMarginMm: 700 } } })

    expect(response).toEqual({ type: 'result', requestId: 2, selection: { ok: false, error: { kind: 'noUsableArea' } } })
  })

  it('converts optimizer exceptions into structured errors', () => {
    const [part] = input.parts

    expect(handleOptimizationRequest({ type: 'optimize', requestId: 3, input: { ...input, parts: [part, part] } })).toEqual({
      type: 'error',
      requestId: 3,
      error: { kind: 'optimizerError', message: 'Duplicate part ID part-side-panel in optimizer input' },
    })
  })

  it('rejects non-finite settings before optimization', () => {
    const response = handleOptimizationRequest({ type: 'optimize', requestId: 4, input: { ...input, settings: { kerfMm: Number.NaN, edgeMarginMm: 10 } } })

    expect(response).toMatchObject({ type: 'error', requestId: 4, error: { kind: 'invalidRequest' } })
  })

  it('converts finite but out-of-range geometry into structured errors', () => {
    const response = handleOptimizationRequest({ type: 'optimize', requestId: 4, input: { ...input, settings: { kerfMm: Number.MAX_VALUE, edgeMarginMm: 10 } } })

    expect(response).toMatchObject({ type: 'error', requestId: 4, error: { kind: 'optimizerError' } })
  })

  it.each(['lengthMm', 'widthMm', 'thicknessMm'])('rejects a panel missing mandatory %s', (field) => {
    const panel = { ...input.panel, [field]: undefined }
    expect(handleOptimizationRequest({ type: 'optimize', requestId: 5, input: { ...input, panel } })).toMatchObject({
      type: 'error', requestId: 5, error: { kind: 'invalidRequest' },
    })
  })

  it('rejects malformed messages and keeps a readable request ID', () => {
    expect(handleOptimizationRequest({ type: 'optimize', requestId: 5 })).toEqual({
      type: 'error',
      requestId: 5,
      error: { kind: 'invalidRequest', message: 'Message is not a valid optimization request' },
    })
  })

  it.each([null, 'hello', { requestId: 'x' }, { requestId: -1 }])('uses a null request ID when none is readable: %o', (data) => {
    expect(handleOptimizationRequest(data)).toMatchObject({ type: 'error', requestId: null, error: { kind: 'invalidRequest' } })
  })
})
