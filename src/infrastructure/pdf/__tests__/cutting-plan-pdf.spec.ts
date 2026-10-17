import { pngCover } from './cover-image-fixtures'
import { PDFArray, PDFDocument, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { generateCuttingPlanPdf, generateProjectCuttingPdf, wrapPdfText } from '../cutting-plan-pdf'
import { createCuttingPlanPdfService } from '../../../application/export/cutting-plan-pdf-service'
import { pdfRequest, multiPanelPdfRequest } from '../../../application/export/__tests__/pdf-fixtures'
import { applyPlanEdit, createPlanEditingSession, currentEditingPlan } from '../../../application/optimization/plan-editing-session'
import { rotationInput, rotationPlan, swapInput, swapPlan } from '../../../domain/cutting-tree/__tests__/editing-fixtures'
import { freezeDeep, viewerPart } from '../../../domain/cutting-tree/__tests__/viewer-fixtures'
import { optimizePanel } from '../../../domain/optimizer/optimize-panel'
import { optimizeProject } from '../../../domain/optimizer/optimize-project'
import { partSchema } from '../../../domain/model/part'
import { supplierProductSchema } from '../../../domain/model/supplier-product'
import { validPartInput, validSupplierProductInput } from '../../../domain/model/__tests__/fixtures'

export function pageOperators(pdf: PDFDocument, pageIndex: number): string {
  const contents = pdf.getPage(pageIndex).node.Contents()
  const streams = contents instanceof PDFArray ? contents.asArray().map(ref => {
    const stream = pdf.context.lookup(ref)
    if (!(stream instanceof PDFRawStream)) throw new Error('Expected a PDF content stream')
    return stream
  }) : contents instanceof PDFRawStream ? [contents] : []
  return streams.map(stream => new TextDecoder().decode(decodePDFRawStream(stream).decode())).join('\n')
}
function hasText(operators: string, text: string): boolean { return operators.includes(Buffer.from(text.replaceAll('—', '\x97'), 'latin1').toString('hex').toUpperCase()) }
function isPartDrawing(operators: string): boolean { return hasText(operators, 'SCALE') && hasText(operators, 'Millimeters (mm)') }
function isCuttingDrawing(operators: string): boolean { return [...operators.matchAll(/<([\dA-F]*)> Tj/gu)].some(match => /^Panel [0-9]+ \x97 /u.test(Buffer.from(match[1] ?? '', 'hex').toString('latin1'))) }
async function exportPdf(request = pdfRequest) {
  const result = await createCuttingPlanPdfService({ generate: generateCuttingPlanPdf }).export(request)
  if (!result.ok) throw new Error(result.error.message)
  return PDFDocument.load(result.bytes)
}
describe('Vector cutting plan PDF', () => {
  it.each(['portrait', 'landscape'] as const)('preserves all sheet geometry and project title blocks with a custom cover in %s', async orientation => {
    const request = { ...multiPanelPdfRequest(), orientation, cover: { title: 'Custom cover title', description: 'Fabrication notes', image: pngCover } }
    const before = structuredClone(request)
    const result = await createCuttingPlanPdfService({ generate: generateCuttingPlanPdf, generateProject: generateProjectCuttingPdf }).exportProject(request)
    if (!result.ok) throw new Error(result.error.message)
    const pdf = await PDFDocument.load(result.bytes)
    expect(pdf.getTitle()).toBe('Custom cover title')
    expect(hasText(pageOperators(pdf, 0), 'Custom cover title')).toBe(true)
    expect(pageOperators(pdf, 0)).toMatch(/\bDo\b/u)
    for (const [index, page] of pdf.getPages().entries()) {
      expect(page.getWidth() < page.getHeight()).toBe(orientation === 'portrait')
      if (index) {
        expect(hasText(pageOperators(pdf, index), 'Custom cover title')).toBe(false)
        expect(pageOperators(pdf, index)).not.toMatch(/\bDo\b/u)
      }
    }
    expect(hasText(pageOperators(pdf, 1), 'Workshop project')).toBe(true)
    expect(request).toEqual(before)
  })
  it.each(['portrait', 'landscape'] as const)('exports every multi-panel page in %s A3 with vector paths', async orientation => {
    const request = { ...multiPanelPdfRequest(), pageSize: 'A3' as const, orientation }
    const before = structuredClone(request)
    const result = await createCuttingPlanPdfService({ generate: generateCuttingPlanPdf, generateProject: generateProjectCuttingPdf }).exportProject(request)
    if (!result.ok) throw new Error(result.error.message)
    const pdf = await PDFDocument.load(result.bytes)
    for (const page of pdf.getPages()) {
      expect(page.getWidth()).toBeCloseTo(orientation === 'portrait' ? 841.88976378 : 1190.5511811)
      expect(page.getHeight()).toBeCloseTo(orientation === 'portrait' ? 1190.5511811 : 841.88976378)
    }
    const drawing = pdf.getPages().map((_, index) => pageOperators(pdf, index)).find(isPartDrawing)
    expect(drawing).toMatch(/\bm\b/u)
    expect(drawing).toMatch(/\bl\b/u)
    expect(request).toEqual(before)
  })
  it.each(['portrait', 'landscape'] as const)('exports %s A4 vector paths and text with no raster images', async orientation => {
    const request = structuredClone({ ...pdfRequest, orientation })
    const original = structuredClone(request)
    freezeDeep(request)
    const pdf = await exportPdf(request)
    expect(pdf.getPageCount()).toBe(1)
    const { width, height } = pdf.getPage(0).getSize()
    expect(width).toBeCloseTo(orientation === 'portrait' ? 595.27559055 : 841.88976378)
    expect(height).toBeCloseTo(orientation === 'portrait' ? 841.88976378 : 595.27559055)
    const operators = pageOperators(pdf, 0)
    expect(operators).toMatch(/\bm\b/u)
    expect(operators).toMatch(/\bl\b/u)
    expect(operators).toMatch(/\bS\b/u)
    expect(operators).toMatch(/\bf\b/u)
    expect(operators).toMatch(/\bTj\b/u)
    expect(operators).not.toMatch(/\bDo\b/u)
    for (const [, object] of pdf.context.enumerateIndirectObjects()) expect(object.toString()).not.toContain('/Subtype /Image')
    expect(hasText(operators, 'Birch plywood')).toBe(true)
    expect(hasText(operators, '100 × 80 × 18')).toBe(true)
    expect(operators).toMatch(/\bW\b/u)
    expect(hasText(operators, '30 × 50 mm / 90')).toBe(true)
    expect(hasText(operators, 'Kerf:')).toBe(true)
    expect(request).toEqual(original)
  })
  it('exports the real optimizer output and a manually edited snapshot with correct orientation', async () => {
    const optimized = optimizePanel(rotationInput)
    if (!optimized.ok) throw new Error('No optimized plan')
    const pdf = await exportPdf({ ...pdfRequest, plan: optimized.plan })
    expect(hasText(pageOperators(pdf, 0), 'Shelf')).toBe(true)
    const session = createPlanEditingSession(rotationPlan, rotationInput)
    if (!session.ok) throw new Error(session.error.message)
    const edit = applyPlanEdit(session.session, { kind: 'rotate', copy: { partId: viewerPart.id, copyIndex: 0 } })
    if (!edit.ok) throw new Error(edit.error.message)
    const original = structuredClone(rotationPlan)
    const edited = await exportPdf({ ...pdfRequest, plan: currentEditingPlan(edit.session), edited: true })
    expect(hasText(pageOperators(edited, 0), '50 × 30 mm')).toBe(true)
    expect(hasText(pageOperators(edited, 0), '90°')).toBe(false)
    expect(rotationPlan).toEqual(original)
  })
  it('preserves zero-kerf cuts as vector lines', async () => {
    const pdf = await exportPdf({ ...pdfRequest, ...swapInput, plan: swapPlan })
    expect(pageOperators(pdf, 0)).toMatch(/0\.4 w/u)
    expect(hasText(pageOperators(pdf, 0), 'Kerf: 0 mm')).toBe(true)
  })
  it('keeps a panel on one sheet and reports unplaced demand without duplicate detail pages', async () => {
    const input = { ...rotationInput, parts: [{ ...viewerPart, quantity: 101, name: 'Very long shelf name '.repeat(9).trim() }] }
    const unplaced = [{ partId: viewerPart.id, firstCopyIndex: 1, count: 100, reason: { kind: 'noSpaceLeft' as const } }]
    const pdf = await exportPdf({ ...pdfRequest, ...input, plan: { ...rotationPlan, unplaced }, orientation: 'portrait' })
    expect(pdf.getPageCount()).toBe(1)
    const operators = pageOperators(pdf, 0)
    expect(hasText(operators, '100 copies unplaced')).toBe(false)
    expect(hasText(operators, 'Placed parts -')).toBe(false)
    expect(hasText(operators, '1 / 1')).toBe(true)
  })
  it('wraps long words and names by real font measurements at a readable size', async () => {
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const text = 'Panel with a name ' + 'x'.repeat(128)
    const lines = wrapPdfText(text, font, 10, 160)
    expect(lines.length).toBeGreaterThan(2)
    expect(lines.join('').replaceAll(' ', '')).toBe(text.replaceAll(' ', ''))
    expect(lines.every(line => font.widthOfTextAtSize(line, 10) <= 160)).toBe(true)
  })
  it('returns an explicit font error instead of corrupting unsupported text', async () => {
    const result = await createCuttingPlanPdfService({ generate: generateCuttingPlanPdf }).export({ ...pdfRequest, materialName: '木材' })
    expect(result).toMatchObject({ ok: false, error: { kind: 'generationFailure' } })
    if (result.ok) throw new Error('Unsupported names should fail explicitly')
    expect(result.error.message).toContain('characters unsupported by the built-in PDF font')
  })
})

it('exports each allocated panel on one vector sheet without claiming other-panel copies are unplaced', async () => {
  const part = partSchema.parse({ ...validPartInput, lengthMm: 100, widthMm: 100 })
  const panel = supplierProductSchema.parse({ ...validSupplierProductInput, lengthMm: 100, widthMm: 100 })
  const settings = { kerfMm: 0, edgeMarginMm: 0 }
  const result = optimizeProject({ parts: [part], panels: [{ product: panel, quantity: 2 }], settings })
  if (!result.ok) throw new Error(result.error.message)
  const original = structuredClone(result.plan)
  freezeDeep(result.plan)
  for (const allocation of result.plan.panels) {
    const pdf = await exportPdf({ ...pdfRequest, plan: allocation.plan, panel, parts: [part], settings })
    expect(pageOperators(pdf, 0)).toMatch(/\bm\b/u)
    expect(pageOperators(pdf, 0)).not.toMatch(/\bDo\b/u)
    expect(pdf.getPageCount()).toBe(1)
    expect(hasText(pageOperators(pdf, 0), 'copies unplaced')).toBe(false)
  }
  expect(result.plan).toEqual(original)
})

describe('Complete multi-panel vector PDF', () => {
  it('preserves fabrication section order, consistent identifiers and dated scale-aware drawing title blocks', async () => {
    const request = { ...multiPanelPdfRequest(true), title: 'Workshop cabinet' }
    const result = await createCuttingPlanPdfService({ generate: generateCuttingPlanPdf, generateProject: generateProjectCuttingPdf }).exportProject(request)
    if (!result.ok) throw new Error(result.error.message)
    const pdf = await PDFDocument.load(result.bytes)
    const pages = pdf.getPages().map((_, index) => pageOperators(pdf, index))
    const positions = ['Workshop cabinet', 'Complete parts list', 'Materials and purchasing', 'Panel inventory'].map(title => pages.findIndex(page => hasText(page, title))).concat(pages.findIndex(isPartDrawing), pages.findIndex(page => hasText(page, 'Panel 1 —')))
    expect(positions.every(index => index >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    const firstDrawing = positions[4]
    if (firstDrawing === undefined) throw new Error('Missing drawing')
    expect(isPartDrawing(pages[firstDrawing] ?? '')).toBe(true)
    expect(hasText(pages[firstDrawing] ?? '', 'Millimeters (mm)')).toBe(true)
    expect(hasText(pages[firstDrawing] ?? '', 'Thickness: 18 mm / Qty: 4')).toBe(true)
    expect(hasText(pages[firstDrawing] ?? '', '90 mm')).toBe(true)
    expect(hasText(pages[firstDrawing] ?? '', '80 mm')).toBe(true)
    pages.forEach((operators, index) => {
      if (!hasText(operators, 'SCALE')) return
      expect(hasText(operators, 'Workshop cabinet')).toBe(true)
      expect(hasText(operators, `${String(index + 1)} / ${String(pages.length)}`)).toBe(true)
      expect(hasText(operators, 'Generated:')).toBe(false)
      expect(hasText(operators, 'Actual size / 100%')).toBe(false)
      expect(operators).not.toMatch(/\bDo\b/u)
    })
  })
  it('paginates part grids and keeps tiny-part references inside the one physical panel sheet', async () => {
    const base = multiPanelPdfRequest()
    const product = supplierProductSchema.parse({ ...validSupplierProductInput, lengthMm: 100, widthMm: 100, grainDirection: 'none' })
    const parts = Array.from({ length: 30 }, (_, index) => partSchema.parse({ ...validPartInput, id: `tiny-${String(index)}`, name: `Tiny part ${String(index)}`, lengthMm: 1, widthMm: 1, grainDirection: 'none', quantity: 1 }))
    const settings = { kerfMm: 0, edgeMarginMm: 5 }
    const optimized = optimizeProject({ parts, panels: [{ product, quantity: 1 }], settings })
    if (!optimized.ok) throw new Error(optimized.error.message)
    const request = { ...base, plan: optimized.plan, parts, settings, sources: [{ product: { id: product.id, name: product.name, materialId: product.materialId, lengthMm: product.lengthMm, widthMm: product.widthMm, thicknessMm: product.thicknessMm, grainDirection: product.grainDirection }, quantity: 1, materialName: 'Birch', supplierName: 'Supplier' }], editedPanelIndices: [] }
    const result = await createCuttingPlanPdfService({ generate: generateCuttingPlanPdf, generateProject: generateProjectCuttingPdf }).exportProject(request)
    if (!result.ok) throw new Error(result.error.message)
    const pdf = await PDFDocument.load(result.bytes)
    const pages = pdf.getPages().map((_, index) => pageOperators(pdf, index))
    expect(pages.filter(isPartDrawing)).toHaveLength(8)
    const gridReferences: string[] = []
    for (const [index, operators] of pages.entries()) {
      if (!isPartDrawing(operators)) continue
      const rows = printedText(pdf, index)
      expect(rows.filter(row => row.text === 'SCALE')).toHaveLength(1)
      expect(rows.filter(row => row.text === 'SHEET')).toHaveLength(1)
      expect(rows.filter(row => row.text === 'UNITS')).toHaveLength(1)
      gridReferences.push(...rows.filter(row => /^P[0-9]+ — Tiny part/u.test(row.text)).map(row => row.text.split(/ (?:—|\/) /u)[0] ?? ''))
    }
    expect(gridReferences).toEqual(Array.from({ length: 30 }, (_, index) => `P${String(index + 1)}`))
    expect(pages.some(page => hasText(page, 'Labels continued'))).toBe(false)
    const panelPages = pages.filter(page => isCuttingDrawing(page))
    expect(panelPages).toHaveLength(1)
    for (const number of [1, 15, 30]) expect(hasText(panelPages[0] ?? '', `P${String(number)}`)).toBe(true)
    for (const number of [1, 15, 30]) expect(pages.some(page => isPartDrawing(page) && hasText(page, `P${String(number)}`))).toBe(true)
    for (const [index, page] of pages.entries()) expect(hasText(page, `${String(index + 1)} / ${String(pages.length)}`)).toBe(index > 0)
  })
  it.each(['portrait', 'landscape'] as const)('renders a global summary and every %s panel with no images', async orientation => {
    const request = { ...multiPanelPdfRequest(true), orientation }
    const original = structuredClone(request)
    const service = createCuttingPlanPdfService({ generate: generateCuttingPlanPdf, generateProject: generateProjectCuttingPdf })
    const result = await service.exportProject(request)
    if (!result.ok) throw new Error(result.error.message)
    const pdf = await PDFDocument.load(result.bytes)
    expect(request.plan.panels).toHaveLength(2)
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(5)
    const pages = pdf.getPages().map((_page, index) => pageOperators(pdf, index))
    expect(pages.filter(page => isCuttingDrawing(page))).toHaveLength(request.plan.panels.length)
    expect(pages.some(page => hasText(page, 'Placed parts - oriented dimensions'))).toBe(false)
    expect(hasText(pages[0] ?? '', 'Workshop project')).toBe(true)
    expect(hasText(pages[0] ?? '', 'INCOMPLETE')).toBe(false)
    expect(pages.some(page => hasText(page, 'Unplaced parts'))).toBe(true)
    expect(hasText(pages.join(''), 'Oversized part')).toBe(true)
    for (let index = 1; index <= 2; index += 1) {
      const layout = pages.find(page => hasText(page, `Panel ${String(index)} —`))
      expect(layout).toBeDefined()
      expect(layout).toMatch(/\bm\b/u)
      expect(layout).toMatch(/\bl\b/u)
      expect(layout).toMatch(/\bf\b/u)
      expect(hasText(layout ?? '', '210 × 110 × 18')).toBe(true)
      expect(hasText(layout ?? '', 'Kerf: 2 mm')).toBe(true)
      expect(hasText(layout ?? '', 'Edge margin: 5 mm')).toBe(true)
    }
    for (const [, object] of pdf.context.enumerateIndirectObjects()) expect(object.toString()).not.toContain('/Subtype /Image')
    expect(request).toEqual(original)
  })
})

it.each(['A4', 'A3'] as const)('frames every %s sheet with a fixed title block, complete numbering and no database IDs', async pageSize => {
  for (const orientation of ['portrait', 'landscape'] as const) {
    const request = { ...multiPanelPdfRequest(true), pageSize, orientation }
    const result = await createCuttingPlanPdfService({ generate: generateCuttingPlanPdf, generateProject: generateProjectCuttingPdf }).exportProject(request)
    if (!result.ok) throw new Error(result.error.message)
    const pdf = await PDFDocument.load(result.bytes)
    const texts = pdf.getPages().map((_, index) => pageOperators(pdf, index))
    for (const [index, text] of texts.entries()) {
      if (index === 0) { expect(hasText(text, 'Sheet')).toBe(false); continue }
      expect(hasText(text, `${String(index + 1)} / ${String(pdf.getPageCount())}`)).toBe(true)
      expect(hasText(text, 'Millimeters (mm)')).toBe(isPartDrawing(text))
      expect(hasText(text, 'Workshop project')).toBe(true)
      // Shared title-block top at 78pt and outer border starting at 28,36pt.
      expect(text).toContain('88 m')
      expect(text).toContain('1 0 0 1 28 36 cm')
      expect(text).not.toMatch(/\bDo\b/u)
      for (const part of request.parts) expect(hasText(text, part.id)).toBe(false)
      for (const source of request.sources) { expect(hasText(text, source.product.id)).toBe(false); expect(hasText(text, source.product.materialId)).toBe(false) }
    }
    const lists = texts.find(text => hasText(text, 'Complete parts list')) ?? ''
    expect(hasText(lists, 'Ref')).toBe(true)
    expect(hasText(lists, 'Qty')).toBe(true)
    expect(hasText(lists, 'Workshop shelf')).toBe(true)
    expect(hasText(lists, 'Materials and purchasing')).toBe(true)
    expect(texts.some(text => hasText(text, 'Panel / Part name'))).toBe(true)
  }
})

it('prints known prices from explicit validated export metadata, without changing historical sources', async () => {
  const request = multiPanelPdfRequest()
  const source = request.sources[0]
  if (!source) throw new Error('Missing fixture source')
  const before = structuredClone(request)
  const service = createCuttingPlanPdfService({ generate: generateCuttingPlanPdf, generateProject: generateProjectCuttingPdf })
  const result = await service.exportProject({ ...request, panelPrices: [{ id: source.product.id, price: 19.95, currency: 'EUR' }] })
  if (!result.ok) throw new Error(result.error.message)
  const pdf = await PDFDocument.load(result.bytes)
  const text = pdf.getPages().map((_, index) => pageOperators(pdf, index)).join('')
  expect(hasText(text, '39.90 EUR')).toBe(true)
  expect(hasText(text, '19.95 EUR')).toBe(true)
  expect(request).toEqual(before)
  expect(await service.exportProject({ ...request, panelPrices: [{ id: source.product.id, price: -1, currency: 'EUR' }] })).toMatchObject({ ok: false, error: { kind: 'invalidPlan' } })
  expect(await service.exportProject({ ...request, panelPrices: [{ id: source.product.id, price: 1, currency: 'EUR' }, { id: source.product.id, price: 2, currency: 'EUR' }] })).toMatchObject({ ok: false, error: { kind: 'invalidPlan' } })
})

function printedText(pdf: PDFDocument, page: number) {
  return [...pageOperators(pdf, page).matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm\n<([\dA-F]*)> Tj/gu)].map(match => ({ x: Number(match[1]), y: Number(match[2]), text: Buffer.from(match[3] ?? '', 'hex').toString('latin1').replaceAll('\x97', '—') }))
}

it.each(['A4', 'A3'] as const)('centers the actual project name without extra cover identity text on the %s cover in both orientations', async pageSize => {
  for (const orientation of ['portrait', 'landscape'] as const) {
    const request = { ...multiPanelPdfRequest(true), title: 'Kitchen cabinet', pageSize, orientation }
    const result = await createCuttingPlanPdfService({ generate: generateCuttingPlanPdf, generateProject: generateProjectCuttingPdf }).exportProject(request)
    if (!result.ok) throw new Error(result.error.message)
    const pdf = await PDFDocument.load(result.bytes)
    const page = pdf.getPage(0)
    const texts = printedText(pdf, 0)
    const font = await pdf.embedFont(StandardFonts.HelveticaBold)
    expect(texts).toHaveLength(1)
    expect(texts[0]?.text).toBe(request.title)
    expect((texts[0]?.x ?? 0) + font.widthOfTextAtSize(request.title, 28) / 2).toBeCloseTo(page.getWidth() / 2)
    expect(texts[0]?.y).toBeGreaterThan(36)
    expect(texts[0]?.y).toBeLessThan(page.getHeight() - 36)
    expect(Math.abs((texts[0]?.y ?? 0) + font.heightAtSize(28, { descender: false }) / 2 - page.getHeight() / 2)).toBeLessThan(4)
    expect(pageOperators(pdf, 0)).not.toMatch(/\b(?:S|f|re)\b/u)
  }
})

it('prints consistent table columns, a hierarchical inventory and exact known costs without duplicating panels', async () => {
  const request = multiPanelPdfRequest()
  const source = request.sources[0]
  if (!source) throw new Error('Missing source')
  const result = await createCuttingPlanPdfService({ generate: generateCuttingPlanPdf, generateProject: generateProjectCuttingPdf }).exportProject({ ...request, panelPrices: [{ id: source.product.id, price: 19.95, currency: 'EUR' }] })
  if (!result.ok) throw new Error(result.error.message)
  const pdf = await PDFDocument.load(result.bytes)
  const rows = printedText(pdf, 1)
  const header = rows.find(row => row.text === 'Panel reference')
  const fields = rows.filter(row => row.y === header?.y).map(row => row.text)
  expect(fields).toEqual(['Panel reference', 'Material', 'Dimensions (mm)', 'Qty', 'Supplier / Source', 'Unit price', 'Total'])
  const partsHeader = rows.find(row => row.text === 'Part name')
  expect(rows.filter(row => row.y === partsHeader?.y).map(row => row.text)).toEqual(['Ref', 'Part name', 'Material', 'Dimensions (mm)', 'Qty'])
  expect(rows.filter(row => row.text === 'Panel 1')).toHaveLength(1)
  expect(rows.filter(row => row.text === 'Panel 2')).toHaveLength(1)
  const panel = rows.find(row => row.text === 'Panel 1')
  const child = rows.find(row => row.text === 'P1' && row.y < (panel?.y ?? 0))
  expect(child?.x).toBe((panel?.x ?? 0) + 8)
  expect(rows.filter(row => row.y === child?.y).map(row => row.text)).toEqual(['P1', 'Workshop shelf', '', '90 × 80 × 18 mm', '2'])
  expect(rows.filter(row => row.text === '39.90 EUR')).toHaveLength(2) // one purchasing row and one total
  expect(rows.filter(row => row.text === 'TOTAL:')).toHaveLength(1)
  const priceHeader = rows.find(row => row.text === 'Unit price')
  const price = rows.find(row => row.text === '19.95 EUR')
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  expect((price?.x ?? 0) + font.widthOfTextAtSize('19.95 EUR', 8)).toBeCloseTo((priceHeader?.x ?? 0) + bold.widthOfTextAtSize('Unit price', 8))
  const all = pdf.getPages().flatMap((_, index) => printedText(pdf, index)).map(row => row.text).join('\n')
  expect(all).not.toContain('Not available'); expect(all).not.toContain('Parts grouped by material')
  expect(all).not.toContain('Utilization'); expect(all).not.toContain('Waste:')
  const panelPages = pdf.getPages().map((_, index) => printedText(pdf, index)).filter(page => page.some(row => /^Panel [0-9]+ — /u.test(row.text)))
  expect(panelPages).toHaveLength(2)
  expect(panelPages.every(page => page.some(row => row.text === 'Workshop shelf') && page.some(row => row.text === '90 × 80 mm'))).toBe(true)
})

it('wraps long project names on the cover without adding content or clipping', async () => {
  const request = { ...multiPanelPdfRequest(), title: 'Kitchen cabinet '.repeat(12).trim(), orientation: 'landscape' as const }
  const result = await createCuttingPlanPdfService({ generate: generateCuttingPlanPdf, generateProject: generateProjectCuttingPdf }).exportProject(request)
  if (!result.ok) throw new Error(result.error.message)
  const pdf = await PDFDocument.load(result.bytes)
  const font = await pdf.embedFont(StandardFonts.HelveticaBold)
  const page = pdf.getPage(0)
  const texts = printedText(pdf, 0)
  expect(texts.length).toBeGreaterThan(1)
  expect(texts.map(row => row.text).join(' ')).toBe(request.title)
  for (const text of texts) {
    expect(text.x).toBeGreaterThanOrEqual(36)
    expect(text.x + font.widthOfTextAtSize(text.text, 28)).toBeLessThanOrEqual(page.getWidth() - 36)
    expect(text.y).toBeGreaterThan(36); expect(text.y).toBeLessThan(page.getHeight() - 36)
  }
})


it.each(['A4', 'A3'] as const)('matches every physical panel table instance to its own drawn copy references on %s', async pageSize => {
  for (const orientation of ['portrait', 'landscape'] as const) {
    const request = { ...multiPanelPdfRequest(), pageSize, orientation }
    const result = await createCuttingPlanPdfService({ generate: generateCuttingPlanPdf, generateProject: generateProjectCuttingPdf }).exportProject(request)
    if (!result.ok) throw new Error(result.error.message)
    const pdf = await PDFDocument.load(result.bytes)
    const pages = pdf.getPages().map((_, index) => ({ text: pageOperators(pdf, index), rows: printedText(pdf, index) })).filter(page => isCuttingDrawing(page.text))
    expect(pages).toHaveLength(request.plan.panels.length)
    const references: string[] = []
    for (const [index, page] of pages.entries()) {
      const panel = request.plan.panels[index]
      if (!panel) throw new Error('Missing allocated panel')
      expect(page.rows.filter(row => row.text === `Panel ${String(index + 1)} — Birch plywood`)).toHaveLength(1)
      const entries = page.rows.filter(row => /^P[0-9]+[.][0-9]+ (?:—|\/) /u.test(row.text))
      expect(entries.map(row => row.text)).toEqual(panel.plan.placements.map(placed => `P1.${String(placed.copyIndex + 1)} / Workshop shelf`))
      for (const entry of entries) {
        const row = page.rows.filter(text => text.y === entry.y && text.x < pdf.getPage(0).getWidth() - 28)
        expect(row.map(text => text.text)).toEqual([entry.text, '90 × 80 × 18 mm'])
        const ref = entry.text.split(/ (?:—|\/) /u)[0]
        if (!ref) throw new Error('Missing copy reference')
        expect(page.rows.some(text => text.y >= 200 && text.text === ref)).toBe(true)
        references.push(ref)
      }
    }
    expect(references.sort()).toEqual(['P1.1', 'P1.2', 'P1.3', 'P1.4'])
  }
})

it.each(['A4', 'A3'] as const)('continues a long copy table on %s without duplicating the diagram or losing rows', async pageSize => {
  for (const orientation of ['portrait', 'landscape'] as const) {
    const part = partSchema.parse({ ...validPartInput, name: 'Tiny panel insert with a long descriptive fabrication name', quantity: 80, lengthMm: 1, widthMm: 1, grainDirection: 'none' })
    const panel = { ...pdfRequest.panel, grainDirection: 'none' as const }
    const settings = { kerfMm: 0, edgeMarginMm: 5 }
    const optimized = optimizePanel({ panel, parts: [part], settings })
    if (!optimized.ok) throw new Error(optimized.error.kind)
    const pdf = await exportPdf({ ...pdfRequest, pageSize, orientation, panel, parts: [part], settings, plan: optimized.plan })
    expect(pdf.getPageCount()).toBeGreaterThan(1)
    const pages = pdf.getPages().map((_, index) => ({ operators: pageOperators(pdf, index), rows: printedText(pdf, index) }))
    expect(pages.filter(page => isCuttingDrawing(page.operators))).toHaveLength(1)
    const entries = pages.flatMap(page => page.rows.filter(row => /^P1[.][0-9]+ (?:—|\/) /u.test(row.text)))
    expect(entries).toHaveLength(80)
    expect(entries.map(row => row.text.split(/ (?:—|\/) /u)[0])).toEqual(Array.from({ length: 80 }, (_, index) => `P1.${String(index + 1)}`))
    for (const [index, page] of pages.entries()) {
      expect(hasText(page.operators, 'Panel / Part')).toBe(false)
      expect(hasText(page.operators, 'Dimensions (mm)')).toBe(index > 0)
      expect(hasText(page.operators, `${String(index + 1)} / ${String(pages.length)}`)).toBe(true)
      if (index > 0) {
        expect(hasText(page.operators, 'Parts continued')).toBe(true)
        expect(hasText(page.operators, '100 mm')).toBe(false)
      }
      for (const entry of page.rows.filter(row => /^P1[.][0-9]+ (?:—|\/) /u.test(row.text))) {
        expect(page.rows.filter(row => row.y === entry.y && row.x < pdf.getPage(index).getWidth() - 28).map(row => row.text)).toEqual([entry.text, '1 × 1 × 18 mm'])
        expect(entry.y).toBeGreaterThan(index > 0 ? 120 : 36)
      }
    }
  }
})


it.each(['A4', 'A3'] as const)('uses two panel columns, one material identification and centered SCALE/SHEET cells on %s', async pageSize => {
  for (const orientation of ['portrait', 'landscape'] as const) {
    const pdf = await exportPdf({ ...pdfRequest, pageSize, orientation })
    const rows = printedText(pdf, 0)
    expect(rows.some(row => row.text === 'Qty')).toBe(false)
    expect(rows.filter(row => row.text.endsWith(' — Birch plywood'))).toHaveLength(1)
    expect(rows.some(row => row.text.startsWith('Panel 1 —'))).toBe(true)
    const scale = rows.find(row => row.text === 'SCALE')
    const sheet = rows.find(row => row.text === 'SHEET')
    const value = rows.find(row => row.text === '1 / 1')
    const actualScale = rows.find(row => row.text === '1:1')
    if (!scale || !sheet || !value || !actualScale) throw new Error('Missing technical cells')
    expect(scale.y).toBe(sheet.y)
    expect(actualScale.y).toBe(value.y)
    expect(scale.x).toBeLessThan(sheet.x)
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const right = pdf.getPage(0).getWidth() - 28
    const half = 145 / 2
    expect(scale.x + font.widthOfTextAtSize('SCALE', 6) / 2).toBeCloseTo(right - half * 1.5)
    expect(sheet.x + font.widthOfTextAtSize('SHEET', 6) / 2).toBeCloseTo(right - half / 2)
    expect(actualScale.x + font.widthOfTextAtSize('1:1', 8) / 2).toBeCloseTo(right - half * 1.5)
    expect(value.x + (await pdf.embedFont(StandardFonts.HelveticaBold)).widthOfTextAtSize('1 / 1', 8) / 2).toBeCloseTo(right - half / 2)
    const operators = pageOperators(pdf, 0)
    expect(operators).toContain('28 88 m')
    expect(operators).toContain(`${String(right - half)} 36 m`)
    expect(rows.some(row => row.text.startsWith('Scale ') || row.text.startsWith('Sheet '))).toBe(false)
  }
})

it.each(['A4', 'A3'] as const)('uses one shared project title block with N/A for independently scaled drawings on %s', async pageSize => {
  for (const orientation of ['portrait', 'landscape'] as const) {
    const base = multiPanelPdfRequest()
    const source = base.sources[0]
    if (!source) throw new Error('Missing source')
    const product = supplierProductSchema.parse({ ...validSupplierProductInput, ...source.product, lengthMm: 1000, widthMm: 1000 })
    const parts = [partSchema.parse({ ...validPartInput, id: 'small-footprint', lengthMm: 50, widthMm: 20, quantity: 1, grainDirection: 'none' }), partSchema.parse({ ...validPartInput, id: 'large-footprint', lengthMm: 500, widthMm: 200, quantity: 1, grainDirection: 'none' })]
    const plan = optimizeProject({ parts, panels: [{ product, quantity: 1 }], settings: base.settings })
    if (!plan.ok) throw new Error(plan.error.message)
    const result = await createCuttingPlanPdfService({ generate: generateCuttingPlanPdf, generateProject: generateProjectCuttingPdf }).exportProject({ ...base, pageSize, orientation, parts, plan: plan.plan, sources: [{ ...source, product, quantity: 1 }] })
    if (!result.ok) throw new Error(result.error.message)
    const pdf = await PDFDocument.load(result.bytes)
    const index = pdf.getPages().findIndex((_, index) => isPartDrawing(pageOperators(pdf, index)))
    expect(index).toBeGreaterThan(0)
    const rows = printedText(pdf, index)
    const footer = rows.filter(row => row.y < 150)
    expect(footer.filter(row => row.text === 'SCALE')).toHaveLength(1)
    expect(footer.filter(row => row.text === 'SHEET')).toHaveLength(1)
    expect(footer.filter(row => row.text === `${String(index + 1)} / ${String(pdf.getPageCount())}`)).toHaveLength(1)
    expect(footer.filter(row => row.text === 'N/A')).toHaveLength(1)
    expect(footer.filter(row => row.text === 'Varies')).toHaveLength(0)
    expect(footer.filter(row => row.text === base.title)).toHaveLength(1)
    expect(footer.filter(row => row.text === 'Millimeters (mm)')).toHaveLength(1)
    expect(rows.some(row => /Project:|Generated:|Actual size/u.test(row.text))).toBe(false)
    expect(rows.filter(row => row.text === 'UNITS')).toHaveLength(1)
    expect(rows.find(row => row.text === 'UNITS')?.y).toBeLessThan(78)
    expect(footer.some(row => row.text.includes('Qty:'))).toBe(false)
    expect(rows.filter(row => row.text === '50 mm')).toHaveLength(1)
    expect(rows.filter(row => row.text === '500 mm')).toHaveLength(1)
    expect(pageOperators(pdf, index)).toContain('1 0 0 1 28 36 cm') // footer shares the technical frame's bottom edge
  }
})


it('keeps project metadata and N/A scale in the title block, with production metadata in drawing cells', async () => {
  const request = multiPanelPdfRequest()
  const result = await createCuttingPlanPdfService({ generate: generateCuttingPlanPdf, generateProject: generateProjectCuttingPdf }).exportProject(request)
  if (!result.ok) throw new Error(result.error.message)
  const pdf = await PDFDocument.load(result.bytes)
  const index = pdf.getPages().findIndex((_, index) => isPartDrawing(pageOperators(pdf, index)))
  const rows = printedText(pdf, index)
  const footer = rows.filter(row => row.y < 150)
  expect(footer.filter(row => row.text === 'SCALE')).toHaveLength(1)
  expect(footer.filter(row => row.text === 'SHEET')).toHaveLength(1)
  expect(footer.filter(row => row.text === 'N/A')).toHaveLength(1)
  expect(footer.filter(row => row.text === `${String(index + 1)} / ${String(pdf.getPageCount())}`)).toHaveLength(1)
  expect(footer.some(row => row.text === 'Workshop project')).toBe(true)
  expect(rows.some(row => row.text.includes('Thickness: 18 mm / Qty: 4') && row.y > 78)).toBe(true)
  expect(footer.some(row => row.text.startsWith('Scale ') || row.text.startsWith('Thickness:'))).toBe(false)
})


it.each(['portrait', 'landscape'] as const)('keeps the shared fabrication footer fixed with a bounded long project name in %s', async orientation => {
  const request = { ...multiPanelPdfRequest(), orientation, title: 'Workshop cabinetry and storage for the north wing renovation '.repeat(15).trim() }
  const result = await createCuttingPlanPdfService({ generate: generateCuttingPlanPdf, generateProject: generateProjectCuttingPdf }).exportProject(request)
  if (!result.ok) throw new Error(result.error.message)
  const pdf = await PDFDocument.load(result.bytes)
  const rows = printedText(pdf, 1)
  expect(rows.filter(row => row.text === 'PROJECT')).toHaveLength(1)
  expect(rows.filter(row => row.text === 'CUTTING SETTINGS')).toHaveLength(1)
  expect(rows.filter(row => row.text === 'SCALE')).toHaveLength(1)
  expect(rows.some(row => row.text === 'N/A')).toBe(true)
  expect(rows.some(row => row.text.endsWith('...'))).toBe(true)
  expect(rows.filter(row => row.text === 'Workshop shelf').every(row => row.y > 100)).toBe(true)
  expect(pageOperators(pdf, 1)).toContain('88 m')
  expect(pageOperators(pdf, 1)).not.toMatch(/\bDo\b/u)
})

it.each(['portrait', 'landscape'] as const)('uses one identical four-cell footer on every non-cover %s page, with nomenclature only on cutting drawings', async orientation => {
  const result = await createCuttingPlanPdfService({ generate: generateCuttingPlanPdf, generateProject: generateProjectCuttingPdf }).exportProject({ ...multiPanelPdfRequest(), orientation })
  if (!result.ok) throw new Error(result.error.message)
  const pdf = await PDFDocument.load(result.bytes)
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  expect(hasText(pageOperators(pdf, 0), 'PROJECT')).toBe(false)
  const positions: number[] = []
  for (const [index, page] of pdf.getPages().entries()) {
    if (!index) continue
    const operators = pageOperators(pdf, index)
    const rows = printedText(pdf, index)
    for (const label of ['PROJECT', 'SCALE', 'SHEET']) expect(rows.filter(row => row.text === label)).toHaveLength(1)
    expect(rows.some(row => row.text === 'Workshop project')).toBe(true)
    const grid = isPartDrawing(operators)
    expect(rows.some(row => row.text === 'UNITS')).toBe(grid)
    expect(rows.some(row => row.text === 'CUTTING SETTINGS')).toBe(!grid)
    if (!grid) {
      expect(rows.some(row => row.text === 'Kerf: 2 mm')).toBe(true)
      expect(rows.some(row => row.text === 'Edge margin: 5 mm')).toBe(true)
    }
    const actual = rows.find(row => row.text === `${String(index + 1)} / ${String(pdf.getPageCount())}`)
    const sheet = rows.find(row => row.text === 'SHEET')
    if (!actual || !sheet) throw new Error('Missing sheet cell')
    const center = page.getWidth() - 28 - 72.5 / 2
    expect(sheet.x + regular.widthOfTextAtSize('SHEET', 6) / 2).toBeCloseTo(center)
    expect(actual.x + bold.widthOfTextAtSize(actual.text, 8) / 2).toBeCloseTo(center)
    positions.push(actual.y)
    expect(operators).toContain('88 m')
    const nomenclature = rows.filter(row => /^Panel [0-9]+ — /u.test(row.text))
    expect(nomenclature.length > 0).toBe(isCuttingDrawing(operators))
    expect(nomenclature.every(row => row.y > 88)).toBe(true)
    if (!isCuttingDrawing(operators)) expect(rows.some(row => row.text === 'N/A')).toBe(true)
  }
  expect(new Set(positions).size).toBe(1)
})
