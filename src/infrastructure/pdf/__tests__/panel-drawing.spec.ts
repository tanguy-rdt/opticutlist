import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import { createCuttingPlanPdfService, type CuttingPlanPdfDocument } from '../../../application/export/cutting-plan-pdf-service'
import { pdfRequest } from '../../../application/export/__tests__/pdf-fixtures'
import { drawPanelSheet, layoutPanelDrawing } from '../panel-drawing'
import { millimetresToPoints, pdfRect } from '../pdf-layout'
import { scaleLabel } from '../technical-drawing'
import { swapInput, swapPlan } from '../../../domain/cutting-tree/__tests__/editing-fixtures'
import { optimizePanel } from '../../../domain/optimizer/optimize-panel'
import { partSchema } from '../../../domain/model/part'
import { freezeDeep } from '../../../domain/cutting-tree/__tests__/viewer-fixtures'

async function fixture(request = pdfRequest) {
  let document: CuttingPlanPdfDocument | undefined
  await createCuttingPlanPdfService({ generate(input) { document = input; return Promise.resolve(new Uint8Array()) } }).export(request)
  if (!document) throw new Error('Fixture must pass independent validation')
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const page = pdf.addPage()
  return { document, pdf, page, font, bold }
}
describe('One-panel technical sheet', () => {
  it.each(['A4', 'A3'] as const)('keeps %s panel geometry, dimensions and title-block clearance correct in both orientations', async pageSize => {
    for (const orientation of ['portrait', 'landscape'] as const) {
      const { document, font } = await fixture({ ...pdfRequest, pageSize, orientation })
      const layout = layoutPanelDrawing(document, font)
      const { panelBox: box, transform, size } = layout
      expect(transform.scale).toBe(1)
      expect(scaleLabel(transform)).toBe('1:1')
      expect(box.width).toBeCloseTo(millimetresToPoints(100))
      expect(box.height).toBeCloseTo(millimetresToPoints(80))
      expect(box.x + box.width / 2).toBeCloseTo(size.width / 2)
      expect(box.y - 33).toBeGreaterThan(120 + layout.labelHeight)
      expect(box.x - 33).toBeGreaterThanOrEqual(36)
      expect(box.x + box.width).toBeLessThan(size.width - 36)
      expect(box.y + box.height + 43).toBeLessThan(size.height - 100)
      const part = pdfRect({ xMm: 5, yMm: 5, lengthMm: 30, widthMm: 50 }, transform)
      expect(part.x - box.x).toBeCloseTo(millimetresToPoints(5))
      expect(box.y + box.height - part.y - part.height).toBeCloseTo(millimetresToPoints(5))
      expect(part.width).toBeCloseTo(millimetresToPoints(30))
      expect(part.height).toBeCloseTo(millimetresToPoints(50))
    }
  })
  it('renders exact rotated dimensions, meaningful grain, parameters and internal names without mutating the scene', async () => {
    const { document, page, font, bold } = await fixture()
    const before = structuredClone(document)
    freezeDeep(document)
    const text = vi.spyOn(page, 'drawText')
    const line = vi.spyOn(page, 'drawLine')
    const drawing = drawPanelSheet(page, font, bold, document, 'Panel 1')
    const labels = text.mock.calls.map(([label]) => label)
    expect(labels).toContain('Shelf')
    expect(labels).toContain('30 x 50 mm / 90°')
    expect(labels).toContain('100 mm'); expect(labels).toContain('80 mm')
    expect(labels).toContain('Kerf: 2 mm'); expect(labels).toContain('Edge margin: 5 mm')
    expect(labels).not.toContain('Small parts / positions from top-left origin (mm)')
    const shape = pdfRect(document.scene.parts[0]?.region ?? document.scene.panel, drawing.transform)
    const name = text.mock.calls.find(([label]) => label === 'Shelf')?.[1]
    expect(name?.x).toBeGreaterThan(shape.x)
    expect(name?.y).toBeGreaterThan(shape.y)
    expect(name?.y).toBeLessThan(shape.y + shape.height)
    const grainEnd = { x: shape.x + shape.width - 9, y: shape.y + 9 }
    expect(line.mock.calls.some(([options]) => options.end.x === grainEnd.x && options.end.y === grainEnd.y)).toBe(true)
    expect(document).toEqual(before)
  })
  it('clips hatch strokes only to literal waste leaves and preserves exact kerf and margin widths', async () => {
    const { document, page, font, bold } = await fixture()
    const rectangles = vi.spyOn(page, 'drawRectangle')
    const line = vi.spyOn(page, 'drawLine')
    const layout = drawPanelSheet(page, font, bold, document, 'Panel 1')
    const waste = [{ xMm: 5, yMm: 57, lengthMm: 30, widthMm: 18 }, { xMm: 37, yMm: 5, lengthMm: 58, widthMm: 70 }].map(region => pdfRect(region, layout.transform))
    const hatch = line.mock.calls.map(([options]) => options).filter(options => options.thickness === 0.25)
    expect(hatch.length).toBeGreaterThan(10)
    for (const stroke of hatch) {
      expect(waste.some(box => [stroke.start, stroke.end].every(point => point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height))).toBe(true)
    }
    const cuts = rectangles.mock.calls.map(([options]) => options).filter(options => options?.color && 'red' in options.color && options.color.red === 0.38)
    expect(cuts).toHaveLength(2)
    expect(cuts.some(box => box?.width === millimetresToPoints(2))).toBe(true)
    expect(cuts.some(box => box?.height === millimetresToPoints(2))).toBe(true)
    const usable = rectangles.mock.calls.find(([options]) => options?.borderDashArray)?.[0]
    expect((usable?.x ?? 0) - layout.panelBox.x).toBeCloseTo(millimetresToPoints(5))
  })
  it('preserves zero-width cuts as thin separators, without adding physical kerf', async () => {
    const { document, page, font, bold } = await fixture({ ...pdfRequest, ...swapInput, plan: swapPlan })
    const line = vi.spyOn(page, 'drawLine')
    drawPanelSheet(page, font, bold, document, 'Panel 1')
    const zeroCuts = line.mock.calls.map(([options]) => options).filter(options => options.thickness === 0.4 && (options.start.x === options.end.x || options.start.y === options.end.y))
    expect(zeroCuts.length).toBeGreaterThanOrEqual(2)
  })
})

