import { rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { PdfBox } from './pdf-layout'

const ink = rgb(0.14, 0.14, 0.14)
const rule = rgb(0.6, 0.6, 0.6)
/** Shared technical footer treatment; numbering is filled after document pagination. */
export function drawScaleSheetCells(page: PDFPage, font: PDFFont, bold: PDFFont, box: PdfBox, scale: string, sheetFontSize = 8) {
  const half = box.width / 2
  const center = (value: string, middle: number, y: number, selected: PDFFont) => {
    if (selected.widthOfTextAtSize(value, 8) > half - 8) throw new Error('The technical footer value does not fit its cell.')
    page.drawText(value, { x: middle - selected.widthOfTextAtSize(value, 8) / 2, y, size: 8, font: selected, color: ink })
  }
  page.drawLine({ start: { x: box.x, y: box.y + box.height }, end: { x: box.x + box.width, y: box.y + box.height }, thickness: 0.3, color: rule })
  page.drawLine({ start: { x: box.x + half, y: box.y }, end: { x: box.x + half, y: box.y + box.height }, thickness: 0.3, color: rule })
  center('SCALE', box.x + half / 2, box.y + box.height - 11, bold)
  center('SHEET', box.x + half * 1.5, box.y + box.height - 11, bold)
  center(scale, box.x + half / 2, box.y + 6, font)
  return { x: box.x + half, y: box.y + 6, width: half, fontSize: sheetFontSize }
}
