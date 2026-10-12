import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { CuttingPlanPdfDocument, ProjectCuttingPdfDocument } from '../../application/export/cutting-plan-pdf-service'
import type { Part } from '../../domain/model/part'
import { pdfPageSize } from './pdf-layout'
import { drawPanelSheet } from './panel-drawing'

const ink = rgb(0.12, 0.15, 0.17)
const muted = rgb(0.35, 0.38, 0.4)
const margin = 36
const lineHeight = 14

export { wrapPdfText } from './pdf-text'
import { wrapPdfText } from './pdf-text'
import { createPdfTables, type TableRow } from './pdf-table'
import { purchasingSchedule } from './purchasing-schedule'
import { appendPartDrawings } from './part-drawings'
function drawLines(page: PDFPage, lines: readonly string[], font: PDFFont, x: number, y: number, size = 10): number {
  for (const text of lines) { page.drawText(text, { x, y, size, font, color: ink }); y -= lineHeight }
  return y
}
function dimensions(item: { lengthMm: number; widthMm: number; thicknessMm: number }): string {
  return `${String(item.lengthMm)} × ${String(item.widthMm)} × ${String(item.thicknessMm)} mm`
}

function partCode(parts: readonly Part[], id: string): string { return `P${String(parts.findIndex(part => part.id === id) + 1)}` }
function sheetFrame(page: PDFPage, font: PDFFont, project: string, title: string, scale: string, date: string): void {
  const width = page.getWidth() - margin * 2
  const bounded = (value: string, max: number) => {
    let text = value
    while (text.length && font.widthOfTextAtSize(text, 8) > max) text = text.slice(0, -1)
    return text === value ? text : `${text.slice(0, -3)}...`
  }
  page.drawRectangle({ x: margin - 8, y: 36, width: width + 16, height: page.getHeight() - 52, borderColor: muted, borderWidth: 0.5 })
  page.drawLine({ start: { x: margin - 8, y: 104 }, end: { x: page.getWidth() - margin + 8, y: 104 }, thickness: 0.5, color: muted })
  const left = width * 0.55
  for (const x of [margin + left, margin + left + (width - left) / 2]) page.drawLine({ start: { x, y: 36 }, end: { x, y: 104 }, thickness: 0.5, color: muted })
  drawLines(page, [`Project: ${bounded(project, left - 55)}`, bounded(title, left - 8)], font, margin, 86, 8)
  drawLines(page, [`Generated: ${date}`, `Scale ${scale}`, 'Units: mm'], font, margin + left + 8, 88, 8)
  if (scale !== 'N/A') page.drawText('Print: Actual size / 100%', { x: margin, y: 46, size: 8, font, color: muted })
}
/** Exactly one technical sheet per validated physical panel. */
function appendCuttingPlanPdf(pdf: PDFDocument, font: PDFFont, bold: PDFFont, document: CuttingPlanPdfDocument, heading = 'Panel 1') {
  const size = pdfPageSize(document.pageSize ?? 'A4', document.orientation)
  const page = pdf.addPage([size.width, size.height])
  const drawing = drawPanelSheet(page, font, bold, document, heading)
  return { page, position: drawing.titleBlock.sheetPosition }
}

