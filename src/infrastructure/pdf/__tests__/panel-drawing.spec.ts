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
      const { document } = await fixture({ ...pdfRequest, pageSize, orientation })
      const layout = layoutPanelDrawing(document)
      const { panelBox: box, transform, size } = layout
      expect(transform.scale).toBe(1)
      expect(scaleLabel(transform)).toBe('1:1')
      expect(box.width).toBeCloseTo(millimetresToPoints(100))
      expect(box.height).toBeCloseTo(millimetresToPoints(80))
      expect(box.x + box.width / 2).toBeCloseTo(size.width / 2)
      expect(box.y - 33).toBeGreaterThan(120)
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
    expect(labels).toContain('30 × 50 mm / 90°')
    expect(labels).toContain('100 mm'); expect(labels).toContain('80 mm')
    expect(labels).toContain('Kerf: 2 mm'); expect(labels).toContain('Edge margin: 5 mm')
    expect(labels).not.toContain('Small parts / positions from top-left origin (mm)')
    const shape = pdfRect(document.scene.parts[0]?.region ?? document.scene.panel, drawing.transform)
    const name = text.mock.calls.find(([label]) => label === 'Shelf')?.[1]
    expect(name?.x).toBeGreaterThan(shape.x)
    expect(name?.y).toBeGreaterThan(shape.y)
    expect(name?.y).toBeLessThan(shape.y + shape.height)
    const grainEnd = { x: shape.x + shape.width - 4, y: shape.y + shape.height - 16 }
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

it('keeps every tiny-part reference inside its exact rectangle without a small-parts list or leaders', async () => {
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
  const labels = text.mock.calls.filter(([label]) => label.startsWith('P1.'))
  expect(labels).toHaveLength(30)
  for (const [index, [text, options]] of labels.entries()) {
    const part = document.scene.parts[index]
    if (!part || !options?.size) throw new Error('Missing label geometry')
    const box = pdfRect(part.region, drawing.transform)
    expect(options.x).toBeGreaterThanOrEqual(box.x)
    expect((options.x ?? 0) + bold.widthOfTextAtSize(text, options.size)).toBeLessThanOrEqual(box.x + box.width)
    expect(options.y).toBeGreaterThanOrEqual(box.y)
    expect((options.y ?? 0) + bold.heightAtSize(options.size, { descender: false })).toBeLessThanOrEqual(box.y + box.height)
  }
  expect(text.mock.calls.some(([label]) => label.includes('Small parts') || label.includes('Position:'))).toBe(false)
  for (const [stroke] of line.mock.calls) {
    if (stroke.thickness !== 0.25 && stroke.start.x !== stroke.end.x && stroke.start.y !== stroke.end.y) {
      expect(Math.abs(stroke.start.x - stroke.end.x)).toBeLessThanOrEqual(5)
      expect(Math.abs(stroke.start.y - stroke.end.y)).toBeLessThanOrEqual(5)
    }
  }
  expect(text.mock.calls.every(([label]) => !label.includes('validation') && !label.includes(document.panel.id))).toBe(true)
})

it('uses an accurately stated reduction for large panels without annotation-dependent reductions', async () => {
  const panel = { ...pdfRequest.panel, lengthMm: 2500, widthMm: 1250 }
  const optimized = optimizePanel({ panel, parts: [...pdfRequest.parts], settings: pdfRequest.settings })
  if (!optimized.ok) throw new Error(optimized.error.kind)
  const { document } = await fixture({ ...pdfRequest, panel, plan: optimized.plan })
  const layout = layoutPanelDrawing(document)
  expect(layout.transform.scale).toBeLessThan(1)
  expect(layout.panelBox.width).toBeCloseTo(millimetresToPoints(2500) * layout.transform.scale)
  expect(layout.panelBox.height).toBeCloseTo(millimetresToPoints(1250) * layout.transform.scale)
  expect(scaleLabel(layout.transform)).not.toBe('1:1')
  const before = structuredClone(document)
  expect(layoutPanelDrawing({ ...document, scene: { ...document.scene, parts: [] } }).transform).toEqual(layout.transform)
  expect(document).toEqual(before)
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

it.each(['A4', 'A3'] as const)('selects the largest fitting scale for the same 200 mm panel on %s and keeps all readable labels inside', async pageSize => {
  const base = pdfRequest.parts[0]
  if (!base) throw new Error('Missing part')
  const part = partSchema.parse({ ...base, name: 'Side', lengthMm: 50, widthMm: 50, quantity: 4, grainDirection: 'length', rotation: 'forbidden' })
  const panel = { ...pdfRequest.panel, lengthMm: 200, widthMm: 200, grainDirection: 'length' as const }
  const result = optimizePanel({ panel, parts: [part], settings: pdfRequest.settings })
  if (!result.ok) throw new Error(result.error.kind)
  for (const orientation of ['portrait', 'landscape'] as const) {
    const { document, page, font, bold } = await fixture({ ...pdfRequest, pageSize, orientation, panel, parts: [part], plan: result.plan })
    const text = vi.spyOn(page, 'drawText')
    const before = structuredClone(document)
    const layout = drawPanelSheet(page, font, bold, document, 'Panel 1')
    const expected = pageSize === 'A3' && orientation === 'portrait' ? 1 : 0.5
    expect(layout.transform.scale).toBe(expected)
    expect(layout.scale).toBe(expected === 1 ? '1:1' : '1:2')
    expect(layout.panelBox.width).toBeCloseTo(millimetresToPoints(200) * expected)
    expect(layout.panelBox.height).toBeCloseTo(layout.panelBox.width)
    if (expected < 1) expect(millimetresToPoints(200) > layout.available.width || millimetresToPoints(200) > layout.available.height).toBe(true)
    const boxes = document.scene.parts.map(placed => pdfRect(placed.region, layout.transform))
    const labels = text.mock.calls.filter(([label]) => label.startsWith('P1.') || label === 'Side' || label === '50 × 50 mm')
    expect(labels).toHaveLength(12)
    for (const [label, options] of labels) {
      if (options?.x === undefined || options.y === undefined || !options.size) throw new Error('Missing label position')
      const selected = label === 'Side' ? bold : font
      const right = options.x + selected.widthOfTextAtSize(label, options.size)
      const top = options.y + selected.heightAtSize(options.size, { descender: false })
      expect(boxes.some(box => options.x !== undefined && options.y !== undefined && options.x >= box.x && right <= box.x + box.width && options.y >= box.y && top <= box.y + box.height)).toBe(true)
    }
    expect(text.mock.calls.some(([label]) => label.includes('Small parts') || label.includes('Position:'))).toBe(false)
    expect(document).toEqual(before)
  }
})

it('reserves an outside grain marker only when present, allowing an ungrained 200 mm A3 landscape panel at 1:1', async () => {
  const panel = { ...pdfRequest.panel, lengthMm: 200, widthMm: 200, grainDirection: 'none' as const }
  const result = optimizePanel({ panel, parts: [...pdfRequest.parts], settings: pdfRequest.settings })
  if (!result.ok) throw new Error(result.error.kind)
  const { document } = await fixture({ ...pdfRequest, panel, plan: result.plan, pageSize: 'A3', orientation: 'landscape' })
  const layout = layoutPanelDrawing(document)
  expect(layout.transform.scale).toBe(1)
  expect(layout.panelBox.y - 33).toBeGreaterThan(104)
  expect(layout.panelBox.y + layout.panelBox.height).toBeLessThan(layout.size.height - 112)
})
