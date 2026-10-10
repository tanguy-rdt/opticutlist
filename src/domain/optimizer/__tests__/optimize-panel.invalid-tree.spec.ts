import { describe, expect, it, vi } from 'vitest'

import { partSchema } from '../../model/part'
import { supplierProductSchema } from '../../model/supplier-product'
import { validPartInput, validSupplierProductInput } from '../../model/__tests__/fixtures'
import { optimizePanel } from '../optimize-panel'

// Simulates a heuristic bug: the independent validator rejects whatever the optimizer built.
vi.mock('../../cutting-tree/validate-cutting-tree', () => ({
  validateCuttingTree: () => ({ valid: false, issues: [{ kind: 'reusedNode', path: [] }] }),
}))

describe('optimizePanel with a rejected tree', () => {
  it('returns an error instead of a plan', () => {
    const result = optimizePanel({
      panel: supplierProductSchema.parse(validSupplierProductInput),
      parts: [partSchema.parse(validPartInput)],
      settings: { kerfMm: 3.2, edgeMarginMm: 10 },
    })

    expect(result).toEqual({ ok: false, error: { kind: 'invalidTree', issues: [{ kind: 'reusedNode', path: [] }] } })
  })
})
