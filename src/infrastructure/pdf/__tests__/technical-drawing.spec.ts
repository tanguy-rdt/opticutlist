import { PDFDocument } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import { DIMENSION_CLEARANCE, drawGrain, scaleLabel, technicalTransform, wasteHatchLines } from '../technical-drawing'
import { millimetresToPoints, pdfPageSize, pdfRect } from '../pdf-layout'

describe('Physical technical drawing geometry', () => {
  it.each([1, 2, 5, 10])('uses an exact 1:%i physical scale', denominator => {
    const rect = { xMm: 0, yMm: 0, lengthMm: 200, widthMm: 100 }
    const box = { x: 60, y: 120, width: millimetresToPoints(200) / denominator, height: millimetresToPoints(100) / denominator }
    const transform = technicalTransform(rect, box)
    expect(transform.scale).toBe(1 / denominator)
    expect(scaleLabel(transform)).toBe(`1:${String(denominator)}`)
    expect(pdfRect(rect, transform).width).toBeCloseTo(millimetresToPoints(200) / denominator)
    expect(pdfRect(rect, transform).height).toBeCloseTo(millimetresToPoints(100) / denominator)
  })
  it.each(['A4', 'A3'] as const)('fits conventional drawings and offset dimensions within %s in both orientations', paper => {
    for (const orientation of ['portrait', 'landscape'] as const) {
      const size = pdfPageSize(paper, orientation)
      const available = { x: 36 + DIMENSION_CLEARANCE, y: 174, width: size.width - 72 - DIMENSION_CLEARANCE * 2 - 120, height: size.height - 400 }
      for (const dimensions of [{ lengthMm: 2500, widthMm: 1250 }, { lengthMm: 100, widthMm: 80 }, { lengthMm: 9000, widthMm: 9000 }]) {
        const rect = { ...dimensions, xMm: 0, yMm: 0 }
        const transform = technicalTransform(rect, available)
        const box = pdfRect(rect, transform)
        expect(box.x - 33).toBeGreaterThanOrEqual(36)
        expect(box.y - 33).toBeGreaterThanOrEqual(104)
        expect(box.x + box.width).toBeLessThanOrEqual(size.width - 36)
        expect(box.y + box.height).toBeLessThanOrEqual(size.height - 36)
        expect(box.width / box.height).toBeCloseTo(dimensions.lengthMm / dimensions.widthMm)
        expect(transform.scale).toBeLessThanOrEqual(1)
      }
    }
  })
  it('clips every 45-degree hatch stroke to the literal waste bounds with consistent paper spacing', () => {
    const box = { x: 100, y: 200, width: 58, height: 70 }
    const lines = wasteHatchLines(box)
    expect(lines.length).toBeGreaterThan(2)
    for (const line of lines) {
      for (const point of [line.start, line.end]) {
        expect(point.x).toBeGreaterThanOrEqual(100); expect(point.x).toBeLessThanOrEqual(158)
        expect(point.y).toBeGreaterThanOrEqual(200); expect(point.y).toBeLessThanOrEqual(270)
      }
      expect(line.end.x - line.start.x).toBeCloseTo(line.start.y - line.end.y)
    }
    expect((lines[1]?.start.y ?? 0) - (lines[0]?.start.y ?? 0)).toBeCloseTo(8 * Math.SQRT2)
  })
  it('draws grain on the resolved axes and never adds an indicator for absent grain', async () => {
    const pdf = await PDFDocument.create()
    const page = pdf.addPage()
    const line = vi.spyOn(page, 'drawLine')
    const box = { x: 50, y: 50, width: 100, height: 100 }
    drawGrain(page, box, 'none')
    expect(line).not.toHaveBeenCalled()
    drawGrain(page, box, 'length')
    expect(line.mock.calls[0]?.[0]).toMatchObject({ start: { x: 125, y: 59 }, end: { x: 141, y: 59 } })
    line.mockClear()
    drawGrain(page, box, 'width')
    expect(line.mock.calls[0]?.[0]).toMatchObject({ start: { x: 141, y: 75 }, end: { x: 141, y: 59 } })
  })
  it('preserves literal kerf and margin regions at the selected scale', () => {
    const transform = technicalTransform({ xMm: 0, yMm: 0, lengthMm: 100, widthMm: 80 }, { x: 0, y: 0, width: millimetresToPoints(50), height: millimetresToPoints(40) })
    const kerf = pdfRect({ xMm: 35, yMm: 5, lengthMm: 2, widthMm: 70 }, transform)
    expect(kerf.width).toBeCloseTo(millimetresToPoints(1))
    expect(kerf.height).toBeCloseTo(millimetresToPoints(35))
    const usable = pdfRect({ xMm: 5, yMm: 5, lengthMm: 90, widthMm: 70 }, transform)
    const panel = pdfRect({ xMm: 0, yMm: 0, lengthMm: 100, widthMm: 80 }, transform)
    expect(usable.x - panel.x).toBeCloseTo(millimetresToPoints(2.5))
  })
})
