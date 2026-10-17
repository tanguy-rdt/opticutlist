import { type PDFFont, type PDFPage } from 'pdf-lib'
import type { CuttingPlanPdfDocument } from '../../application/export/cutting-plan-pdf-service'
import type { ScenePart } from '../../application/optimization/cutting-plan-scene'
import { technicalTitleBlockLayout, drawTechnicalTitleBlock, cuttingSettingsContext } from './technical-title-block'
import { pdfPageSize } from './pdf-layout'
import { boundedPdfText, wrapPdfText } from './pdf-text'

import { drawTechnicalFrame, technicalInk as ink, technicalRule as rule, technicalTextSize as textSize, technicalLineHeight as lineHeight } from './technical-sheet'

/** Shared by drawing labels and the instance table; copy indices survive accepted edits. */
export function panelPartReference(document: CuttingPlanPdfDocument, placed: ScenePart): string {
  return `P${String(document.parts.findIndex(part => part.id === placed.part.id) + 1)}${placed.part.quantity > 1 ? `.${String(placed.copyIndex + 1)}` : ''}`
}
function dimensions(item: { lengthMm: number; widthMm: number; thicknessMm: number }): string {
  return `${String(item.lengthMm)} × ${String(item.widthMm)} × ${String(item.thicknessMm)} mm`
}
export function panelContainedParts(document: CuttingPlanPdfDocument) {
  return document.scene.parts.map(placed => ({ ref: panelPartReference(document, placed), name: placed.part.name, dimensions: dimensions(placed.dimensions), quantity: 1 }))
}

/** A measured full-width instance list above one four-cell technical strip; long lists continue. */
export function layoutPanelTitleBlock(document: CuttingPlanPdfDocument, font: PDFFont, bold: PDFFont, reference: string) {
  const size = pdfPageSize(document.pageSize ?? 'A4', document.orientation)
  const x = 28
  const width = size.width - 56
  const tableWidth = width
  const technical = technicalTitleBlockLayout(width)
  const parts = panelContainedParts(document)
  const records = [
    { ref: reference, name: document.panel.name, dimensions: dimensions(document.panel), quantity: 1 },
    ...parts,
  ]
  const dimensionWidth = Math.max(...records.map((row, index) => (index === 0 ? bold : font).widthOfTextAtSize(row.dimensions, textSize))) + 12
  const nameWidth = tableWidth - dimensionWidth
  if (nameWidth < 60) throw new Error('The panel table does not fit this paper width. Choose a larger paper size or landscape orientation.')
  const rows = records.map((record, index) => {
    const labelWidth = nameWidth - (index === 0 ? 12 : 20)
    const lines = index === 0
      ? [boundedPdfText(record.ref + ' — ' + document.materialName, bold, textSize, labelWidth)]
      : wrapPdfText(record.ref + ' / ' + record.name, font, textSize, labelWidth)
    return { ...record, lines, parent: index === 0, height: lines.length * lineHeight + 8 }
  })
  const technicalHeight = technical.height
  const maxHeight = Math.min(150, size.height * 0.22)
  const visible: typeof rows = []
  let tableHeight = 0
  for (const row of rows) {
    // Keep the panel with at least its first child; only full rows may continue.
    if (visible.length >= Math.min(2, rows.length) && tableHeight + row.height > maxHeight) break
    visible.push(row)
    tableHeight += row.height
  }
  const height = tableHeight + technicalHeight
  if (height + 160 > size.height) throw new Error('A panel or material name is too tall for this paper size. Choose a larger sheet.')
  const technicalTop = 36 + technicalHeight
  return { x, width, tableWidth, nameWidth, dimensionWidth, tableHeight, top: 36 + height, technicalTop, technicalHeight, technical, content: { projectName: document.projectName ?? 'N/A', context: cuttingSettingsContext(document.settings) }, rows: visible, parts, continued: rows.slice(visible.length) }
}

export function drawPanelTitleBlock(page: PDFPage, font: PDFFont, bold: PDFFont, block: ReturnType<typeof layoutPanelTitleBlock>, scale: string) {
  const line = (x1: number, y1: number, x2: number, y2: number) => { page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.3, color: rule }) }
  const text = (value: string, x: number, y: number, selected = font) => { page.drawText(value, { x, y, size: textSize, font: selected, color: ink }) }
  drawTechnicalFrame(page)
  line(block.x, block.top, block.x + block.width, block.top)
  const tableEnd = block.x + block.tableWidth
  let y = block.top
  for (const row of block.rows) {
    row.lines.forEach((value, index) => { text(value, block.x + (row.parent ? 6 : 14), y - 12 - index * lineHeight, row.parent ? bold : font) })
    const dimensionFont = row.parent ? bold : font
    text(row.dimensions, tableEnd - 6 - dimensionFont.widthOfTextAtSize(row.dimensions, textSize), y - 12, dimensionFont)
    y -= row.height
    if (y > block.technicalTop) line(block.x, y, tableEnd, y)
  }
  return drawTechnicalTitleBlock(page, font, bold, block.technical, { ...block.content, scale })
}
