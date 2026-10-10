import { describe, expect, it } from 'vitest'

import { partSchema } from '../../model/part'
import { stockItemSchema } from '../../model/stock-item'
import { supplierProductSchema } from '../../model/supplier-product'
import { validPartInput, validStockItemInput, validSupplierProductInput } from '../../model/__tests__/fixtures'
import { checkPartFit } from '../part-fit'

// Panel: 2500 × 1250 × 18 birch, grain along length.
const panel = supplierProductSchema.parse(validSupplierProductInput)
const noMargin = { edgeMarginMm: 0 }

function part(overrides: Partial<Record<keyof typeof validPartInput, unknown>> = {}) {
  return partSchema.parse({ ...validPartInput, ...overrides })
}

function issueKinds(result: ReturnType<typeof checkPartFit>): string[] {
  return result.fits ? [] : result.issues.map((issue) => issue.kind)
}

describe('checkPartFit', () => {
  it('fits a compatible part and reports the usable area', () => {
    expect(checkPartFit(part(), panel, { edgeMarginMm: 10 })).toEqual({
      fits: true,
      usableArea: { xMm: 10, yMm: 10, lengthMm: 2480, widthMm: 1230 },
      orientations: ['normal'],
    })
  })

  it('works with owned stock as well as supplier products', () => {
    const offcut = stockItemSchema.parse(validStockItemInput) // 800 × 400.5

    expect(checkPartFit(part({ lengthMm: 800, widthMm: 400.5 }), offcut, noMargin).fits).toBe(true)
    expect(checkPartFit(part({ lengthMm: 800.001, widthMm: 400.5 }), offcut, noMargin).fits).toBe(false)
  })

  describe('exact fits and boundaries', () => {
    it('accepts a part exactly as large as the panel without margin', () => {
      expect(checkPartFit(part({ lengthMm: 2500, widthMm: 1250 }), panel, noMargin).fits).toBe(true)
    })

    it('accepts a part exactly as large as the usable area', () => {
      expect(checkPartFit(part({ lengthMm: 2480, widthMm: 1230 }), panel, { edgeMarginMm: 10 }).fits).toBe(true)
    })

    it('accepts an exact fit with decimal margins', () => {
      const result = checkPartFit(part({ lengthMm: 2499.6, widthMm: 1249.6 }), panel, { edgeMarginMm: 0.2 })

      expect(result.fits).toBe(true)
    })

    it.each([
      { lengthMm: 2480.001, widthMm: 1230 },
      { lengthMm: 2480, widthMm: 1230.001 },
    ])('rejects a part 0.001 mm too large: %o', (size) => {
      const result = checkPartFit(part(size), panel, { edgeMarginMm: 10 })

      expect(result).toEqual({
        fits: false,
        issues: [
          {
            kind: 'exceedsUsableArea',
            usableArea: { xMm: 10, yMm: 10, lengthMm: 2480, widthMm: 1230 },
            triedOrientations: ['normal'],
          },
        ],
      })
    })

    it('reports no usable area when margins consume the panel', () => {
      const result = checkPartFit(part({ lengthMm: 1, widthMm: 1 }), panel, { edgeMarginMm: 625 })

      expect(result).toEqual({ fits: false, issues: [{ kind: 'noUsableArea', edgeMarginMm: 625 }] })
    })

    it('fits a tiny part in a tiny usable area', () => {
      const result = checkPartFit(part({ lengthMm: 0.002, widthMm: 0.002 }), panel, { edgeMarginMm: 624.999 })

      expect(result).toMatchObject({ fits: true, usableArea: { lengthMm: 1250.002, widthMm: 0.002 } })
    })
  })

  describe('rotation', () => {
    const grainless = { grainDirection: 'none' }

    it('needs rotation for a part wider than the panel width', () => {
      const result = checkPartFit(part({ ...grainless, rotation: 'allowed', lengthMm: 1000, widthMm: 2000 }), panel, noMargin)

      expect(result).toMatchObject({ fits: true, orientations: ['rotated'] })
    })

    it('rejects the same part when rotation is forbidden', () => {
      const result = checkPartFit(
        part({ ...grainless, rotation: 'forbidden', lengthMm: 1000, widthMm: 2000 }),
        panel,
        noMargin,
      )

      expect(issueKinds(result)).toEqual(['exceedsUsableArea'])
      expect(result).toMatchObject({ issues: [{ triedOrientations: ['normal'] }] })
    })

    it('lists both orientations when both fit', () => {
      const result = checkPartFit(part({ ...grainless, rotation: 'allowed', lengthMm: 600, widthMm: 400 }), panel, noMargin)

      expect(result).toMatchObject({ fits: true, orientations: ['normal', 'rotated'] })
    })

    it('handles square parts', () => {
      const result = checkPartFit(part({ ...grainless, rotation: 'allowed', lengthMm: 1250, widthMm: 1250 }), panel, noMargin)

      expect(result).toMatchObject({ fits: true, orientations: ['normal', 'rotated'] })
    })

    it('reports tried orientations when neither fits', () => {
      const result = checkPartFit(part({ ...grainless, rotation: 'allowed', lengthMm: 2600, widthMm: 100 }), panel, noMargin)

      expect(result).toMatchObject({ fits: false, issues: [{ kind: 'exceedsUsableArea', triedOrientations: ['normal', 'rotated'] }] })
    })
  })

  describe('grain', () => {
    it('rotates a part whose grain runs along its width onto a length-grained panel', () => {
      const result = checkPartFit(part({ grainDirection: 'width', rotation: 'allowed', lengthMm: 300, widthMm: 2000 }), panel, noMargin)

      expect(result).toMatchObject({ fits: true, orientations: ['rotated'] })
    })

    it('reports a grain/rotation conflict when grain requires a forbidden rotation', () => {
      const result = checkPartFit(part({ grainDirection: 'width', rotation: 'forbidden' }), panel, noMargin)

      expect(result).toEqual({
        fits: false,
        issues: [{ kind: 'grainRequiresRotation', partGrain: 'width', panelGrain: 'length', rotation: 'forbidden' }],
      })
    })

    it('does not rotate against the grain to make a part fit', () => {
      // Fits only rotated (2000 > 1250), but rotation would put the grain across the panel grain.
      const result = checkPartFit(part({ grainDirection: 'length', rotation: 'allowed', lengthMm: 1000, widthMm: 2000 }), panel, noMargin)

      expect(result).toMatchObject({ fits: false, issues: [{ kind: 'exceedsUsableArea', triedOrientations: ['normal'] }] })
    })

    it('ignores part grain on a grainless panel', () => {
      const mdf = supplierProductSchema.parse({ ...validSupplierProductInput, grainDirection: 'none' })
      const result = checkPartFit(part({ grainDirection: 'width', rotation: 'forbidden' }), mdf, noMargin)

      expect(result.fits).toBe(true)
    })

    it('follows a panel whose grain runs along its width', () => {
      const crossGrain = supplierProductSchema.parse({ ...validSupplierProductInput, grainDirection: 'width' })
      const result = checkPartFit(part({ grainDirection: 'length', rotation: 'allowed' }), crossGrain, noMargin)

      expect(result).toMatchObject({ fits: true, orientations: ['rotated'] })
    })
  })

  describe('material and thickness', () => {
    it('rejects another material even if the geometry fits', () => {
      expect(issueKinds(checkPartFit(part({ materialId: 'mat-oak' }), panel, noMargin))).toEqual(['materialMismatch'])
    })

    it('requires exact thickness equality', () => {
      const result = checkPartFit(part({ thicknessMm: 18.001 }), panel, noMargin)

      expect(result).toEqual({
        fits: false,
        issues: [{ kind: 'thicknessMismatch', expectedMm: 18.001, actualMm: 18 }],
      })
    })

    it('reports every issue in a fixed order', () => {
      const result = checkPartFit(
        part({ materialId: 'mat-oak', thicknessMm: 19, grainDirection: 'width', rotation: 'forbidden' }),
        panel,
        { edgeMarginMm: 700 },
      )

      expect(issueKinds(result)).toEqual(['materialMismatch', 'thicknessMismatch', 'noUsableArea', 'grainRequiresRotation'])
    })

    it('reports size problems alongside compatibility problems', () => {
      const result = checkPartFit(part({ thicknessMm: 19, lengthMm: 3000 }), panel, noMargin)

      expect(issueKinds(result)).toEqual(['thicknessMismatch', 'exceedsUsableArea'])
    })
  })

  describe('determinism', () => {
    it('returns equal results for repeated calls', () => {
      const input = part({ grainDirection: 'none', rotation: 'allowed', lengthMm: 600, widthMm: 400 })

      expect(checkPartFit(input, panel, { edgeMarginMm: 5 })).toEqual(checkPartFit(input, panel, { edgeMarginMm: 5 }))
    })
  })

  describe('invalid settings', () => {
    it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('throws for edge margin %d', (edgeMarginMm) => {
      expect(() => checkPartFit(part(), panel, { edgeMarginMm })).toThrow(RangeError)
    })
  })
})
