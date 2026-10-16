import type { PDFFont, PDFPage } from 'pdf-lib'
import type { Part } from '../../domain/model/part'
import type { PdfBox } from './pdf-layout'
import { wrapPdfText } from './pdf-text'
import { drawScaleSheetCells } from './scale-sheet-cells'
import { technicalInk, technicalRule, technicalTextSize as textSize, technicalLineHeight as lineHeight } from './technical-sheet'

export function layoutPartTitleBlock(part: Part, reference: string, material: string, width: number, font: PDFFont, bold: PDFFont) {
  const technicalWidth = Math.min(145, width * 0.38)
  const mainWidth = width - technicalWidth
  const name = wrapPdfText(reference + ' — ' + part.name, bold, textSize, mainWidth - 12)
  const metadata = [
    ...wrapPdfText(material, font, textSize, mainWidth - 12),
    ...wrapPdfText(`${String(part.lengthMm)} × ${String(part.widthMm)} × ${String(part.thicknessMm)} mm`, font, textSize, mainWidth - 12),
    'Quantity: ' + String(part.quantity),
    ...(part.grainDirection === 'none' ? [] : ['Grain: ' + part.grainDirection]),
  ]
  return { name, metadata, mainWidth, technicalWidth, height: 12 + (name.length + metadata.length) * lineHeight }
}

export function drawPartTitleBlock(page: PDFPage, font: PDFFont, bold: PDFFont, cell: PdfBox, block: ReturnType<typeof layoutPartTitleBlock>, scale: string) {
  const top = cell.y + block.height
  const end = cell.x + block.mainWidth
  page.drawLine({ start: { x: cell.x, y: top }, end: { x: cell.x + cell.width, y: top }, thickness: 0.3, color: technicalRule })
  page.drawLine({ start: { x: end, y: cell.y }, end: { x: end, y: top }, thickness: 0.3, color: technicalRule })
  let y = top - 12
  for (const text of block.name) {
    page.drawText(text, { x: cell.x + 6, y, font: bold, size: textSize, color: technicalInk })
    y -= lineHeight
  }
  for (const text of block.metadata) {
    page.drawText(text, { x: cell.x + 6, y, font, size: textSize, color: technicalInk })
    y -= lineHeight
  }
  return drawScaleSheetCells(page, font, bold, { x: end, y: cell.y, width: block.technicalWidth, height: block.height }, scale)
}
