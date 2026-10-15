import { describe, expect, it } from 'vitest'
import { partSchema } from '../../model/part'
import { supplierProductSchema } from '../../model/supplier-product'
import { validPartInput, validSupplierProductInput } from '../../model/__tests__/fixtures'
import { checkPartFit } from '../../geometry/part-fit'
import { validateCuttingTree } from '../../cutting-tree/validate-cutting-tree'
import { optimizePanel } from '../optimize-panel'

const settings = { kerfMm: 0, edgeMarginMm: 0 }
describe('grain alignment from fit checks through optimization and independent validation', () => {
  for (const grainDirection of ['length', 'width'] as const) {
    for (const panelGrain of ['length', 'width'] as const) {
      it.each(['allowed', 'forbidden'] as const)(`${grainDirection} part on ${panelGrain} panel ignores legacy %s preference`, rotation => {
        const orientation = grainDirection === panelGrain ? 'normal' : 'rotated'
        const part = partSchema.parse({ ...validPartInput, lengthMm: 800, widthMm: 400, quantity: 1, grainDirection, rotation })
        const panel = supplierProductSchema.parse({ ...validSupplierProductInput, lengthMm: orientation === 'normal' ? 800 : 400, widthMm: orientation === 'normal' ? 400 : 800, grainDirection: panelGrain })
        const input = { panel, parts: [part], settings }
        expect(checkPartFit(part, panel, settings)).toMatchObject({ fits: true, orientations: [orientation] })
        const result = optimizePanel(input)
        if (!result.ok) throw new Error('Optimization failed')
        expect(result.plan.unplaced).toEqual([])
        expect(result.plan.tree).toMatchObject({ kind: 'part', partId: part.id, orientation })
        expect(validateCuttingTree(result.plan.tree, input)).toEqual({ valid: true })
        expect(part.rotation).toBe(rotation)
      })
    }
  }

  it('rejects the geometrically fitting 90-degree placement that reverses finished-part grain', () => {
    const part = partSchema.parse({ ...validPartInput, lengthMm: 800, widthMm: 400, quantity: 1, grainDirection: 'length', rotation: 'allowed' })
    const panel = supplierProductSchema.parse({ ...validSupplierProductInput, lengthMm: 400, widthMm: 800, grainDirection: 'length' })
    const input = { panel, parts: [part], settings }
    expect(checkPartFit(part, panel, settings).fits).toBe(false)
    const result = optimizePanel(input)
    if (!result.ok) throw new Error('Optimization failed')
    expect(result.plan.unplaced).toHaveLength(1)
    expect(validateCuttingTree({ kind: 'part', region: { xMm: 0, yMm: 0, lengthMm: 400, widthMm: 800 }, partId: part.id, copyIndex: 0, orientation: 'rotated' }, input)).toMatchObject({ valid: false, issues: [expect.objectContaining({ kind: 'orientationNotAllowed' })] })
  })
})
