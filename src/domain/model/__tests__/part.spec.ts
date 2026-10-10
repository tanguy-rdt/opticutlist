import { describe, expect, it } from 'vitest'

import { partSchema } from '../part'
import { dimensionKeys, invalidDimensionValues, invalidQuantityValues, validPartInput, without } from './fixtures'

describe('partSchema', () => {
  it('accepts a valid part', () => {
    expect(partSchema.parse(validPartInput)).toEqual(validPartInput)
  })

  it.each(['id', 'name', 'materialId', 'quantity', 'grainDirection', 'rotation'] as const)('requires %s', (key) => {
    expect(partSchema.safeParse(without(validPartInput, key)).success).toBe(false)
  })

  describe.each(dimensionKeys)('%s', (key) => {
    it('is mandatory', () => {
      const result = partSchema.safeParse(without(validPartInput, key))

      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.path).toEqual([key])
    })

    it.each(invalidDimensionValues)('rejects %o', (value) => {
      expect(partSchema.safeParse({ ...validPartInput, [key]: value }).success).toBe(false)
    })
  })

  it('rejects nested dimensions: dimensions are flat fields', () => {
    const { lengthMm, widthMm, thicknessMm, ...rest } = validPartInput

    expect(partSchema.safeParse({ ...rest, dimensions: { lengthMm, widthMm, thicknessMm } }).success).toBe(false)
  })

  it.each([1, 2, 1000, Number.MAX_SAFE_INTEGER])('accepts quantity %d', (quantity) => {
    expect(partSchema.safeParse({ ...validPartInput, quantity }).success).toBe(true)
  })

  it.each(invalidQuantityValues)('rejects quantity %o', (quantity) => {
    expect(partSchema.safeParse({ ...validPartInput, quantity }).success).toBe(false)
  })

  it.each(['none', 'length', 'width'])('accepts grain direction %s', (grainDirection) => {
    expect(partSchema.safeParse({ ...validPartInput, grainDirection }).success).toBe(true)
  })

  it.each(['', 'horizontal', 'LENGTH', null])('rejects grain direction %o', (grainDirection) => {
    expect(partSchema.safeParse({ ...validPartInput, grainDirection }).success).toBe(false)
  })

  it.each(['allowed', 'forbidden'])('accepts rotation %s', (rotation) => {
    expect(partSchema.safeParse({ ...validPartInput, rotation }).success).toBe(true)
  })

  it.each([true, false, 'free', 90, null])('rejects rotation %o', (rotation) => {
    expect(partSchema.safeParse({ ...validPartInput, rotation }).success).toBe(false)
  })

  it('rejects invalid material IDs', () => {
    expect(partSchema.safeParse({ ...validPartInput, materialId: '' }).success).toBe(false)
  })

  it('rejects unknown keys instead of silently dropping them', () => {
    expect(partSchema.safeParse({ ...validPartInput, color: 'red' }).success).toBe(false)
  })
})
