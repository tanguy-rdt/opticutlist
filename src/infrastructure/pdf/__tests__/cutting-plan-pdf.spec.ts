import { PDFArray, PDFDocument, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { generateCuttingPlanPdf, wrapPdfText } from '../cutting-plan-pdf'
import { createCuttingPlanPdfService } from '../../../application/export/cutting-plan-pdf-service'
import { pdfRequest } from '../../../application/export/__tests__/pdf-fixtures'
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
function hasText(operators: string, text: string): boolean { return operators.includes(Buffer.from(text, 'latin1').toString('hex').toUpperCase()) }
async function exportPdf(request = pdfRequest) {
  const result = await createCuttingPlanPdfService({ generate: generateCuttingPlanPdf }).export(request)
  if (!result.ok) throw new Error(result.error.message)
  return PDFDocument.load(result.bytes)
}
describe('Vector cutting plan PDF', () => {
  it.each(['portrait', 'landscape'] as const)('exports %s A4 vector paths and text with no raster images', async orientation => {
    const request = structuredClone({ ...pdfRequest, orientation })
    const original = structuredClone(request)
    freezeDeep(request)
    const pdf = await exportPdf(request)
    expect(pdf.getPageCount()).toBe(2)
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
    expect(hasText(operators, '100 x 80 x 18 mm')).toBe(true)
    expect(hasText(operators, '18.75%')).toBe(true)
    expect(hasText(operators, '6,500 mm')).toBe(true)
    expect(hasText(pageOperators(pdf, 1), 'Rotated 90')).toBe(true)
    expect(request).toEqual(original)
  })
  it('exports the real optimizer output and a manually edited snapshot with correct orientation', async () => {
    const optimized = optimizePanel(rotationInput)
    if (!optimized.ok) throw new Error('No optimized plan')
    const pdf = await exportPdf({ ...pdfRequest, plan: optimized.plan })
    expect(hasText(pageOperators(pdf, 0), 'Optimized panel plan')).toBe(true)
    const session = createPlanEditingSession(rotationPlan, rotationInput)
    if (!session.ok) throw new Error(session.error.message)
    const edit = applyPlanEdit(session.session, { kind: 'rotate', copy: { partId: viewerPart.id, copyIndex: 0 } })
    if (!edit.ok) throw new Error(edit.error.message)
    const original = structuredClone(rotationPlan)
    const edited = await exportPdf({ ...pdfRequest, plan: currentEditingPlan(edit.session), edited: true })
    expect(hasText(pageOperators(edited, 0), 'Manually edited panel plan')).toBe(true)
    expect(hasText(pageOperators(edited, 1), '50 x 30 x 18 mm / Normal')).toBe(true)
    expect(rotationPlan).toEqual(original)
  })
  it('preserves zero-kerf cuts as vector lines', async () => {
    const pdf = await exportPdf({ ...pdfRequest, ...swapInput, plan: swapPlan })
    expect(pageOperators(pdf, 0)).toMatch(/0\.4 w/u)
    expect(hasText(pageOperators(pdf, 0), 'Kerf: 0 mm')).toBe(true)
  })
  it('paginates full names and unplaced reasons without dropping demand', async () => {
    const input = { ...rotationInput, parts: [{ ...viewerPart, quantity: 101, name: 'Very long shelf name '.repeat(9).trim() }] }
    const unplaced = Array.from({ length: 100 }, (_, index) => ({ partId: viewerPart.id, firstCopyIndex: index + 1, count: 1, reason: { kind: 'noSpaceLeft' as const } }))
    const pdf = await exportPdf({ ...pdfRequest, ...input, plan: { ...rotationPlan, unplaced }, orientation: 'portrait' })
    expect(pdf.getPageCount()).toBeGreaterThan(5)
    const operators = pdf.getPages().map((_, index) => pageOperators(pdf, index)).join('\n')
    expect(hasText(operators, '100 copies unplaced')).toBe(true)
    expect(hasText(operators, 'starting at copy 101')).toBe(true)
    expect(hasText(operators, 'No space left on this panel')).toBe(true)
    expect(hasText(operators, 'Details continued')).toBe(true)
    for (let index = 0; index < pdf.getPageCount(); index += 1) expect(hasText(pageOperators(pdf, index), `OptiCutList / ${String(index + 1)} of ${String(pdf.getPageCount())}`)).toBe(true)
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

it('exports each allocated panel as vectors and identifies copies allocated elsewhere without mutating the project plan', async () => {
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
    expect(hasText(pageOperators(pdf, 1), 'Allocated to another panel in the project')).toBe(true)
    expect(hasText(pageOperators(pdf, 1), 'All requested copies are placed on this panel')).toBe(false)
  }
  expect(result.plan).toEqual(original)
})
