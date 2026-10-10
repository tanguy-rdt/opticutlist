import { describe, expect, it } from 'vitest'

import {
  getCompatibilityIssues,
  hasSameMaterial,
  hasSameThickness,
  isCompatible,
  type MaterialSpec,
} from '../compatibility'
import { materialIdSchema } from '../model/ids'
import { partSchema } from '../model/part'
import { stockItemSchema } from '../model/stock-item'
import { supplierProductSchema } from '../model/supplier-product'
import { validPartInput, validStockItemInput, validSupplierProductInput } from '../model/__tests__/fixtures'

const birch = materialIdSchema.parse('mat-birch')
const oak = materialIdSchema.parse('mat-oak')

function spec(materialId: MaterialSpec['materialId'], thicknessMm: number): MaterialSpec {
  return { materialId, thicknessMm }
}

describe('hasSameMaterial', () => {
  it('matches identical material IDs', () => {
    expect(hasSameMaterial(spec(birch, 18), spec(birch, 12))).toBe(true)
  })

  it('rejects different material IDs', () => {
    expect(hasSameMaterial(spec(birch, 18), spec(oak, 18))).toBe(false)
  })

  it('is case-sensitive', () => {
    expect(hasSameMaterial(spec(birch, 18), spec(materialIdSchema.parse('MAT-BIRCH'), 18))).toBe(false)
  })
})

describe('hasSameThickness', () => {
  it.each([
    [18, 18],
    [18, 18.0],
    [0.5, 0.5],
    [18.5, 18.5],
  ])('matches %d and %d', (a, b) => {
    expect(hasSameThickness(spec(birch, a), spec(birch, b))).toBe(true)
  })

  it.each([
    [18, 19],
    [18, 18.000001],
    [18, 17.999999],
    [18, 1.8],
    [0.1 + 0.2, 0.3],
  ])('requires exact equality: %d differs from %d', (a, b) => {
    expect(hasSameThickness(spec(birch, a), spec(birch, b))).toBe(false)
  })

  it('ignores material', () => {
    expect(hasSameThickness(spec(birch, 18), spec(oak, 18))).toBe(true)
  })
})

describe('getCompatibilityIssues', () => {
  it('returns no issue for same material and thickness', () => {
    expect(getCompatibilityIssues(spec(birch, 18), spec(birch, 18))).toEqual([])
  })

  it('reports a material mismatch', () => {
    expect(getCompatibilityIssues(spec(birch, 18), spec(oak, 18))).toEqual([
      { kind: 'materialMismatch', expected: birch, actual: oak },
    ])
  })

  it('reports a thickness mismatch', () => {
    expect(getCompatibilityIssues(spec(birch, 18), spec(birch, 19))).toEqual([
      { kind: 'thicknessMismatch', expectedMm: 18, actualMm: 19 },
    ])
  })

  it('reports all issues at once', () => {
    expect(getCompatibilityIssues(spec(birch, 18), spec(oak, 12)).map((issue) => issue.kind)).toEqual([
      'materialMismatch',
      'thicknessMismatch',
    ])
  })
})

describe('isCompatible', () => {
  const part = partSchema.parse(validPartInput)
  const product = supplierProductSchema.parse(validSupplierProductInput)
  const stock = stockItemSchema.parse(validStockItemInput)

  it('accepts domain entities with matching material and thickness', () => {
    expect(isCompatible(part, product)).toBe(true)
    expect(isCompatible(part, stock)).toBe(true)
  })

  it('rejects a supplier product of another thickness', () => {
    const thinner = supplierProductSchema.parse({ ...validSupplierProductInput, thicknessMm: 15 })

    expect(isCompatible(part, thinner)).toBe(false)
  })

  it('rejects stock of another material even when thickness matches', () => {
    const mdf = stockItemSchema.parse({ ...validStockItemInput, materialId: 'mat-mdf' })

    expect(isCompatible(part, mdf)).toBe(false)
  })

  it('does not depend on length or width', () => {
    const tiny = stockItemSchema.parse({ ...validStockItemInput, lengthMm: 1, widthMm: 1 })

    expect(isCompatible(part, tiny)).toBe(true)
  })
})
