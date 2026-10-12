import { rgb, type PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib'
import { wrapPdfText } from './pdf-text'

export const SHEET_MARGIN = 36
export const TABLE_BOTTOM = 120
export interface TableColumn { readonly label: string; readonly weight: number; readonly numeric?: boolean }
export interface TablePlacement { readonly page: PDFPage; readonly top: number; readonly bottom: number; readonly header: boolean }

/** Shared cursor packs short tables together; a complete measured row always stays on one sheet. */
export function createPdfTables(pdf: PDFDocument, font: PDFFont, bold: PDFFont, size: { width: number; height: number }, onPage: (page: PDFPage, title: string) => void) {
  let page: PDFPage | undefined
  let y = 0
  const placements: TablePlacement[] = []
  const width = size.width - SHEET_MARGIN * 2
  function newPage(title: string): PDFPage {
    page = pdf.addPage([size.width, size.height]); y = size.height - SHEET_MARGIN
    onPage(page, title)
    return page
  }
  function table(title: string, columns: readonly TableColumn[], rows: readonly (readonly string[])[]): void {
    const total = columns.reduce((sum, column) => sum + column.weight, 0)
    const widths = columns.map(column => width * column.weight / total)
    const measure = (cells: readonly string[], selected: PDFFont) => cells.map((cell, index) => wrapPdfText(cell, selected, 8, (widths[index] ?? 0) - 12))
    const height = (lines: readonly (readonly string[])[]) => Math.max(1, ...lines.map(cell => cell.length)) * 11 + 10
    const header = measure(columns.map(column => column.label), bold)
    const headerHeight = height(header)
    const titleLines = wrapPdfText(title, bold, 12, width)
    const titleHeight = titleLines.length * 14 + 10
    const data = (rows.length ? rows : [columns.map((_, index) => index === 0 ? 'None' : '')]).map(cells => measure(cells, font))
    function draw(lines: readonly (readonly string[])[], rowHeight: number, isHeader: boolean, index: number): void {
      if (!page) throw new Error('Missing table sheet')
      const top = y
      page.drawRectangle({ x: SHEET_MARGIN, y: y - rowHeight, width, height: rowHeight, color: isHeader ? rgb(0.13, 0.14, 0.13) : index % 2 === 0 ? rgb(0.96, 0.96, 0.95) : rgb(1, 1, 1) })
      let x = SHEET_MARGIN
      lines.forEach((cell, columnIndex) => {
        const selected = isHeader ? bold : font
        for (const [lineIndex, text] of cell.entries()) {
          const cellWidth = widths[columnIndex] ?? 0
          const textX = columns[columnIndex]?.numeric ? x + cellWidth - 6 - selected.widthOfTextAtSize(text, 8) : x + 6
          page?.drawText(text, { x: textX, y: y - 14 - lineIndex * 11, size: 8, font: selected, color: isHeader ? rgb(1, 1, 1) : rgb(0.12, 0.15, 0.17) })
        }
        x += widths[columnIndex] ?? 0
      })
      y -= rowHeight
      page.drawLine({ start: { x: SHEET_MARGIN, y }, end: { x: SHEET_MARGIN + width, y }, thickness: 0.25, color: rgb(0.8, 0.8, 0.78) })
      placements.push({ page, top, bottom: y, header: isHeader })
    }
    const begin = () => {
      if (!page) newPage(title)
      for (const [index, line] of titleLines.entries()) page?.drawText(line, { x: SHEET_MARGIN, y: y - 12 - index * 14, size: 12, font: bold, color: rgb(0.12, 0.15, 0.17) })
      y -= titleHeight
      draw(header, headerHeight, true, 0)
    }
    if (!page || y - titleHeight - headerHeight - height(data[0] ?? []) < TABLE_BOTTOM) newPage(title)
    begin()
    for (const [index, lines] of data.entries()) {
      const rowHeight = height(lines)
      if (rowHeight + headerHeight + titleHeight > size.height - SHEET_MARGIN - TABLE_BOTTOM) throw new Error('A table row is too tall for the selected paper size. Shorten the record text or use larger paper.')
      if (y - rowHeight < TABLE_BOTTOM) { newPage(title); begin() }
      draw(lines, rowHeight, false, index)
    }
    y -= 22
  }
  return { table, placements }
}
