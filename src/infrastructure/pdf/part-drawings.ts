import { rgb, type PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib'
import type { Part } from '../../domain/model/part'
import { pdfPageSize } from './pdf-layout'
import type { PdfOrientation, PdfPageSize } from '../../application/export/cutting-plan-pdf-service'
import { drawDimensions, drawGrain } from './technical-drawing'
import { partDrawingCells, partDrawingGeometry } from './part-drawing-grid'
import { layoutPartTitleBlock, drawPartTitleBlock } from './part-title-block'
import { drawTechnicalFrame, technicalInk as ink, type SheetNumberPosition } from './technical-sheet'
import { wrapPdfText } from './pdf-text'

const gridRule = rgb(0.8, 0.8, 0.8)

/** One cell per nominal definition; independent physical scales, one shared title block per page. */
export function appendPartDrawings(
  pdf: PDFDocument,
  font: PDFFont,
  bold: PDFFont,
  parts: readonly Part[],
  paper: PdfPageSize,
  orientation: PdfOrientation,
  frame: (page: PDFPage, numbering: SheetNumberPosition) => void,
  projectName = ''
): void {
  const size = pdfPageSize(paper, orientation)
  const footer = layoutPartTitleBlock(size.width - 56)
  const cellWidth = (size.width - 56) / 2
  const records = parts.map((part, index) => {
    const name = wrapPdfText(`P${String(index + 1)} — ${part.name}`, bold, 8, cellWidth - 20)
    const metadata = wrapPdfText(`Thickness: ${String(part.thicknessMm)} mm / Qty: ${String(part.quantity)}${part.grainDirection === 'none' ? '' : ' / Grain: ' + part.grainDirection}`, font, 8, cellWidth - 20)
    return { part, name, metadata, headerHeight: 14 + (name.length + metadata.length) * 10 }
  })
  for (let offset = 0; offset < records.length;) {
    const candidates = records.slice(offset, offset + 6)
    const minimumHeight = Math.max(170, ...candidates.map(record => record.headerHeight + 100))
    const cells = partDrawingCells(size, minimumHeight, records.length - offset, footer.height)
    const page = pdf.addPage([size.width, size.height])
    drawTechnicalFrame(page)
    // One faint grid, rather than framed metadata cells or duplicated shared borders.
    const middle = size.width / 2
    const gridBottom = cells.at(-1)?.y ?? footer.top
    page.drawLine({ start: { x: middle, y: gridBottom }, end: { x: middle, y: size.height - 16 }, thickness: 0.2, color: gridRule })
    for (const [index, cell] of cells.entries()) {
      const record = records[offset + index]
      if (!record) {
        break
      }
      const { part, name, metadata, headerHeight } = record
      if (index % 2 === 0 && cell.y > footer.top) {
        page.drawLine({ start: { x: 28, y: cell.y }, end: { x: size.width - 28, y: cell.y }, thickness: 0.2, color: gridRule })
      }
      const rect = { xMm: 0, yMm: 0, lengthMm: part.lengthMm, widthMm: part.widthMm }
      const { box } = partDrawingGeometry(rect, cell, headerHeight, 0)
      page.drawRectangle({ ...box, borderColor: ink, borderWidth: 0.5 })
      drawDimensions(page, font, box, part.lengthMm, part.widthMm, 'arrows')
      drawGrain(page, box, part.grainDirection)
      const labels = [...name.map(text => ({ text, font: bold })), ...metadata.map(text => ({ text, font }))]
      const inside = box.height >= labels.length * 10 + 30 && labels.every(label => label.font.widthOfTextAtSize(label.text, 8) <= box.width - 16)
      const labelTop = inside ? box.y + box.height / 2 + (labels.length - 1) * 5 - 3 : box.y + box.height + 14 + (labels.length - 1) * 10
      labels.forEach((label, lineIndex) => {
        page.drawText(label.text, {
          x: box.x + (box.width - label.font.widthOfTextAtSize(label.text, 8)) / 2,
          y: labelTop - lineIndex * 10,
          font: label.font,
          size: 8,
          color: ink
        })
      })
    }
    frame(page, drawPartTitleBlock(page, font, bold, footer, projectName))
    offset += cells.length
  }
}
