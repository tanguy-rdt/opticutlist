import { describe, expect, it } from 'vitest'

import { fitsWithin, getUsableArea, splitRect, type Rect } from '../rect'

const panel = { lengthMm: 2500, widthMm: 1250 }

describe('getUsableArea', () => {
  it('returns the full panel without margin', () => {
    expect(getUsableArea(panel, { edgeMarginMm: 0 })).toEqual({ xMm: 0, yMm: 0, lengthMm: 2500, widthMm: 1250 })
  })

  it('trims the margin from all four edges', () => {
    expect(getUsableArea(panel, { edgeMarginMm: 10 })).toEqual({ xMm: 10, yMm: 10, lengthMm: 2480, widthMm: 1230 })
  })

  it('computes decimal margins exactly', () => {
    expect(getUsableArea({ lengthMm: 1250.3, widthMm: 600 }, { edgeMarginMm: 0.1 })).toEqual({
      xMm: 0.1,
      yMm: 0.1,
      lengthMm: 1250.1,
      widthMm: 599.8,
    })
  })

  it('keeps the smallest positive usable area', () => {
    expect(getUsableArea({ lengthMm: 100, widthMm: 20.001 }, { edgeMarginMm: 10 })?.widthMm).toBe(0.001)
  })

  it.each([625, 700, 2500])('returns null when a margin of %d mm consumes the panel', (edgeMarginMm) => {
    expect(getUsableArea(panel, { edgeMarginMm })).toBeNull()
  })

  it('returns null when only the shorter side is consumed', () => {
    expect(getUsableArea({ lengthMm: 2500, widthMm: 20 }, { edgeMarginMm: 10 })).toBeNull()
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('throws for invalid margin %d', (edgeMarginMm) => {
    expect(() => getUsableArea(panel, { edgeMarginMm })).toThrow(RangeError)
  })

  it.each([0, -1, Number.NaN])('throws for invalid panel length %d', (lengthMm) => {
    expect(() => getUsableArea({ lengthMm, widthMm: 100 }, { edgeMarginMm: 0 })).toThrow(RangeError)
  })
})

describe('fitsWithin', () => {
  const area = { lengthMm: 600, widthMm: 400 }

  it('accepts an exact fit', () => {
    expect(fitsWithin({ lengthMm: 600, widthMm: 400 }, area)).toBe(true)
  })

  it('accepts a smaller size', () => {
    expect(fitsWithin({ lengthMm: 599.999, widthMm: 1 }, area)).toBe(true)
  })

  it.each([
    { lengthMm: 600.001, widthMm: 400 },
    { lengthMm: 600, widthMm: 400.001 },
    { lengthMm: 400, widthMm: 600 },
  ])('rejects %o', (size) => {
    expect(fitsWithin(size, area)).toBe(false)
  })

  it('treats differences below 0.001 mm as equal', () => {
    expect(fitsWithin({ lengthMm: 600.0004, widthMm: 400 }, area)).toBe(true)
  })
})

describe('splitRect', () => {
  const rect: Rect = { xMm: 10, yMm: 10, lengthMm: 500, widthMm: 300 }

  it('cuts along the length axis and offsets the remainder by the kerf', () => {
    expect(splitRect(rect, { axis: 'length', offsetMm: 100 }, { kerfMm: 3.2 })).toEqual({
      first: { xMm: 10, yMm: 10, lengthMm: 100, widthMm: 300 },
      second: { xMm: 113.2, yMm: 10, lengthMm: 396.8, widthMm: 300 },
    })
  })

  it('cuts along the width axis', () => {
    expect(splitRect(rect, { axis: 'width', offsetMm: 120.5 }, { kerfMm: 4 })).toEqual({
      first: { xMm: 10, yMm: 10, lengthMm: 500, widthMm: 120.5 },
      second: { xMm: 10, yMm: 134.5, lengthMm: 500, widthMm: 175.5 },
    })
  })

  it('conserves material: pieces plus kerf equal the original extent', () => {
    const { first, second } = splitRect(rect, { axis: 'length', offsetMm: 123.456 }, { kerfMm: 3.2 })

    expect(second).not.toBeNull()
    expect(Math.round((first.lengthMm + 3.2 + (second?.lengthMm ?? 0)) * 1000)).toBe(500_000)
    expect(second?.xMm).toBe(136.656)
  })

  it('keeps exact fits in the remainder despite decimal kerf', () => {
    const { second } = splitRect({ xMm: 0, yMm: 0, lengthMm: 200.1, widthMm: 50 }, { axis: 'length', offsetMm: 100 }, { kerfMm: 3.2 })

    expect(second).toEqual({ xMm: 103.2, yMm: 0, lengthMm: 96.9, widthMm: 50 })
    expect(second !== null && fitsWithin({ lengthMm: 96.9, widthMm: 50 }, second)).toBe(true)
  })

  it('supports zero kerf', () => {
    expect(splitRect(rect, { axis: 'length', offsetMm: 250 }, { kerfMm: 0 }).second).toEqual({
      ...rect,
      xMm: 260,
      lengthMm: 250,
    })
  })

  it('keeps a 0.001 mm remainder', () => {
    expect(splitRect(rect, { axis: 'length', offsetMm: 496.799 }, { kerfMm: 3.2 }).second?.lengthMm).toBe(0.001)
  })

  it('returns no remainder when the kerf consumes exactly the rest', () => {
    expect(splitRect(rect, { axis: 'length', offsetMm: 496.8 }, { kerfMm: 3.2 }).second).toBeNull()
  })

  it('returns no remainder when the kerf is wider than the rest', () => {
    expect(splitRect(rect, { axis: 'width', offsetMm: 299 }, { kerfMm: 3.2 })).toEqual({
      first: { ...rect, widthMm: 299 },
      second: null,
    })
  })

  it.each([0, -1, 500, 500.5, Number.NaN])('rejects offset %d outside the rect', (offsetMm) => {
    expect(() => splitRect(rect, { axis: 'length', offsetMm }, { kerfMm: 3 })).toThrow(RangeError)
  })

  it('rejects an offset equal to the width when cutting along width', () => {
    expect(() => splitRect(rect, { axis: 'width', offsetMm: 300 }, { kerfMm: 3 })).toThrow(RangeError)
  })

  it.each([-0.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects kerf %d', (kerfMm) => {
    expect(() => splitRect(rect, { axis: 'length', offsetMm: 100 }, { kerfMm })).toThrow(RangeError)
  })
})
