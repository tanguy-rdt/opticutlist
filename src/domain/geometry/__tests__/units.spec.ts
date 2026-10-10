import { describe, expect, it } from 'vitest'

import { toMm, toNonNegativeUm, toPositiveUm } from '../units'

describe('micrometre conversion', () => {
  it.each([
    [18, 18000],
    [3.2, 3200],
    [0.001, 1],
    [1250.5, 1250500],
    [0.0006, 1],
  ])('converts %d mm to %d µm', (mm, um) => {
    expect(toPositiveUm(mm)).toBe(um)
  })

  it('round-trips decimal millimeters', () => {
    expect(toMm(toPositiveUm(396.8))).toBe(396.8)
  })

  it('makes kerf arithmetic exact', () => {
    // In plain floating point, 100.1 - 3.2 is 96.89999999999999: an exact 96.9 mm fit would be lost.
    expect(100.1 - 3.2).toBeLessThan(96.9)
    expect(toMm(toPositiveUm(100.1) - toPositiveUm(3.2))).toBe(96.9)
  })

  it('accepts zero only for non-negative values', () => {
    expect(toNonNegativeUm(0)).toBe(0)
    expect(() => toPositiveUm(0)).toThrow(RangeError)
  })

  it.each([0.0004, -0.001, -1])('rejects %d mm as a positive extent', (mm) => {
    expect(() => toPositiveUm(mm)).toThrow(RangeError)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_VALUE, -0.001])(
    'rejects %d mm as a non-negative value',
    (mm) => {
      expect(() => toNonNegativeUm(mm)).toThrow(RangeError)
    },
  )
})
