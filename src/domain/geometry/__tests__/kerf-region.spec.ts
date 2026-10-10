import { describe, expect, it } from 'vitest'
import { getKerfRegion } from '../kerf-region'
const region = { xMm: 5.1, yMm: 2.2, lengthMm: 90, widthMm: 70 }
describe('Executable cut kerf region', () => {
  it('uses the exact integer-micrometre gap on both axes', () => {
    expect(getKerfRegion(region, { axis: 'length', offsetMm: 30.2 }, { kerfMm: 3.2 })).toEqual({ xMm: 35.3, yMm: 2.2, lengthMm: 3.2, widthMm: 70 })
    expect(getKerfRegion(region, { axis: 'width', offsetMm: 50.1 }, { kerfMm: 3.2 })).toEqual({ xMm: 5.1, yMm: 52.3, lengthMm: 90, widthMm: 3.2 })
  })
  it('retains zero kerf as a line', () => {
    expect(getKerfRegion(region, { axis: 'length', offsetMm: 30 }, { kerfMm: 0 })).toEqual({ xMm: 35.1, yMm: 2.2, lengthMm: 0, widthMm: 70 })
  })
  it('rejects non-executable and out-of-range cuts rather than clamping', () => {
    expect(() => getKerfRegion(region, { axis: 'length', offsetMm: 89 }, { kerfMm: 2 })).toThrow(RangeError)
    expect(() => getKerfRegion(region, { axis: 'width', offsetMm: Infinity }, { kerfMm: 2 })).toThrow(RangeError)
  })
})
