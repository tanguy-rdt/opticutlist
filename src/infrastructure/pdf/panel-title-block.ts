import { rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { CuttingPlanPdfDocument } from '../../application/export/cutting-plan-pdf-service'
import type { ScenePart } from '../../application/optimization/cutting-plan-scene'
import { pdfPageSize } from './pdf-layout'
import { drawScaleSheetCells } from './scale-sheet-cells'
import { wrapPdfText } from './pdf-text'

const textSize = 8
const lineHeight = 10
const ink = rgb(0.14, 0.14, 0.14)
const rule = rgb(0.6, 0.6, 0.6)

/** Shared by drawing labels and the instance table; copy indices survive accepted edits. */
export function panelPartReference(document: CuttingPlanPdfDocument, placed: ScenePart): string {
  return `P${String(document.parts.findIndex(part => part.id === placed.part.id) + 1)}${placed.part.quantity > 1 ? `.${String(placed.copyIndex + 1)}` : ''}`
}
function dimensions(item: { lengthMm: number; widthMm: number; thicknessMm: number }): string {
  return `${String(item.lengthMm)} × ${String(item.widthMm)} × ${String(item.thicknessMm)}`
}
export function panelContainedParts(document: CuttingPlanPdfDocument) {
  return document.scene.parts.map(placed => ({ ref: panelPartReference(document, placed), name: placed.part.name, dimensions: dimensions(placed.dimensions), quantity: 1 }))
}

/** The table and metadata share one horizontal block; long lists continue without repeating geometry. */
export function layoutPanelTitleBlock(document: CuttingPlanPdfDocument, font: PDFFont, bold: PDFFont, reference: string) {
  const size = pdfPageSize(document.pageSize ?? 'A4', document.orientation)
  const x = 28
  const width = size.width - 56
  const metadataWidth = 145
  const tableWidth = width - metadataWidth
  const parts = panelContainedParts(document)
  const records = [
    { ref: reference, name: document.panel.name, dimensions: dimensions(document.panel), quantity: 1 },
    ...parts,
  ]
  const dimensionWidth = Math.max(bold.widthOfTextAtSize('Dimensions (mm)', textSize), ...records.map(row => font.widthOfTextAtSize(row.dimensions, textSize))) + 12
  const nameWidth = tableWidth - dimensionWidth
  if (nameWidth < 60) throw new Error('The panel table does not fit this paper width. Choose a larger paper size or landscape orientation.')
  // Preserve the established diagram area and physical scale while simplifying the visible block.
  const reservedRows = records.map((record, index) => wrapPdfText(`${record.ref} / ${record.name}`, index === 0 ? bold : font, textSize, nameWidth - 28 - (index === 0 ? 12 : 20)).length * lineHeight + 4)
  const rows = records.map((record, index) => {
    const label = `${record.ref} / ${record.name}${index === 0 ? ` / ${document.materialName}` : ''}`
    const lines = wrapPdfText(label, index === 0 ? bold : font, textSize, nameWidth - (index === 0 ? 12 : 20))
    return { ...record, lines, parent: index === 0, height: lines.length * lineHeight + 4 }
  })
  const parameterValues = [`Kerf: ${String(document.settings.kerfMm)} mm`, `Edge margin: ${String(document.settings.edgeMarginMm)} mm`, ...(document.panel.grainDirection === 'none' ? [] : [`Grain: ${document.panel.grainDirection}`])]
  const metadata = parameterValues.flatMap(value => wrapPdfText(value, font, textSize, metadataWidth - 12))
  const reservedMetadata = [document.materialName, ...parameterValues].flatMap(value => wrapPdfText(value, font, textSize, metadataWidth - 12))
  const metadataHeight = (reservedMetadata.length + 2) * lineHeight + 12
  const headerHeight = 17
  const maxHeight = Math.max(metadataHeight, Math.min(150, size.height * 0.22))
  let reservedHeight = headerHeight
  for (const [index, rowHeight] of reservedRows.entries()) {
    if (index >= 2 && reservedHeight + rowHeight > maxHeight) break
    reservedHeight += rowHeight
  }
  const height = Math.max(reservedHeight, metadataHeight)
  const visible: typeof rows = []
  let tableHeight = headerHeight
  for (const row of rows) {
    if (tableHeight + row.height > height) break
    visible.push(row)
    tableHeight += row.height
  }
  if (visible.length < Math.min(2, rows.length)) throw new Error('Panel identification and material do not fit the compact title block. Use a larger paper size or landscape orientation.')
  if (height + 160 > size.height) throw new Error('A panel or material name is too tall for this paper size. Choose a larger sheet.')
  return { x, width, tableWidth, metadataWidth, nameWidth, dimensionWidth, top: 36 + height, metadata, rows: visible, parts, continued: rows.slice(visible.length), sheetPosition: { x: x + tableWidth + metadataWidth / 2, y: 42, width: metadataWidth / 2, fontSize: 8 } }
}

export function drawPanelTitleBlock(page: PDFPage, font: PDFFont, bold: PDFFont, block: ReturnType<typeof layoutPanelTitleBlock>, scale: string): void {
  const line = (x1: number, y1: number, x2: number, y2: number) => { page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.3, color: rule }) }
  const text = (value: string, x: number, y: number, selected = font) => { page.drawText(value, { x, y, size: textSize, font: selected, color: ink }) }
  page.drawRectangle({ x: 28, y: 36, width: page.getWidth() - 56, height: page.getHeight() - 52, borderColor: rule, borderWidth: 0.5 })
  line(block.x, block.top, block.x + block.width, block.top)
  const nameEnd = block.x + block.nameWidth
  const tableEnd = block.x + block.tableWidth
  line(tableEnd, 36, tableEnd, block.top)
  text('Panel / Part', block.x + 6, block.top - 12, bold)
  text('Dimensions (mm)', nameEnd + 6, block.top - 12, bold)
  let y = block.top - 17
  line(block.x, y, tableEnd, y)
  for (const row of block.rows) {
    row.lines.forEach((value, index) => { text(value, block.x + (row.parent ? 6 : 14), y - 10 - index * lineHeight, row.parent ? bold : font) })
    text(row.dimensions, nameEnd + 6, y - 10)
    y -= row.height
    if (row.parent) line(block.x, y, tableEnd, y)
  }
  block.metadata.forEach((value, index) => { text(value, tableEnd + 6, block.top - 12 - index * lineHeight) })
  drawScaleSheetCells(page, font, bold, { x: tableEnd, y: 36, width: block.metadataWidth, height: 29 }, scale)
}
