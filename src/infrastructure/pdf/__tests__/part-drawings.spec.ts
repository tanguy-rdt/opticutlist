import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import { appendPartDrawings } from '../part-drawings'
import { partDrawingCells, partDrawingGeometry } from '../part-drawing-grid'
import { millimetresToPoints, pdfPageSize } from '../pdf-layout'
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
describe('V1 individual part drawing grid', () => {
  it.each([[0, 0], [1, 1], [6, 1], [7, 2], [14, 3]])('paginates %i definitions into %i portrait sheets without expanding production copies', async (count, sheets) => {
    const { pdf, font, bold } = await fixture()
    const input = parts(count)
    const before = structuredClone(input)
    const frame = vi.fn()
    appendPartDrawings(pdf, font, bold, input, 'A4', 'portrait', frame)
    expect(pdf.getPageCount()).toBe(sheets)
    expect(frame).toHaveBeenCalledTimes(sheets)
    expect(input).toEqual(before)
  })
  it.each(['A4', 'A3'] as const)('reserves one page-wide footer below two-column %s cells in either orientation', paper => {
    for (const orientation of ['portrait', 'landscape'] as const) {
      const size = pdfPageSize(paper, orientation)
      const cells = partDrawingCells(size)
      expect(cells).toHaveLength(paper === 'A4' && orientation === 'landscape' ? 4 : 6)
      for (const [index, cell] of cells.entries()) {
        expect(cell.x).toBe(index % 2 === 0 ? 28 : size.width / 2)
        expect(cell.width).toBeCloseTo((size.width - 56) / 2)
        expect(cell.y).toBeGreaterThanOrEqual(78)
        expect(cell.y + cell.height).toBeLessThanOrEqual(size.height - 16)
        for (const dimensions of [{ lengthMm: 100, widthMm: 80 }, { lengthMm: 2500, widthMm: 1250 }, { lengthMm: 0.001, widthMm: 5000 }, { lengthMm: 5000, widthMm: 0.001 }]) {
          const { box, transform } = partDrawingGeometry({ xMm: 0, yMm: 0, ...dimensions }, cell, 34, 0)
          expect(box.x - 33).toBeGreaterThan(cell.x)
          expect(box.y - 33).toBeGreaterThan(cell.y)
          expect(box.x + box.width + 3).toBeLessThan(cell.x + cell.width)
          expect(box.y + box.height + 3).toBeLessThan(cell.y + cell.height - 34)
          expect(box.width / box.height).toBeCloseTo(dimensions.lengthMm / dimensions.widthMm)
          expect(box.width).toBeCloseTo(millimetresToPoints(dimensions.lengthMm) * transform.scale)
          expect(box.height).toBeCloseTo(millimetresToPoints(dimensions.widthMm) * transform.scale)
        }
      }
    }
  })
  it.each(['portrait', 'landscape'] as const)('renders multiple dimensioned drawings with one footer in %s', async orientation => {
    const { pdf, font, bold } = await fixture()
    const size = pdfPageSize('A4', orientation)
    const page = pdf.addPage([size.width, size.height])
    const text = vi.spyOn(page, 'drawText')
    const rectangle = vi.spyOn(page, 'drawRectangle')
    const lines = vi.spyOn(page, 'drawLine')
    vi.spyOn(pdf, 'addPage').mockReturnValue(page)
    const input = parts(2).map((part, index) => ({ ...part, lengthMm: index === 0 ? 50 : 500, widthMm: index === 0 ? 20 : 200, grainDirection: 'length' as const }))
    const frame = vi.fn()
    appendPartDrawings(pdf, font, bold, input, 'A4', orientation, frame)
    const labels = text.mock.calls.map(([label]) => label)
    expect(labels).toContain('P1 — Shelf 1'); expect(labels).toContain('P2 — Shelf 2')
    expect(labels).toContain('50 mm'); expect(labels).toContain('20 mm')
    expect(labels).toContain('500 mm'); expect(labels).toContain('200 mm')
    expect(labels.some(label => label.includes('Thickness: 18 mm'))).toBe(true)
    expect(labels.filter(label => label === 'SCALE')).toHaveLength(1)
    expect(labels.filter(label => label === 'SHEET')).toHaveLength(1)
    expect(labels).not.toContain('Workshop cabinet')
    expect(labels.filter(label => label === 'UNITS')).toHaveLength(1)
    expect(labels).toContain('N/A'); expect(labels).not.toContain('Varies')
    expect(frame).toHaveBeenCalledOnce()
    const shapes = rectangle.mock.calls.map(([options]) => options).filter(options => options?.borderColor && options.width !== size.width - 56)
    expect(shapes).toHaveLength(2)
    expect(shapes[0]?.width).toBeCloseTo(millimetresToPoints(50))
    expect(shapes[1]?.width).toBeCloseTo(millimetresToPoints(500) / (orientation === 'portrait' ? 10 : 5))
    const first = shapes[0]
    if (first?.x === undefined || first.y === undefined) throw new Error('Missing drawing')
    const cells = partDrawingCells(size, 170, 2)
    const firstCell = cells[0]
    if (!firstCell) throw new Error('Missing cell')
    expect(first.x + (first.width ?? 0) / 2).toBeCloseTo(firstCell.x + firstCell.width / 2)
    expect(lines.mock.calls.some(([line]) => line.thickness === 0.2 && line.start.x === size.width / 2 && line.end.x === size.width / 2)).toBe(true)
    // The page type is only in the shared bottom block, never in a top heading.
    expect(text.mock.calls.find(([label]) => label === 'UNITS')?.[1]?.y).toBeLessThan(78)
  })
  it('wraps long labels above narrow parts and paginates without dropping definitions', async () => {
    const { pdf, font, bold } = await fixture()
    const input = parts(7).map(part => ({ ...part, name: 'Long descriptive shelf name '.repeat(7).trim(), lengthMm: 5000, widthMm: 1 }))
    appendPartDrawings(pdf, font, bold, input, 'A4', 'landscape', () => {})
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(2)
    expect(pdf.getPageCount()).toBeLessThan(7)
  })
  it('keeps even a single drawing in the two-column grid and rejects unusable areas', () => {
    const size = pdfPageSize('A4', 'portrait')
    const [single] = partDrawingCells(size, 170, 1)
    expect(single?.width).toBeCloseTo((size.width - 56) / 2)
    expect(() => partDrawingCells({ width: 200, height: 200 })).toThrow(RangeError)
    expect(() => partDrawingCells(size, Number.NaN)).toThrow(RangeError)
    expect(() => partDrawingCells(size, 170, 6, -1)).toThrow(RangeError)
  })
})

