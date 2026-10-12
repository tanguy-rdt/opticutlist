import { rgb, type PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib'
import type { Part } from '../../domain/model/part'
import { pdfPageSize } from './pdf-layout'
import type { PdfOrientation, PdfPageSize } from '../../application/export/cutting-plan-pdf-service'
import { drawDimensions, drawGrain, scaleLabel } from './technical-drawing'
import { partDrawingCells, partDrawingGeometry } from './part-drawing-grid'
import { wrapPdfText } from './pdf-text'

const ink = rgb(0.12, 0.12, 0.12)
const muted = rgb(0.35, 0.35, 0.35)
/** One cell per Part definition, not per requested copy. Reuses physical scaling and dimension geometry. */
export function appendPartDrawings(pdf: PDFDocument, font: PDFFont, bold: PDFFont, parts: readonly Part[], paper: PdfPageSize, orientation: PdfOrientation, materialName: (part: Part) => string, frame: (page: PDFPage) => void): void {
  const size = pdfPageSize(paper, orientation)
  const cellWidth = (size.width - 72) / 2
  const records = parts.map((part, index) => {
    const name = wrapPdfText(part.name, bold, 8, cellWidth - 20)
    const material = wrapPdfText(materialName(part), font, 8, cellWidth - 20)
    const metadata = wrapPdfText(`Thickness: ${String(part.thicknessMm)} mm / Qty: ${String(part.quantity)}`, font, 8, cellWidth - 20)
    const scaleSuffix = part.grainDirection === 'none' ? '' : ` / Grain: ${part.grainDirection}`
    return { part, identifier: `P${String(index + 1)}`, name, material, metadata, scaleSuffix, headerHeight: 24 + name.length * 10, footerHeight: 12 + (material.length + metadata.length + 1) * 10 }
  })
  for (let offset = 0; offset < records.length;) {
    const candidates = records.slice(offset, offset + 6)
    const minimumHeight = Math.max(170, ...candidates.map(record => record.headerHeight + record.footerHeight + 92))
    const cells = partDrawingCells(size, minimumHeight)
    const page = pdf.addPage([size.width, size.height])
    frame(page)
    page.drawText('Individual part drawings', { x: 36, y: size.height - 42, font: bold, size: 13, color: ink })
    for (const [index, cell] of cells.entries()) {
      const record = records[offset + index]
      if (!record) break
      const { part, identifier, name, material, metadata, scaleSuffix, headerHeight, footerHeight } = record
      page.drawRectangle({ ...cell, borderWidth: 0.25, borderColor: rgb(0.9, 0.9, 0.9) })
      const rect = { xMm: 0, yMm: 0, lengthMm: part.lengthMm, widthMm: part.widthMm }
      const { box, transform } = partDrawingGeometry(rect, cell, headerHeight, footerHeight)
      page.drawRectangle({ ...box, borderColor: ink, borderWidth: 0.5 })
      drawDimensions(page, font, box, part.lengthMm, part.widthMm)
      drawGrain(page, box, part.grainDirection)
      page.drawText(identifier, { x: cell.x + 10, y: cell.y + cell.height - 14, size: 8, font: bold, color: ink })
      // Keep the complete name outside when a narrow shape cannot accommodate it comfortably.
      const inside = box.height >= name.length * 10 + 34 && name.every(line => bold.widthOfTextAtSize(line, 8) <= box.width - 16)
      name.forEach((line, lineIndex) => {
        const x = inside ? box.x + box.width / 2 : cell.x + cell.width / 2
        const y = inside ? box.y + box.height / 2 + (name.length - 1) * 5 - 3 : cell.y + cell.height - 30 - lineIndex * 10
        page.drawText(line, { x: x - bold.widthOfTextAtSize(line, 8) / 2, y: inside ? y - lineIndex * 10 : y, font: bold, size: 8, color: ink })
      })
      const footer = [...material, ...metadata, `Scale ${scaleLabel(transform)}${scaleSuffix}`]
      footer.forEach((line, lineIndex) => {
        page.drawText(line, { x: cell.x + cell.width / 2 - font.widthOfTextAtSize(line, 8) / 2, y: cell.y + footerHeight - 12 - lineIndex * 10, font, size: 8, color: muted })
      })
    }
    offset += cells.length
  }
}