function materialName(document: ProjectCuttingPdfDocument, part: Part): string {
  return document.panels.find(panel => panel.panel.materialId === part.materialId)?.materialName ?? 'N/A'
}
function appendFabricationSections(pdf: PDFDocument, font: PDFFont, bold: PDFFont, document: ProjectCuttingPdfDocument, date: string): void {
  const size = pdfPageSize(document.pageSize ?? 'A4', document.orientation)
  const tables = createPdfTables(pdf, font, bold, size, page => { sheetFrame(page, font, document.title, 'Fabrication schedules', 'N/A', date) })
  const columns = [{ label: 'Ref', weight: 1, nowrap: true }, { label: 'Part name', weight: 2.4 }, { label: 'Material', weight: 2 }, { label: 'Dimensions (mm)', weight: 1.8, nowrap: true }, { label: 'Qty', weight: 1, numeric: true }]
  const describe = (part: Part) => [partCode(document.parts, part.id), part.name, materialName(document, part), dimensions(part), String(part.quantity)]
  tables.table('Complete parts list', columns, document.parts.map(describe))
  const sources = new Map<string, { panel: CuttingPlanPdfDocument; count: number }>()
  for (const panel of document.panels) {
    const previous = sources.get(panel.panel.id)
    sources.set(panel.panel.id, { panel, count: (previous?.count ?? 0) + 1 })
  }
  tables.table('Materials and purchasing', [
    { label: 'Panel reference', weight: 2 }, { label: 'Material', weight: 1.6 }, { label: 'Dimensions (mm)', weight: 1.8, nowrap: true }, { label: 'Qty', weight: 0.8, numeric: true }, { label: 'Supplier / Source', weight: 1.6 }, { label: 'Unit price', weight: 1, numeric: true }, { label: 'Total', weight: 1, numeric: true },
  ], purchasingSchedule([...sources.values()]))
  const inventory: TableRow[] = []
  for (const [index, panel] of document.panels.entries()) {
    inventory.push({ cells: [`Panel ${String(index + 1)}`, panel.panel.name, panel.materialName, dimensions(panel.panel), '1'], kind: 'parent', keepWithNext: panel.scene.parts.length > 0 })
    const grouped = new Map<string, { ref: string; name: string; dimensions: string; count: number }>()
    for (const placed of panel.scene.parts) {
      const ref = partCode(document.parts, placed.part.id)
      const key = ref + '/' + placed.orientation
      const previous = grouped.get(key)
      grouped.set(key, { ref, name: placed.part.name, dimensions: dimensions(placed.dimensions), count: (previous?.count ?? 0) + 1 })
    }
    for (const part of grouped.values()) inventory.push({ cells: [part.ref, part.name, '', part.dimensions, String(part.count)], kind: 'child' })
  }
  tables.table('Panel inventory', [{ label: 'Ref', weight: 1.2, nowrap: true }, { label: 'Panel / Part name', weight: 2.4 }, { label: 'Material', weight: 2 }, { label: 'Dimensions (mm)', weight: 1.8, nowrap: true }, { label: 'Qty', weight: 1, numeric: true }], inventory)
  if (document.unplaced.length) {
    const reasons = { noCompatiblePanel: 'No compatible panel', constraintsPreventPlacement: 'Cutting constraints prevent placement', panelLimitReached: 'Insufficient panels or usable space' }
    tables.table('Unplaced parts', [...columns, { label: 'Reason', weight: 2 }], document.unplaced.map(missing => {
      const part = document.parts.find(part => part.id === missing.partId)
      return [partCode(document.parts, missing.partId), part?.name ?? 'N/A', part ? materialName(document, part) : 'N/A', part ? dimensions(part) : 'N/A', String(missing.count), reasons[missing.reason]]
    }))
  }
  appendPartDrawings(pdf, font, bold, document.parts, document.pageSize ?? 'A4', document.orientation, part => materialName(document, part), page => { sheetFrame(page, font, document.title, 'Individual part drawings', 'Per drawing', date) })
}
async function finishPdf(pdf: PDFDocument, font: PDFFont, cover?: PDFPage, panelSheets: readonly { page: PDFPage; position: { x: number; y: number } }[] = []): Promise<Uint8Array<ArrayBuffer>> {
  for (const [index, current] of pdf.getPages().entries()) if (current !== cover) current.drawText(`Sheet ${String(index + 1)} / ${String(pdf.getPageCount())}`, { ...(panelSheets.find(sheet => sheet.page === current)?.position ?? { x: current.getWidth() - margin - (current.getWidth() - margin * 2) * 0.2, y: 67 }), size: panelSheets.some(sheet => sheet.page === current) ? 8 : 9, font, color: ink })
  pdf.setTitle('OptiCutList cutting plan')
  pdf.setProducer('OptiCutList / pdf-lib')
  return new Uint8Array(await pdf.save())
}
async function renderCuttingPlanPdf(document: CuttingPlanPdfDocument): Promise<Uint8Array<ArrayBuffer>> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const sheet = appendCuttingPlanPdf(pdf, font, bold, document)
  return finishPdf(pdf, font, undefined, [sheet])
}
export async function generateProjectCuttingPdf(document: ProjectCuttingPdfDocument): Promise<Uint8Array<ArrayBuffer>> {
  return withFontErrors(async () => {
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
    const date = new Date().toISOString().slice(0, 10)
    const size = pdfPageSize(document.pageSize ?? 'A4', document.orientation)
    const cover = pdf.addPage([size.width, size.height])
    const titleSize = 28
    const lines = wrapPdfText(document.title, bold, titleSize, size.width - margin * 2)
    const titleLineHeight = 34
    const glyphHeight = bold.heightAtSize(titleSize, { descender: false })
    const firstBaseline = size.height / 2 + (lines.length - 1) * titleLineHeight / 2 - glyphHeight / 2
    for (const [index, text] of lines.entries()) cover.drawText(text, { x: size.width / 2 - bold.widthOfTextAtSize(text, titleSize) / 2, y: firstBaseline - index * titleLineHeight, font: bold, size: titleSize, color: ink })
    appendFabricationSections(pdf, font, bold, document, date)
    const sheets = document.panels.map((panel, index) => appendCuttingPlanPdf(pdf, font, bold, panel, `Panel ${String(index + 1)}`))
    return finishPdf(pdf, font, cover, sheets)
  })
}
async function withFontErrors(work: () => Promise<Uint8Array<ArrayBuffer>>): Promise<Uint8Array<ArrayBuffer>> {
  try { return await work() }
  catch (cause) {
    if (cause instanceof Error && cause.message.includes('WinAnsi cannot encode')) throw new Error('A name contains characters unsupported by the built-in PDF font. Use Latin-script names for this export; no characters have been replaced.', { cause })
    throw cause
  }
}

export async function generateCuttingPlanPdf(document: CuttingPlanPdfDocument): Promise<Uint8Array<ArrayBuffer>> {
  return withFontErrors(() => renderCuttingPlanPdf(document))
}
