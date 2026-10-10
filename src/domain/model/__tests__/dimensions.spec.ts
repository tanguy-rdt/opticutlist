import { describe, expect, it } from 'vitest'

import { dimensions3DSchema } from '../dimensions'
import { dimensionKeys, invalidDimensionValues, without } from './fixtures'

const valid = { lengthMm: 2500, widthMm: 1250, thicknessMm: 18 }

describe('dimensions3DSchema', () => {
  it('accepts positive finite dimensions', () => {
    expect(dimensions3DSchema.parse(valid)).toEqual(valid)
  })

  it.each([
    { lengthMm: 0.001, widthMm: 0.001, thicknessMm: 0.001 },
    { lengthMm: 1250.5, widthMm: 2500.25, thicknessMm: 18.5 },
    { lengthMm: Number.MIN_VALUE, widthMm: 1, thicknessMm: 1 },
    { lengthMm: 1e9, widthMm: 1e9, thicknessMm: 1e6 },
  ])('accepts edge-case values %o', (dimensions) => {
    expect(dimensions3DSchema.safeParse(dimensions).success).toBe(true)
  })

  it('does not require width to be the smaller side', () => {
    expect(dimensions3DSchema.safeParse({ lengthMm: 100, widthMm: 900, thicknessMm: 18 }).success).toBe(true)
  })

  describe.each(dimensionKeys)('%s', (key) => {
    it('is mandatory', () => {
      const result = dimensions3DSchema.safeParse(without(valid, key))

      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.path).toEqual([key])
    })

    it.each(invalidDimensionValues)('rejects %o', (value) => {
      const result = dimensions3DSchema.safeParse({ ...valid, [key]: value })

      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.path).toEqual([key])
    })
  })

  it('rejects unknown keys instead of silently dropping them', () => {
    expect(dimensions3DSchema.safeParse({ ...valid, depthMm: 10 }).success).toBe(false)
  })

  it.each([null, undefined, 'x', 42, []])('rejects non-object input %o', (input) => {
    expect(dimensions3DSchema.safeParse(input).success).toBe(false)
  })
})
