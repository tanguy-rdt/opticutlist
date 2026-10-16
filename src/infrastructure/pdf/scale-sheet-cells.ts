import { type PDFFont, type PDFPage } from 'pdf-lib'
import type { PdfBox } from './pdf-layout'

import { technicalInk as ink, technicalRule as rule } from './technical-sheet'
/** Shared technical footer treatment; numbering is filled after document pagination. */
export function drawScaleSheetCells(page: PDFPage, font: PDFFont, bold: PDFFont, box: PdfBox, scale: string, sheetFontSize = 8) {
  const half = box.width / 2
  const center = (value: string, middle: number, y: number, selected: PDFFont) => {
    if (selected.widthOfTextAtSize(value, 8) > half - 8) throw new Error('The technical footer value does not fit its cell.')
    page.drawText(value, { x: middle - selected.widthOfTextAtSize(value, 8) / 2, y, size: 8, font: selected, color: ink })
  }
  page.drawLine({ start: { x: box.x, y: box.y + box.height }, end: { x: box.x + box.width, y: box.y + box.height }, thickness: 0.3, color: rule })
  page.drawLine({ start: { x: box.x + half, y: box.y }, end: { x: box.x + half, y: box.y + box.height }, thickness: 0.3, color: rule })
  const offset = (box.height - 29) / 2
  center('SCALE', box.x + half / 2, box.y + offset + 18, bold)
  center('SHEET', box.x + half * 1.5, box.y + offset + 18, bold)
  center(scale, box.x + half / 2, box.y + offset + 6, font)
  return { x: box.x + half, y: box.y + offset + 6, width: half, fontSize: sheetFontSize }
}