it.each(['portrait', 'landscape'] as const)('keeps tiny and extreme drawings, dimension labels and external arrows inside the %s frame', async orientation => {
  const { pdf, font, bold } = await fixture()
  const size = pdfPageSize('A4', orientation)
  const page = pdf.addPage([size.width, size.height])
  vi.spyOn(pdf, 'addPage').mockReturnValue(page)
  const text = vi.spyOn(page, 'drawText')
  const line = vi.spyOn(page, 'drawLine')
  const input = parts(4).map((part, index) => ({ ...part, lengthMm: [0.001, 5000, 0.001, 200][index] ?? 1, widthMm: [5000, 0.001, 0.001, 100][index] ?? 1 }))
  appendPartDrawings(pdf, font, bold, input, 'A4', orientation, () => {})
  for (const [label, options] of text.mock.calls) {
    if (!options?.font || options.x === undefined || options.y === undefined || !options.size) throw new Error('Missing text bounds')
    const rotated = options.rotate?.angle === 90
    const width = options.font.widthOfTextAtSize(label, options.size)
    expect(options.x).toBeGreaterThanOrEqual(28)
    expect(options.x + (rotated ? 0 : width)).toBeLessThanOrEqual(size.width - 28)
    expect(options.y).toBeGreaterThan(36)
    expect(options.y + (rotated ? width : options.size)).toBeLessThan(size.height - 16)
  }
  for (const [segment] of line.mock.calls) for (const point of [segment.start, segment.end]) {
    expect(point.x).toBeGreaterThanOrEqual(28)
    expect(point.x).toBeLessThanOrEqual(size.width - 28)
    expect(point.y).toBeGreaterThanOrEqual(36)
    expect(point.y).toBeLessThanOrEqual(size.height - 16)
  }
  expect(text.mock.calls.filter(([label]) => label === '0.001 mm')).toHaveLength(4)
})

