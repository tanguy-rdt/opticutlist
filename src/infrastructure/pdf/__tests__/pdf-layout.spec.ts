import { describe, expect, it } from 'vitest'
import { a4PageSize, fitPdfPanel, millimetresToPoints, pdfRect } from '../pdf-layout'

describe('Millimetre-based PDF layout', () => {
  it('converts one inch to 72 points and respects existing micrometre resolution', () => {
    expect(millimetresToPoints(25.4)).toBe(72)
    expect(millimetresToPoints(0)).toBe(0)
    expect(millimetresToPoints(0.001)).toBeCloseTo(72 / 25400, 12)
    expect(millimetresToPoints(0.0014)).toBe(millimetresToPoints(0.001))
    for (const invalid of [-1, NaN, Infinity, Number.MAX_VALUE]) expect(() => millimetresToPoints(invalid)).toThrow(RangeError)
  })
  it('provides exact A4 portrait and landscape page dimensions', () => {
    expect(a4PageSize('portrait').width).toBeCloseTo(595.27559055)
    expect(a4PageSize('portrait').height).toBeCloseTo(841.88976378)
    expect(a4PageSize('landscape').width).toBeCloseTo(841.88976378)
    expect(a4PageSize('landscape').height).toBeCloseTo(595.27559055)
  })
  it('centers the entire panel without distortion and flips the PDF y axis consistently', () => {
    const transform = fitPdfPanel({ xMm: 0, yMm: 0, lengthMm: 100, widthMm: 80 }, { x: 20, y: 30, width: 720, height: 720 })
    expect(transform.scale).toBeCloseTo(2.54)
    expect(transform.x).toBeCloseTo(20)
    expect(transform.y).toBeCloseTo(102)
    const part = pdfRect({ xMm: 5, yMm: 5, lengthMm: 30, widthMm: 50 }, transform)
    expect(part.x).toBeCloseTo(56)
    expect(part.y).toBeCloseTo(282)
    expect(part.width).toBeCloseTo(216)
    expect(part.height).toBeCloseTo(360)
    const usable = pdfRect({ xMm: 5, yMm: 5, lengthMm: 90, widthMm: 70 }, transform)
    expect(usable.x).toBeCloseTo(56); expect(usable.y).toBeCloseTo(138)
    expect(usable.width).toBeCloseTo(648); expect(usable.height).toBeCloseTo(504)
    const kerf = pdfRect({ xMm: 35, yMm: 5, lengthMm: 2, widthMm: 70 }, transform)
    expect(kerf.x).toBeCloseTo(272); expect(kerf.y).toBeCloseTo(138)
    expect(kerf.width).toBeCloseTo(14.4); expect(kerf.height).toBeCloseTo(504)
    expect(pdfRect({ xMm: 35, yMm: 5, lengthMm: 0, widthMm: 70 }, transform).width).toBe(0)
  })
  it.each(['portrait', 'landscape'] as const)('fits tall and wide panels within %s drawing areas', orientation => {
    const size = a4PageSize(orientation)
    const box = { x: 36, y: 90, width: size.width - 72, height: size.height - 300 }
    for (const [lengthMm, widthMm] of [[3000, 1200], [800, 5000]] as const) {
      const panel = { xMm: 0, yMm: 0, lengthMm, widthMm }
      const rect = pdfRect(panel, fitPdfPanel(panel, box))
      expect(rect.x).toBeGreaterThanOrEqual(box.x)
      expect(rect.y).toBeGreaterThanOrEqual(box.y)
      expect(rect.width).toBeLessThanOrEqual(box.width)
      expect(rect.height).toBeLessThanOrEqual(box.height)
      expect(rect.width / rect.height).toBeCloseTo(lengthMm / widthMm)
    }
  })
  it('rejects unusable drawing areas rather than clamping', () => {
    expect(() => fitPdfPanel({ xMm: 0, yMm: 0, lengthMm: 100, widthMm: 80 }, { x: 0, y: 0, width: 100, height: 0 })).toThrow(RangeError)
  })
})
