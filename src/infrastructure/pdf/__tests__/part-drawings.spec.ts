import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import { appendPartDrawings } from '../part-drawings'
import { partDrawingCells, partDrawingGeometry } from '../part-drawing-grid'
import { millimetresToPoints, pdfPageSize } from '../pdf-layout'
import { scaleLabel } from '../technical-drawing'
import { partSchema } from '../../../domain/model/part'
import { validPartInput } from '../../../domain/model/__tests__/fixtures'

function parts(count: number) {
  return Array.from({ length: count }, (_, index) => partSchema.parse({ ...validPartInput, id: `drawing-${String(index)}`, name: `Shelf ${String(index + 1)}`, lengthMm: 200, widthMm: 100, quantity: 12, grainDirection: 'none' }))
}
async function fixture() {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  return { pdf, font, bold }
}
describe('Individual part drawing grid', () => {
  it.each([[0, 0], [1, 1], [6, 1], [7, 2], [14, 3]])('paginates %i distinct definitions into %i portrait sheets without expanding quantities', async (count, sheets) => {
    const { pdf, font, bold } = await fixture()
    const input = parts(count)
    const before = structuredClone(input)
    const frame = vi.fn()
    appendPartDrawings(pdf, font, bold, input, 'A4', 'portrait', () => 'Birch plywood', frame)
    expect(pdf.getPageCount()).toBe(sheets)
    expect(frame).toHaveBeenCalledTimes(sheets)
    expect(input).toEqual(before)
  })
  it.each(['A4', 'A3'] as const)('keeps drawings and dimension clearances within %s cells in both orientations', paper => {
    for (const orientation of ['portrait', 'landscape'] as const) {
      const size = pdfPageSize(paper, orientation)
      const cells = partDrawingCells(size)
      expect(cells).toHaveLength(paper === 'A4' && orientation === 'landscape' ? 4 : 6)
      for (const cell of cells) {
        expect(cell.y).toBeGreaterThanOrEqual(36)
        expect(cell.y + cell.height).toBeLessThanOrEqual(size.height - 60)
        for (const dimensions of [{ lengthMm: 100, widthMm: 80 }, { lengthMm: 2500, widthMm: 1250 }, { lengthMm: 0.001, widthMm: 5000 }, { lengthMm: 5000, widthMm: 0.001 }]) {
          const rect = { xMm: 0, yMm: 0, ...dimensions }
          const { box, transform } = partDrawingGeometry(rect, cell, 34, 42)
          expect(box.x - 33).toBeGreaterThan(cell.x)
          expect(box.y - 33).toBeGreaterThan(cell.y + 42)
          expect(box.x + box.width + 3).toBeLessThan(cell.x + cell.width)
          expect(box.y + box.height + 3).toBeLessThan(cell.y + cell.height - 34)
          expect(box.width / box.height).toBeCloseTo(dimensions.lengthMm / dimensions.widthMm)
          expect(box.width).toBeCloseTo(millimetresToPoints(dimensions.lengthMm) * transform.scale)
          expect(box.height).toBeCloseTo(millimetresToPoints(dimensions.widthMm) * transform.scale)
        }
      }
    }
  })
  it.each([[50, 20, 1], [100, 50, 2], [250, 100, 5], [500, 200, 10]])('draws %i × %i mm at a physically accurate 1:%i scale', (lengthMm, widthMm, denominator) => {
    const cell = partDrawingCells(pdfPageSize('A4', 'portrait'))[0]
    if (!cell) throw new Error('Missing cell')
    const { box, transform } = partDrawingGeometry({ xMm: 0, yMm: 0, lengthMm, widthMm }, cell, 34, 42)
    expect(scaleLabel(transform)).toBe(`1:${String(denominator)}`)
    expect(box.width).toBeCloseTo(millimetresToPoints(lengthMm) / denominator)
    expect(box.height).toBeCloseTo(millimetresToPoints(widthMm) / denominator)
  })
  it('renders exact nominal dimensions, full metadata and per-cell scales without touching other sheets', async () => {
    const { pdf, font, bold } = await fixture()
    const page = pdf.addPage()
    const text = vi.spyOn(page, 'drawText')
    const rectangle = vi.spyOn(page, 'drawRectangle')
    vi.spyOn(pdf, 'addPage').mockReturnValue(page)
    const input = parts(2).map((part, index) => ({ ...part, lengthMm: index === 0 ? 50 : 500, widthMm: index === 0 ? 20 : 200, grainDirection: 'length' as const }))
    appendPartDrawings(pdf, font, bold, input, 'A4', 'portrait', () => 'Birch plywood', () => {})
    const labels = text.mock.calls.map(([label]) => label)
    expect(labels).toContain('P1 — Shelf 1'); expect(labels).toContain('P2 — Shelf 2')
    expect(labels).toContain('Shelf 1'); expect(labels).toContain('Shelf 2')
    expect(labels).toContain('50 mm'); expect(labels).toContain('20 mm')
    expect(labels).toContain('500 mm'); expect(labels).toContain('200 mm')
    expect(labels).toContain('Quantity: 12')
    expect(labels).toContain('50 × 20 × 18 mm'); expect(labels).toContain('500 × 200 × 18 mm')
    expect(labels).toContain('Birch plywood')
    expect(labels).toContain('1:1')
    expect(labels).toContain('Grain: length')
    expect(labels).toContain('1:10')
    expect(labels.filter(label => label === 'SCALE')).toHaveLength(2)
    expect(labels.filter(label => label === 'SHEET')).toHaveLength(2)
    expect(labels.some(label => label.startsWith('Thickness:') || label.startsWith('Scale '))).toBe(false)
    const shapes = rectangle.mock.calls.map(([options]) => options).filter(options => options?.borderWidth === 0.5 && options.width !== (pdfPageSize('A4', 'portrait').width - 56) / 2)
    expect(shapes).toHaveLength(2)
    expect(shapes[0]?.width).toBeCloseTo(millimetresToPoints(50))
    expect(shapes[1]?.width).toBeCloseTo(millimetresToPoints(50))
  })
  it('keeps narrow-part names complete in the title block, wraps metadata and reduces density safely', async () => {
    const { pdf, font, bold } = await fixture()
    const input = parts(7).map(part => ({ ...part, name: 'Long descriptive shelf name '.repeat(7).trim(), lengthMm: 5000, widthMm: 1 }))
    const material = 'A long material specification '.repeat(6).trim()
    appendPartDrawings(pdf, font, bold, input, 'A4', 'landscape', () => material, () => {})
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(2)
    expect(pdf.getPageCount()).toBeLessThan(7)
  })
  it('rejects unusable cell areas explicitly', () => {
    expect(() => partDrawingCells({ width: 200, height: 200 })).toThrow(RangeError)
    expect(() => partDrawingCells(pdfPageSize('A4', 'portrait'), Number.NaN)).toThrow(RangeError)
  })
})