it.each([1, 2, 3, 4, 6])('uses consistent compact rows for %i parts in both orientations and paper sizes', async count => {
  for (const paper of ['A4', 'A3'] as const) for (const orientation of ['portrait', 'landscape'] as const) {
    const size = pdfPageSize(paper, orientation)
    const full = partDrawingCells(size, 170, 6, 52)
    const cells = partDrawingCells(size, 170, count, 52)
    const height = full[0]?.height
    if (!height) throw new Error('Missing full-grid cell')
    expect(cells).toHaveLength(Math.min(count, full.length))
    for (const [index, cell] of cells.entries()) {
      expect(cell.height).toBe(height)
      expect(cell.y + cell.height).toBeCloseTo(size.height - 16 - Math.floor(index / 2) * height)
      expect(cell.x).toBe(index % 2 === 0 ? 28 : size.width / 2)
    }
    if (count <= 2) expect(cells[0]?.y).toBeGreaterThan(78)
    const { pdf, font, bold } = await fixture()
    const frame = vi.fn()
    const input = parts(count)
    appendPartDrawings(pdf, font, bold, input, paper, orientation, frame)
    expect(pdf.getPageCount()).toBe(Math.ceil(count / full.length))
    expect(frame).toHaveBeenCalledTimes(Math.ceil(count / full.length))
  }
})

it.each([1, 2, 3, 4, 6])('draws lighter separators only around the populated rows for %i parts', async count => {
  const { pdf, font, bold } = await fixture()
  const size = pdfPageSize('A4', 'portrait')
  const page = pdf.addPage([size.width, size.height])
  vi.spyOn(pdf, 'addPage').mockReturnValue(page)
  const lines = vi.spyOn(page, 'drawLine')
  const rectangles = vi.spyOn(page, 'drawRectangle')
  appendPartDrawings(pdf, font, bold, parts(count), 'A4', 'portrait', () => {})
  const outer = rectangles.mock.calls.find(([box]) => box?.width === size.width - 56)?.[0]
  expect(outer?.borderWidth).toBe(0.5)
  const grid = lines.mock.calls.map(([line]) => line).filter(line => line.thickness === 0.2)
  expect(grid.length).toBeGreaterThan(1)
  for (const line of grid) expect(line.color).toEqual({ type: 'RGB', red: 0.8, green: 0.8, blue: 0.8 })
  expect(outer?.borderColor).toEqual({ type: 'RGB', red: 0.5, green: 0.5, blue: 0.5 })
  const cells = partDrawingCells(size, 170, count, 52)
  const bottom = cells.at(-1)?.y
  expect(grid.find(line => line.start.x === size.width / 2 && line.end.x === size.width / 2)?.start.y).toBe(bottom)
  if (bottom === undefined) throw new Error('Missing grid bottom')
  for (const line of grid) expect(Math.min(line.start.y, line.end.y)).toBeGreaterThanOrEqual(bottom)
  for (const [index, cell] of cells.entries()) {
    if (index % 2 !== 0 || cell.y === 88) continue
    expect(grid.some(line => line.start.x === 28 && line.end.x === size.width - 28 && line.start.y === cell.y && line.end.y === cell.y)).toBe(true)
  }
})