it('keeps tiny-part captions on the same sheet outside the drawing, without cross-part leaders', async () => {
  const basePart = pdfRequest.parts[0]
  if (!basePart) throw new Error('Missing fixture part')
  const parts = [partSchema.parse({ ...basePart, lengthMm: 1, widthMm: 1, grainDirection: 'none', quantity: 30 })]
  const panel = { ...pdfRequest.panel, grainDirection: 'none' as const }
  const optimized = optimizePanel({ panel, parts, settings: pdfRequest.settings })
  if (!optimized.ok) throw new Error(optimized.error.kind)
  const { document, page, font, bold } = await fixture({ ...pdfRequest, panel, parts, plan: optimized.plan })
  const text = vi.spyOn(page, 'drawText')
  const line = vi.spyOn(page, 'drawLine')
  const drawing = drawPanelSheet(page, font, bold, document, 'Panel 1')
  expect(drawing.external).toHaveLength(30)
  const labels = text.mock.calls.filter(([label]) => label.startsWith('P1.'))
  expect(labels).toHaveLength(30)
  for (const [, options] of labels) {
    expect(options?.y).toBeLessThan(drawing.panelBox.y - 33)
    expect(options?.y).toBeGreaterThan(120)
  }
  for (const [stroke] of line.mock.calls) {
    if (stroke.thickness !== 0.25 && stroke.start.x !== stroke.end.x && stroke.start.y !== stroke.end.y) {
      expect(Math.abs(stroke.start.x - stroke.end.x)).toBeLessThanOrEqual(5)
      expect(Math.abs(stroke.start.y - stroke.end.y)).toBeLessThanOrEqual(5)
    }
  }
  expect(text.mock.calls.every(([label]) => !label.includes('validation') && !label.includes(document.panel.id))).toBe(true)
})

it('uses an accurately stated reduction for large panels and rejects unreadable annotation overflow explicitly', async () => {
  const panel = { ...pdfRequest.panel, lengthMm: 2500, widthMm: 1250 }
  const optimized = optimizePanel({ panel, parts: [...pdfRequest.parts], settings: pdfRequest.settings })
  if (!optimized.ok) throw new Error(optimized.error.kind)
  const { document, font } = await fixture({ ...pdfRequest, panel, plan: optimized.plan })
  const layout = layoutPanelDrawing(document, font)
  expect(layout.transform.scale).toBeLessThan(1)
  expect(layout.panelBox.width).toBeCloseTo(millimetresToPoints(2500) * layout.transform.scale)
  expect(layout.panelBox.height).toBeCloseTo(millimetresToPoints(1250) * layout.transform.scale)
  expect(scaleLabel(layout.transform)).not.toBe('1:1')
  const part = document.scene.parts[0]
  if (!part) throw new Error('Missing placement')
  // Presentation-capacity failure does not add sheets or alter the supplied scene.
  const crowded = { ...document, scene: { ...document.scene, parts: Array.from({ length: 500 }, (_, index) => ({ ...part, key: `tiny-${String(index)}` })) } }
  const before = structuredClone(crowded)
  expect(() => layoutPanelDrawing(crowded, font)).toThrow('Too many tiny-part annotations')
  expect(crowded).toEqual(before)
})

it.each(['length', 'width'] as const)('keeps compact %s grain indicators inside low-height placed parts', async grainDirection => {
  const basePart = pdfRequest.parts[0]
  if (!basePart) throw new Error('Missing fixture part')
  const part = partSchema.parse({ ...basePart, lengthMm: 80, widthMm: 13, grainDirection })
  const panel = { ...pdfRequest.panel, grainDirection }
  const optimized = optimizePanel({ panel, parts: [part], settings: pdfRequest.settings })
  if (!optimized.ok) throw new Error(optimized.error.kind)
  const { document, page, font, bold } = await fixture({ ...pdfRequest, panel, parts: [part], plan: optimized.plan })
  const line = vi.spyOn(page, 'drawLine')
  const drawing = drawPanelSheet(page, font, bold, document, 'Panel 1')
  const placed = document.scene.parts[0]
  if (!placed) throw new Error('Missing placement')
  const box = pdfRect(placed.region, drawing.transform)
  const arrows = line.mock.calls.map(([options]) => options).filter(options => options.thickness === 0.35)
  expect(arrows).toHaveLength(3)
  for (const arrow of arrows) for (const point of [arrow.start, arrow.end]) {
    expect(point.x).toBeGreaterThan(box.x); expect(point.x).toBeLessThan(box.x + box.width)
    expect(point.y).toBeGreaterThan(box.y); expect(point.y).toBeLessThan(box.y + box.height)
  }
})