it.each(['A4', 'A3'] as const)('balances one and two individual drawings across the available %s grid area', paper => {
  for (const orientation of ['portrait', 'landscape'] as const) {
    const size = pdfPageSize(paper, orientation)
    const single = partDrawingCells(size, 170, 1)
    const pair = partDrawingCells(size, 170, 2)
    expect(single).toHaveLength(1); expect(pair).toHaveLength(2)
    expect(single[0]?.width).toBeCloseTo(size.width - 56)
    expect(single[0]?.height).toBeCloseTo(size.height - 96)
    expect(single[0]?.x).toBe(28); expect(single[0]?.y).toBe(36)
    expect(pair[0]?.height).toBe(single[0]?.height)
    expect(pair[0]?.y).toBe(pair[1]?.y)
    expect((pair[0]?.width ?? 0) + (pair[1]?.width ?? 0)).toBeCloseTo(size.width - 56)
    const rect = { xMm: 0, yMm: 0, lengthMm: 200, widthMm: 100 }
    const cell = single[0]
    if (!cell) throw new Error('Missing cell')
    const layout = partDrawingGeometry(rect, cell, 34, 42)
    expect(layout.box.width / layout.box.height).toBeCloseTo(2)
    expect(layout.box.width).toBeCloseTo(millimetresToPoints(200) * layout.transform.scale)
    expect(layout.transform.scale).toBeGreaterThanOrEqual(0.5)
    expect(layout.box.x + layout.box.width / 2).toBeCloseTo(size.width / 2)
  }
})
