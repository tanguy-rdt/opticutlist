import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { CuttingPlanPdfDocument, ProjectCuttingPdfDocument } from '../../application/export/cutting-plan-pdf-service'
import type { Part } from '../../domain/model/part'
import { drawTechnicalTitleBlock, technicalTitleBlockLayout, cuttingSettingsContext } from './technical-title-block'
import { drawCoverPage } from './cover-page'
import { pdfPageSize } from './pdf-layout'
import { drawTechnicalFrame, type SheetNumberPosition } from './technical-sheet'
import { drawPanelSheet } from './panel-drawing'

type NumberedSheet = { page: PDFPage; position: SheetNumberPosition }

const ink = rgb(0.12, 0.15, 0.17)
const margin = 36

export { wrapPdfText } from './pdf-text'
import { createPdfTables, type TableRow } from './pdf-table'
import { purchasingSchedule } from './purchasing-schedule'
import { appendPartDrawings } from './part-drawings'

function dimensions(item: { lengthMm: number; widthMm: number; thicknessMm: number }): string {
  return `${String(item.lengthMm)} × ${String(item.widthMm)} × ${String(item.thicknessMm)} mm`
}

function partCode(parts: readonly Part[], id: string): string {
  return `P${String(parts.findIndex(part => part.id === id) + 1)}`
}

/** Exactly one technical sheet per validated physical panel. */
function appendCuttingPlanPdf(pdf: PDFDocument, font: PDFFont, bold: PDFFont, document: CuttingPlanPdfDocument, heading = 'Panel 1') {
  const size = pdfPageSize(document.pageSize ?? 'A4', document.orientation)
  const page = pdf.addPage([size.width, size.height])
  const drawing = drawPanelSheet(page, font, bold, document, heading)
  const sheets: NumberedSheet[] = [{ page, position: drawing.sheetPosition }]
  if (drawing.titleBlock.continued.length) {
    const tables = createPdfTables(pdf, font, bold, size, continuation => {
      drawTechnicalFrame(continuation)
      sheets.push({
        page: continuation,
        position: drawTechnicalTitleBlock(continuation, font, bold, technicalTitleBlockLayout(size.width - 56), { projectName: document.projectName ?? 'N/A', context: cuttingSettingsContext(document.settings), scale: drawing.scale })
      })
    })
    tables.table(`${heading} / Parts continued`, [{ label: 'Part reference / name', weight: 3 }, { label: 'Dimensions (mm)', weight: 1, nowrap: true, numeric: true }], drawing.titleBlock.continued.map(row => ({ cells: [`${row.ref} — ${row.name}`, row.dimensions], kind: 'child' })))
  }
  return sheets
}

function materialName(document: ProjectCuttingPdfDocument, part: Part): string {
  return document.panels.find(panel => panel.panel.materialId === part.materialId)?.materialName ?? 'N/A'
}

function appendFabricationSections(
  pdf: PDFDocument,
  font: PDFFont,
  bold: PDFFont,
  document: ProjectCuttingPdfDocument,
  drawingSheets: NumberedSheet[]
): void {
  const size = pdfPageSize(document.pageSize ?? 'A4', document.orientation)
  const block = technicalTitleBlockLayout(size.width - 56)
  const tables = createPdfTables(pdf, font, bold, size, page => {
    drawTechnicalFrame(page)
    const position = drawTechnicalTitleBlock(page, font, bold, block, { projectName: document.title, context: cuttingSettingsContext(document.settings), scale: 'N/A' })
    drawingSheets.push({ page, position })
  }, { appearance: 'fabrication', bottom: block.top + 12 })
  const columns = [{ label: 'Ref', weight: 1, nowrap: true }, { label: 'Part name', weight: 2.4 }, { label: 'Material', weight: 2 }, { label: 'Dimensions (mm)', weight: 1.8, nowrap: true, numeric: true }, { label: 'Qty', weight: 1, numeric: true }]
  const describe = (part: Part) => [partCode(document.parts, part.id), part.name, materialName(document, part), dimensions(part), String(part.quantity)]
  tables.table('Complete parts list', columns, document.parts.map(describe))
  const sources = new Map<string, { panel: CuttingPlanPdfDocument; count: number }>()
  for (const panel of document.panels) {
    const previous = sources.get(panel.panel.id)
    sources.set(panel.panel.id, { panel, count: (previous?.count ?? 0) + 1 })
  }
  tables.table('Materials and purchasing', [
    { label: 'Panel reference', weight: 2 }, { label: 'Material', weight: 1.6 }, { label: 'Dimensions (mm)', weight: 1.8, nowrap: true, numeric: true }, { label: 'Qty', weight: 0.8, numeric: true }, { label: 'Supplier / Source', weight: 1.6 }, { label: 'Unit price', weight: 1, numeric: true }, { label: 'Total', weight: 1, numeric: true },
  ], purchasingSchedule([...sources.values()]).map(cells => ({ cells, ...(cells[0] === 'Total:' || cells[0] === 'Subtotal (partial):' ? { kind: 'total' as const } : {}) })))
  const inventory: TableRow[] = []
  for (const [index, panel] of document.panels.entries()) {
    inventory.push({
      cells: [`Panel ${String(index + 1)}`, panel.panel.name, panel.materialName, dimensions(panel.panel), '1'],
      kind: 'parent',
      keepWithNext: panel.scene.parts.length > 0
    })
    const grouped = new Map<string, { ref: string; name: string; dimensions: string; count: number }>()
    for (const placed of panel.scene.parts) {
      const ref = partCode(document.parts, placed.part.id)
      const key = ref + '/' + placed.orientation
      const previous = grouped.get(key)
      grouped.set(key, { ref, name: placed.part.name, dimensions: dimensions(placed.dimensions), count: (previous?.count ?? 0) + 1 })
    }
    for (const part of grouped.values()) {
      inventory.push({ cells: [part.ref, part.name, '', part.dimensions, String(part.count)], kind: 'child' })
    }
  }
  tables.table('Panel inventory', [{ label: 'Ref', weight: 1.2, nowrap: true }, { label: 'Panel / Part name', weight: 2.4 }, { label: 'Material', weight: 2 }, { label: 'Dimensions (mm)', weight: 1.8, nowrap: true, numeric: true }, { label: 'Qty', weight: 1, numeric: true }], inventory)
  if (document.unplaced.length) {
    const reasons = {
      noCompatiblePanel: 'No compatible panel',
      constraintsPreventPlacement: 'Cutting constraints prevent placement',
      panelLimitReached: 'Insufficient panels or usable space'
    }
    tables.table('Unplaced parts', [...columns, { label: 'Reason', weight: 2 }], document.unplaced.map(missing => {
      const part = document.parts.find(part => part.id === missing.partId)
      return [partCode(document.parts, missing.partId), part?.name ?? 'N/A', part ? materialName(document, part) : 'N/A', part ? dimensions(part) : 'N/A', String(missing.count), reasons[missing.reason]]
    }))
  }
  appendPartDrawings(pdf, font, bold, document.parts, document.pageSize ?? 'A4', document.orientation, (page, position) => {
    drawingSheets.push({ page, position })
  }, document.title)
}

