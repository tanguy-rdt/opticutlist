import { rgb, type PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib'
import { wrapPdfText } from './pdf-text'

export const SHEET_MARGIN = 36
export const TABLE_BOTTOM = 120
export interface TableColumn { readonly label: string; readonly weight: number; readonly numeric?: boolean; readonly nowrap?: boolean }
export interface TableRow { readonly cells: readonly string[]; readonly kind?: 'parent' | 'child'; readonly keepWithNext?: boolean }
export interface TablePlacement { readonly page: PDFPage; readonly top: number; readonly bottom: number; readonly header: boolean; readonly rowIndex?: number; readonly widths: readonly number[] }

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
  function table(title: string, columns: readonly TableColumn[], rows: readonly (readonly string[] | TableRow)[]): void {
    const records: readonly TableRow[] = rows.length ? rows.map(row => 'cells' in row ? row : { cells: row }) : [{ cells: columns.map((_, index) => index === 0 ? 'None' : '') }]
    const contentWidths = columns.map((_, index) => records.reduce((maximum, row) => {
      const selected = row.kind === 'parent' ? bold : font
      const indent = row.kind === 'child' && index === 0 ? 8 : 0
      return Math.max(maximum, selected.widthOfTextAtSize(row.cells[index] ?? '', 8) + indent)
    }, 0))
    const minima = columns.map((column, index) => Math.max(bold.widthOfTextAtSize(column.label, 8), column.numeric || column.nowrap ? contentWidths[index] ?? 0 : 0) + 12)
    const minimumWidth = minima.reduce((sum, value) => sum + value, 0)
    if (minimumWidth > width) throw new Error('The table columns do not fit. Choose a larger paper size or orientation.')
    const demand = columns.map((column, index) => Math.max(1, Math.min(180, contentWidths[index] ?? 0) - (minima[index] ?? 0)) * column.weight)
    const totalDemand = demand.reduce((sum, value) => sum + value, 0)
    const widths = minima.map((minimum, index) => minimum + (width - minimumWidth) * (demand[index] ?? 0) / totalDemand)
    const measure = (cells: readonly string[], selected: PDFFont, child = false) => columns.map((_, index) => wrapPdfText(cells[index] ?? '', selected, 8, (widths[index] ?? 0) - 12 - (child && index === 0 ? 8 : 0)))
    const height = (lines: readonly (readonly string[])[]) => Math.max(1, ...lines.map(cell => cell.length)) * 11 + 10
    const header = measure(columns.map(column => column.label), bold)
    const headerHeight = height(header)
    const titleLines = wrapPdfText(title, bold, 12, width)
    const titleHeight = titleLines.length * 14 + 10
    const data = records.map(row => ({ ...row, lines: measure(row.cells, row.kind === 'parent' ? bold : font, row.kind === 'child') }))
    function draw(lines: readonly (readonly string[])[], rowHeight: number, isHeader: boolean, index: number, kind?: TableRow['kind']): void {
      if (!page) throw new Error('Missing table sheet')
      const top = y
      page.drawRectangle({ x: SHEET_MARGIN, y: y - rowHeight, width, height: rowHeight, color: isHeader ? rgb(0.13, 0.14, 0.13) : kind === 'parent' ? rgb(0.91, 0.92, 0.9) : index % 2 === 0 ? rgb(0.96, 0.96, 0.95) : rgb(1, 1, 1) })
      let x = SHEET_MARGIN
      lines.forEach((cell, columnIndex) => {
        const selected = isHeader || kind === 'parent' ? bold : font
        for (const [lineIndex, text] of cell.entries()) {
          const cellWidth = widths[columnIndex] ?? 0
          const textX = columns[columnIndex]?.numeric ? x + cellWidth - 6 - selected.widthOfTextAtSize(text, 8) : x + 6 + (kind === 'child' && columnIndex === 0 ? 8 : 0)
          page?.drawText(text, { x: textX, y: y - 14 - lineIndex * 11, size: 8, font: selected, color: isHeader ? rgb(1, 1, 1) : rgb(0.12, 0.15, 0.17) })
        }
        x += widths[columnIndex] ?? 0
      })
      y -= rowHeight
      page.drawLine({ start: { x: SHEET_MARGIN, y }, end: { x: SHEET_MARGIN + width, y }, thickness: 0.25, color: rgb(0.8, 0.8, 0.78) })
      placements.push({ page, top, bottom: y, header: isHeader, widths, ...(isHeader ? {} : { rowIndex: index }) })
    }
    const begin = () => {
      if (!page) newPage(title)
      for (const [index, line] of titleLines.entries()) page?.drawText(line, { x: SHEET_MARGIN, y: y - 12 - index * 14, size: 12, font: bold, color: rgb(0.12, 0.15, 0.17) })
      y -= titleHeight
      draw(header, headerHeight, true, 0)
    }
    if (!page || y - titleHeight - headerHeight - height(data[0]?.lines ?? []) - (data[0]?.keepWithNext ? height(data[1]?.lines ?? []) : 0) < TABLE_BOTTOM) newPage(title)
    begin()
    for (const [index, row] of data.entries()) {
      const rowHeight = height(row.lines)
      const requiredHeight = rowHeight + (row.keepWithNext && data[index + 1] ? height(data[index + 1]?.lines ?? []) : 0)
      if (requiredHeight + headerHeight + titleHeight > size.height - SHEET_MARGIN - TABLE_BOTTOM) throw new Error('A table row is too tall for the selected paper size. Shorten the record text or use larger paper.')
      if (y - requiredHeight < TABLE_BOTTOM) { newPage(title); begin() }
      draw(row.lines, rowHeight, false, index, row.kind)
    }
    y -= 22
  }
  return { table, placements }
}
