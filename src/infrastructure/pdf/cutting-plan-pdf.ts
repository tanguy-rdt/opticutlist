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
import { createPdfTables } from './pdf-table'
import { purchasingSchedule } from './purchasing-schedule'
import { appendPartDrawings } from './part-drawings'
function drawLines(page: PDFPage, lines: readonly string[], font: PDFFont, x: number, y: number, size = 10): number {
  for (const text of lines) { page.drawText(text, { x, y, size, font, color: ink }); y -= lineHeight }
  return y
}
function dimensions(item: { lengthMm: number; widthMm: number; thicknessMm: number }): string {
  return `${String(item.lengthMm)} x ${String(item.widthMm)} x ${String(item.thicknessMm)} mm`
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
function drawingTitleBlock(page: PDFPage, font: PDFFont, project: string, title: string, material: string, thickness: number, scale: string, date: string): void {
  sheetFrame(page, font, project, title, scale, date)
  page.drawText(`${material.length > 30 ? material.slice(0, 27) + '...' : material} / ${String(thickness)} mm`, { x: margin, y: 60, size: 8, font, color: muted })
}
/** Exactly one technical sheet per validated physical panel; no repeated detail or annotation pages. */
function appendCuttingPlanPdf(pdf: PDFDocument, font: PDFFont, bold: PDFFont, document: CuttingPlanPdfDocument, heading = 'Cutting panel', date = new Date().toISOString().slice(0, 10)): void {
  const size = pdfPageSize(document.pageSize ?? 'A4', document.orientation)
  const page = pdf.addPage([size.width, size.height])
  const drawing = drawPanelSheet(page, font, bold, document, heading)
  drawingTitleBlock(page, font, document.projectName ?? 'Cutting plan', heading, document.materialName, document.panel.thicknessMm, drawing.scale, date)
}

function materialName(document: ProjectCuttingPdfDocument, part: Part): string {
  return document.panels.find(panel => panel.panel.materialId === part.materialId)?.materialName ?? 'Material name unavailable'
}
function appendFabricationSections(pdf: PDFDocument, font: PDFFont, bold: PDFFont, document: ProjectCuttingPdfDocument, date: string): void {
  const size = pdfPageSize(document.pageSize ?? 'A4', document.orientation)
  const tables = createPdfTables(pdf, font, bold, size, page => { sheetFrame(page, font, document.title, 'Fabrication schedules', 'N/A', date) })
  const columns = [{ label: 'Reference', weight: 1 }, { label: 'Name', weight: 2.4 }, { label: 'Material', weight: 2 }, { label: 'Length', weight: 1, numeric: true }, { label: 'Width', weight: 1, numeric: true }, { label: 'Thickness', weight: 1.2, numeric: true }, { label: 'Quantity', weight: 1, numeric: true }]
  const describe = (part: Part) => [partCode(document.parts, part.id), part.name, materialName(document, part), String(part.lengthMm), String(part.widthMm), String(part.thicknessMm), String(part.quantity)]
  tables.table('Complete parts list', columns, document.parts.map(describe))
  const sources = new Map<string, { panel: CuttingPlanPdfDocument; count: number }>()
  for (const panel of document.panels) {
    const previous = sources.get(panel.panel.id)
    sources.set(panel.panel.id, { panel, count: (previous?.count ?? 0) + 1 })
  }
  const purchasing = purchasingSchedule([...sources.values()])
  tables.table('Materials and purchasing', [
    { label: 'Material', weight: 1.6 }, { label: 'Panel reference', weight: 2 }, { label: 'Dimensions (mm)', weight: 1.8 }, { label: 'Quantity', weight: 0.8, numeric: true }, { label: 'Supplier / provenance', weight: 1.6 }, { label: 'Unit price', weight: 1, numeric: true }, { label: 'Total price', weight: 1, numeric: true },
  ], purchasing)
  const materials = [...new Set(document.parts.map(part => part.materialId))]
  for (const id of materials) tables.table('Parts grouped by material / ' + (document.panels.find(panel => panel.panel.materialId === id)?.materialName ?? 'Material name unavailable'), columns, document.parts.filter(part => part.materialId === id).map(describe))
  if (!materials.length) tables.table('Parts grouped by material', columns, [])
  const orderedSources = [...sources.values()].sort((a, b) => a.panel.panel.materialId < b.panel.panel.materialId ? -1 : a.panel.panel.materialId > b.panel.panel.materialId ? 1 : 0)
  const inventory = createPdfTables(pdf, font, bold, size, page => { sheetFrame(page, font, document.title, 'Panel inventory', 'N/A', date) })
  for (const { panel } of orderedSources) {
    for (const [index, allocated] of document.panels.entries()) {
      if (allocated.panel.id !== panel.panel.id) continue
      const grouped = new Map<string, { name: string; dimensions: string; count: number }>()
      for (const placed of allocated.scene.parts) {
        const key = partCode(document.parts, placed.part.id) + '/' + placed.orientation
        const previous = grouped.get(key)
        grouped.set(key, { name: `${partCode(document.parts, placed.part.id)} / ${placed.part.name}`, dimensions: dimensions(placed.dimensions), count: (previous?.count ?? 0) + 1 })
      }
      inventory.table(`${panel.materialName} / ${panel.panel.name} / Panel ${String(index + 1)}`, [{ label: 'Allocated part', weight: 3 }, { label: 'Dimensions (mm)', weight: 2 }, { label: 'Quantity', weight: 1, numeric: true }], [...grouped.values()].map(part => [part.name, part.dimensions, String(part.count)]))
    }
  }
  appendPartDrawings(pdf, font, bold, document.parts, document.pageSize ?? 'A4', document.orientation, part => materialName(document, part), page => { sheetFrame(page, font, document.title, 'Individual part drawings', 'Per drawing', date) })
}
async function finishPdf(pdf: PDFDocument, font: PDFFont): Promise<Uint8Array<ArrayBuffer>> {
  for (const [index, current] of pdf.getPages().entries()) current.drawText(`Sheet ${String(index + 1)} / ${String(pdf.getPageCount())}`, { x: current.getWidth() - margin - (current.getWidth() - margin * 2) * 0.2, y: 67, size: 9, font, color: ink })
  pdf.setTitle('OptiCutList cutting plan')
  pdf.setProducer('OptiCutList / pdf-lib')
  return new Uint8Array(await pdf.save())
}
async function renderCuttingPlanPdf(document: CuttingPlanPdfDocument): Promise<Uint8Array<ArrayBuffer>> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  appendCuttingPlanPdf(pdf, font, bold, document)
  return finishPdf(pdf, font)
}
export async function generateProjectCuttingPdf(document: ProjectCuttingPdfDocument): Promise<Uint8Array<ArrayBuffer>> {
  return withFontErrors(async () => {
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
    const date = new Date().toISOString().slice(0, 10)
    const size = pdfPageSize(document.pageSize ?? 'A4', document.orientation)
    let page = pdf.addPage([size.width, size.height])
    sheetFrame(page, font, document.title, 'Project summary', 'N/A', date)
    let y = size.height - margin
    function row(text: string, heading = false): void {
      const selected = heading ? bold : font
      for (const line of wrapPdfText(text, selected, heading ? 14 : 10, size.width - 2 * margin)) {
        if (y < 120) { page = pdf.addPage([size.width, size.height]); sheetFrame(page, font, document.title, 'Project summary', 'N/A', date); y = size.height - margin }
        y = drawLines(page, [line], selected, margin, y, heading ? 14 : 10)
      }
      y -= 8
    }
    row('OptiCutList / Project cutting result', true)
    row(document.title)
    row(`${String(document.panels.length)} panels / ${String(document.metrics.placedCount)} copies placed / ${String(document.metrics.unplacedCount)} copies unplaced`)
    row(document.metrics.unplacedCount ? 'INCOMPLETE - unplaced parts are not produced by these layouts.' : 'All requested copies are placed.')
    row(`Utilization: ${document.metrics.utilizationPercent.toFixed(2)}% / Waste: ${document.metrics.wasteAreaMm2.toLocaleString('en-US')} mm² (including kerf and margins)`)
    row('Unplaced project parts', true)
    if (!document.unplaced.length) row('None.')
    const reasons = { noCompatiblePanel: 'No compatible selected panel', constraintsPreventPlacement: 'Dimensions, grain, rotation, kerf or margins prevent placement', panelLimitReached: 'Insufficient panel quantity or remaining usable space' }
    for (const missing of document.unplaced) {
      const part = document.parts.find(part => part.id === missing.partId)
      row(`${part?.name ?? 'Unavailable part'} / ${String(missing.count)} copies starting at ${String(missing.firstCopyIndex + 1)}${part ? ` / ${dimensions(part)}` : ''} / ${reasons[missing.reason]}`)
    }
    appendFabricationSections(pdf, font, bold, document, date)
    document.panels.forEach((panel, index) => { appendCuttingPlanPdf(pdf, font, bold, panel, `OptiCutList / Panel ${String(index + 1)} of ${String(document.panels.length)}`, date) })
    return finishPdf(pdf, font)
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
