import { describe, expect, it, vi } from 'vitest'

import type * as ValidatorModule from '../../cutting-tree/validate-cutting-tree'
import { validateCuttingTree, type CuttingTreeValidation } from '../../cutting-tree/validate-cutting-tree'
import { partSchema } from '../../model/part'
import { supplierProductSchema } from '../../model/supplier-product'
import { validPartInput, validSupplierProductInput } from '../../model/__tests__/fixtures'
import { optimizePanel } from '../optimize-panel'
import { planWithStrategy } from '../plan-with-strategy'

// Delegates to the real validator unless a test forces a rejection, simulating a heuristic bug.
vi.mock('../../cutting-tree/validate-cutting-tree', async (importOriginal) => {
  const actual = await importOriginal<typeof ValidatorModule>()
  return { ...actual, validateCuttingTree: vi.fn(actual.validateCuttingTree) }
})

const input = {
  panel: supplierProductSchema.parse(validSupplierProductInput),
  parts: [partSchema.parse(validPartInput)],
  settings: { kerfMm: 3.2, edgeMarginMm: 10 },
}
const rejection: CuttingTreeValidation = { valid: false, issues: [{ kind: 'reusedNode', path: [] }] }
const rejected = { kind: 'invalidTree', issues: [{ kind: 'reusedNode', path: [] }] }

function rejectNextCalls(count: number): void {
  for (let call = 0; call < count; call += 1) {
    vi.mocked(validateCuttingTree).mockReturnValueOnce(rejection)
  }
}

describe('optimizer with rejected trees', () => {
  it('returns an error instead of a plan for a single strategy', () => {
    rejectNextCalls(1)

    expect(planWithStrategy(input, 'bestShortSideFit')).toEqual({ ok: false, error: rejected })
  })

  it('never selects a rejected candidate', () => {
    // The baseline would otherwise win the tie; it is rejected, so the next valid strategy is selected.
    rejectNextCalls(1)
    const result = optimizePanel(input)

    expect(result).toMatchObject({
      ok: true,
      strategy: 'longestSideFirst',
      comparison: [
        { strategy: 'largestAreaFirst', status: 'rejected', error: rejected },
        { strategy: 'longestSideFirst', status: 'valid' },
        { strategy: 'bestShortSideFit', status: 'valid' },
      ],
    })
  })

  it('reports an error when every candidate is rejected', () => {
    rejectNextCalls(3)

    expect(optimizePanel(input)).toEqual({
      ok: false,
      error: {
        kind: 'noValidCandidate',
        comparison: [
          { strategy: 'largestAreaFirst', status: 'rejected', error: rejected },
          { strategy: 'longestSideFirst', status: 'rejected', error: rejected },
          { strategy: 'bestShortSideFit', status: 'rejected', error: rejected },
        ],
      },
    })
  })
})
