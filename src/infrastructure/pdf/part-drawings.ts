import { type PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib'
import type { Part } from '../../domain/model/part'
import { pdfPageSize } from './pdf-layout'
import type { PdfOrientation, PdfPageSize } from '../../application/export/cutting-plan-pdf-service'
import { drawDimensions, drawGrain, scaleLabel } from './technical-drawing'
import { partDrawingCells, partDrawingGeometry } from './part-drawing-grid'
import { layoutPartTitleBlock, drawPartTitleBlock } from './part-title-block'
import { technicalInk as ink, technicalRule, type SheetNumberPosition } from './technical-sheet'
import { wrapPdfText } from './pdf-text'

/** One cell per Part definition; its measured title block reserves space before physical scaling. */
export function appendPartDrawings(pdf: PDFDocument, font: PDFFont, bold: PDFFont, parts: readonly Part[], paper: PdfPageSize, orientation: PdfOrientation, materialName: (part: Part) => string, frame: (page: PDFPage, numbering: readonly SheetNumberPosition[]) => void): void {
  const size = pdfPageSize(paper, orientation)
  const recordFor = (part: Part, index: number, width: number) => layoutPartTitleBlock(part, 'P' + String(index + 1), materialName(part), width, font, bold)
  for (let offset = 0; offset < parts.length;) {
    const candidates = parts.slice(offset, offset + 6)
    const columns = candidates.length === 1 ? 1 : 2
    const minimumHeight = Math.max(170, ...candidates.map((part, index) => recordFor(part, offset + index, (size.width - 56) / columns).height + 112))
    const first = parts[offset]
    if (!first) break
    // Unusually tall metadata gets a wider, single-cell sheet rather than smaller text.
    const cells = minimumHeight > size.height - 96
      ? partDrawingCells(size, recordFor(first, offset, size.width - 56).height + 112, 1)
      : partDrawingCells(size, minimumHeight, parts.length - offset)
    const page = pdf.addPage([size.width, size.height])
    const numbering: SheetNumberPosition[] = []
    page.drawText('Individual part drawings', { x: 36, y: size.height - 42, font: bold, size: 13, color: ink })
    for (const [index, cell] of cells.entries()) {
      const part = parts[offset + index]
      if (!part) break
      const footer = recordFor(part, offset + index, cell.width)
      page.drawRectangle({ ...cell, borderWidth: 0.5, borderColor: technicalRule })
      const rect = { xMm: 0, yMm: 0, lengthMm: part.lengthMm, widthMm: part.widthMm }
      const { box, transform } = partDrawingGeometry(rect, cell, 10, footer.height)
      page.drawRectangle({ ...box, borderColor: ink, borderWidth: 0.5 })
      drawDimensions(page, font, box, part.lengthMm, part.widthMm)
      drawGrain(page, box, part.grainDirection)
      const name = wrapPdfText(part.name, bold, 8, cell.width - 20)
      if (box.height >= name.length * 10 + 34 && name.every(line => bold.widthOfTextAtSize(line, 8) <= box.width - 16)) {
        name.forEach((line, lineIndex) => {
          page.drawText(line, { x: box.x + (box.width - bold.widthOfTextAtSize(line, 8)) / 2, y: box.y + box.height / 2 + (name.length - 1) * 5 - 3 - lineIndex * 10, font: bold, size: 8, color: ink })
        })
      }
      const scale = scaleLabel(transform)
      numbering.push(drawPartTitleBlock(page, font, bold, cell, footer, scale))
    }
    frame(page, numbering)
    offset += cells.length
  }
}
