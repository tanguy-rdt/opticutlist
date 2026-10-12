import { rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { CuttingPlanPdfDocument } from '../../application/export/cutting-plan-pdf-service'
import { pdfPageSize } from './pdf-layout'
import { wrapPdfText } from './pdf-text'

const textSize = 8
const lineHeight = 11
const ink = rgb(0.14, 0.14, 0.14)
const rule = rgb(0.4, 0.4, 0.4)

/** Group placed definitions by stable identity and orientation, never by their display name. */
export function panelContainedParts(document: CuttingPlanPdfDocument) {
  const grouped = new Map<string, { ref: string; name: string; dimensions: string; quantity: number }>()
  for (const placed of document.scene.parts) {
    const ref = `P${String(document.parts.findIndex(part => part.id === placed.part.id) + 1)}`
    const key = `${ref}/${placed.orientation}`
    const previous = grouped.get(key)
    grouped.set(key, {
      ref, name: placed.part.name,
      dimensions: `${String(placed.dimensions.lengthMm)} × ${String(placed.dimensions.widthMm)} × ${String(placed.dimensions.thicknessMm)}`,
      quantity: (previous?.quantity ?? 0) + 1,
    })
  }
  return [...grouped.values()]
}

/** Font-measured, content-sized block. No truncated names or unreadably reduced type. */
export function layoutPanelTitleBlock(document: CuttingPlanPdfDocument, font: PDFFont, bold: PDFFont, reference: string) {
  const size = pdfPageSize(document.pageSize ?? 'A4', document.orientation)
  const x = 28
  const width = size.width - 56
  const rightWidth = 100
  const metadataWidth = width - rightWidth
  const identityWidth = metadataWidth * 0.6
  const identity = [
    ...wrapPdfText(`${reference} / ${document.panel.name}`, bold, textSize, identityWidth - 16),
    ...wrapPdfText(document.materialName, font, textSize, identityWidth - 16),
    ...wrapPdfText(`${String(document.panel.lengthMm)} × ${String(document.panel.widthMm)} × ${String(document.panel.thicknessMm)} mm`, font, textSize, identityWidth - 16),
  ]
  const parameters = [`Kerf: ${String(document.settings.kerfMm)} mm`, `Edge margin: ${String(document.settings.edgeMarginMm)} mm`, ...(document.panel.grainDirection === 'none' ? [] : [`Grain: ${document.panel.grainDirection}`])]
    .flatMap(text => wrapPdfText(text, font, textSize, metadataWidth - identityWidth - 16))
  const metadataHeight = Math.max(identity.length, parameters.length, 3) * lineHeight + 16
  const parts = panelContainedParts(document)
  // Multiple compact table columns reduce height while retaining measured, complete names.
  const candidates = Array.from({ length: Math.min(3, Math.max(1, Math.floor(width / 165))) }, (_, index) => {
    const count = index + 1
    const columnWidth = width / count
    const columns: { lines: string[]; height: number }[][] = Array.from({ length: count }, () => [])
    const heights = Array.from({ length: count }, () => 0)
    for (const part of parts) {
      const lines = [...wrapPdfText(`${part.ref}  ${part.name}`, font, textSize, columnWidth - 16), ...wrapPdfText(`${part.dimensions}   Qty ${String(part.quantity)}`, font, textSize, columnWidth - 16)]
      const height = lines.length * lineHeight + 5
      const column = heights.indexOf(Math.min(...heights))
      columns[column]?.push({ lines, height })
      heights[column] = (heights[column] ?? 0) + height
    }
    return { columns, columnWidth, height: Math.max(...heights) + 23 }
  })
  const table = candidates.reduce((best, candidate) => candidate.height < best.height ? candidate : best)
  const top = 36 + metadataHeight + table.height
  // Physical paper cannot contain an unlimited list: fail explicitly rather than omit entries.
  if (size.height - top < 160) throw new Error('The panel parts list does not fit this sheet at readable size. Choose a larger paper size or another orientation.')
  return { x, width, top, metadataHeight, identityWidth, rightWidth, identity, parameters, table, parts, sheetPosition: { x: x + width - rightWidth + 8, y: top - 44 } }
}

export function drawPanelTitleBlock(page: PDFPage, font: PDFFont, bold: PDFFont, block: ReturnType<typeof layoutPanelTitleBlock>, scale: string): void {
  const line = (x1: number, y1: number, x2: number, y2: number) => { page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.4, color: rule }) }
  const text = (value: string, x: number, y: number, selected = font) => { page.drawText(value, { x, y, size: textSize, font: selected, color: ink }) }
  const metadataBottom = block.top - block.metadataHeight
  page.drawRectangle({ x: 28, y: 36, width: page.getWidth() - 56, height: page.getHeight() - 52, borderColor: rule, borderWidth: 0.5 })
  line(block.x, block.top, block.x + block.width, block.top)
  line(block.x, metadataBottom, block.x + block.width, metadataBottom)
  for (const x of [block.x + block.identityWidth, block.x + block.width - block.rightWidth]) line(x, metadataBottom, x, block.top)
  block.identity.forEach((value, index) => { text(value, block.x + 8, block.top - 14 - index * lineHeight, index === 0 ? bold : font) })
  block.parameters.forEach((value, index) => { text(value, block.x + block.identityWidth + 8, block.top - 14 - index * lineHeight) })
  text(`Scale ${scale}`, block.sheetPosition.x, block.top - 18, bold)
  for (const [index, column] of block.table.columns.entries()) {
    const x = block.x + index * block.table.columnWidth
    if (index > 0) line(x, 36, x, metadataBottom)
    text('Contained parts (mm)', x + 8, metadataBottom - 13, bold)
    let y = metadataBottom - 27
    for (const row of column) {
      row.lines.forEach((value, lineIndex) => { text(value, x + 8, y - lineIndex * lineHeight) })
      y -= row.height
    }
  }
}