async function finishPdf(
  pdf: PDFDocument,
  font: PDFFont,
  bold: PDFFont,
  cover?: PDFPage,
  technicalSheets: readonly NumberedSheet[] = [],
  title = 'OptiCutList cutting plan'
): Promise<Uint8Array<ArrayBuffer>> {
  for (const [index, current] of pdf.getPages().entries()) {
    if (current === cover) {
      continue
    }
    const positions = technicalSheets.filter(sheet => sheet.page === current).map(sheet => sheet.position)
    const numbers = String(index + 1) + ' / ' + String(pdf.getPageCount())
    if (!positions.length) {
      current.drawText('Sheet ' + numbers, { x: current.getWidth() - margin - (current.getWidth() - margin * 2) * 0.2, y: 67, size: 9, font, color: ink })
    }
    for (const position of positions) {
      const value = position.width ? numbers : 'Sheet ' + numbers
      const size = position.fontSize
      const selected = position.bold ? bold : font
      if (position.width && selected.widthOfTextAtSize(value, size) > position.width - 8) {
        throw new Error('Sheet numbering does not fit the technical footer.')
      }
      const x = position.x + (position.width ? (position.width - selected.widthOfTextAtSize(value, size)) / 2 : 0)
      current.drawText(value, { x, y: position.y, size, font: selected, color: ink })
    }
  }
  pdf.setTitle(title)
  pdf.setProducer('OptiCutList / pdf-lib')
  return new Uint8Array(await pdf.save())
}

async function renderCuttingPlanPdf(document: CuttingPlanPdfDocument): Promise<Uint8Array<ArrayBuffer>> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const sheet = appendCuttingPlanPdf(pdf, font, bold, document)
  return finishPdf(pdf, font, bold, undefined, sheet)
}

export async function generateProjectCuttingPdf(document: ProjectCuttingPdfDocument): Promise<Uint8Array<ArrayBuffer>> {
  return withFontErrors(async () => {
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
    const size = pdfPageSize(document.pageSize ?? 'A4', document.orientation)
    const cover = pdf.addPage([size.width, size.height])
    await drawCoverPage(pdf, cover, await pdf.embedFont(StandardFonts.HelveticaOblique), bold, document)
    const drawingSheets: NumberedSheet[] = []
    appendFabricationSections(pdf, font, bold, document, drawingSheets)
    const sheets = document.panels.flatMap((panel, index) => appendCuttingPlanPdf(pdf, font, bold, panel, `Panel ${String(index + 1)}`))
    return finishPdf(pdf, font, bold, cover, [...drawingSheets, ...sheets], document.cover?.title?.trim() || document.title)
  })
}

async function withFontErrors(work: () => Promise<Uint8Array<ArrayBuffer>>): Promise<Uint8Array<ArrayBuffer>> {
  try {
    return await work()
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('WinAnsi cannot encode')) {
      throw new Error('A name contains characters unsupported by the built-in PDF font. Use Latin-script names for this export; no characters have been replaced.', { cause })
    }
    throw cause
  }
}

export async function generateCuttingPlanPdf(document: CuttingPlanPdfDocument): Promise<Uint8Array<ArrayBuffer>> {
  return withFontErrors(() => renderCuttingPlanPdf(document))
}
