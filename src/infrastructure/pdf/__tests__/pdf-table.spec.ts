import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { createPdfTables, SHEET_MARGIN, TABLE_BOTTOM } from '../pdf-table'
import { pdfPageSize } from '../pdf-layout'
import { purchasingSchedule } from '../purchasing-schedule'
import { prepareProjectPdfDocument } from '../../../application/export/cutting-plan-pdf-service'
import { multiPanelPdfRequest } from '../../../application/export/__tests__/pdf-fixtures'

async function tableFixture(pageSize: 'A4' | 'A3', orientation: 'portrait' | 'landscape') {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const tables = createPdfTables(pdf, font, bold, pdfPageSize(pageSize, orientation), () => {})
  return { pdf, tables }
}
describe('Fabrication table pagination', () => {
  it.each(['A4', 'A3'] as const)('keeps whole rows within %s printable bounds and repeats headers', async size => {
    for (const orientation of ['portrait', 'landscape'] as const) {
      const { pdf, tables } = await tableFixture(size, orientation)
      tables.table('Complete parts list', [{ label: 'Reference', weight: 1 }, { label: 'Name', weight: 3 }], Array.from({ length: 120 }, (_, index) => [`P${String(index + 1)}`, 'Shelf with a long descriptive name '.repeat(3)]))
      expect(pdf.getPageCount()).toBeGreaterThan(1)
      expect(tables.placements.filter(row => !row.header)).toHaveLength(120)
      for (const page of pdf.getPages()) {
        const rows = tables.placements.filter(row => row.page === page)
        expect(rows[0]?.header).toBe(true)
        expect(rows.some(row => !row.header)).toBe(true)
        for (const row of rows) { expect(row.bottom).toBeGreaterThanOrEqual(TABLE_BOTTOM); expect(row.top).toBeLessThanOrEqual(page.getHeight() - SHEET_MARGIN) }
      }
    }
  })
  it('packs short tables together without blank pages, and renders empty tables explicitly', async () => {
    const { pdf, tables } = await tableFixture('A4', 'portrait')
    const columns = [{ label: 'Name', weight: 1 }]
    tables.table('Parts', columns, [['Shelf']]); tables.table('Materials', columns, [['Oak']]); tables.table('Empty', columns, [])
    expect(pdf.getPageCount()).toBe(1)
    expect(tables.placements.filter(row => row.header)).toHaveLength(3)
    expect(tables.placements.filter(row => !row.header)).toHaveLength(3)
  })
  it('rejects an oversized row explicitly instead of splitting or dropping it', async () => {
    const { tables } = await tableFixture('A4', 'landscape')
    expect(() => { tables.table('Parts', [{ label: 'Name', weight: 1 }], [['Long name '.repeat(1500)]]) }).toThrow('too tall')
  })
})
describe('Purchasing table data', () => {
  function panel() {
    const prepared = prepareProjectPdfDocument(multiPanelPdfRequest())
    if (!prepared.ok || !prepared.document.panels[0]) throw new Error('Invalid fixture')
    return prepared.document.panels[0]
  }
  it('preserves panel data and quantity, without inventing missing prices', () => {
    expect(purchasingSchedule([{ panel: panel(), count: 2 }])).toEqual([['Workshop panel', 'Birch plywood', '210 × 110 × 18 mm', '2', 'Supplier', 'N/A', 'N/A'], ['Total:', '', '', '', '', '', 'N/A']])
  })
  it('keeps known totals separate per currency, including zero prices', () => {
    const source = panel()
    const rows = purchasingSchedule([{ panel: { ...source, pricing: { price: 19.95, currency: 'EUR' } }, count: 2 }, { panel: { ...source, pricing: { price: 5, currency: 'USD' } }, count: 3 }, { panel: { ...source, pricing: { price: 0, currency: 'EUR' } }, count: 1 }])
    expect(rows[0]?.slice(-2)).toEqual(['19.95 EUR', '39.90 EUR'])
    expect(rows.slice(-2).map(row => [row[0], row[6]])).toEqual([['Total:', '39.90 EUR'], ['Total:', '15.00 USD']])
  })
  it('labels partial totals and never infers an owned-stock price', () => {
    const source = panel()
    const rows = purchasingSchedule([{ panel: { ...source, pricing: { price: 10, currency: 'EUR' } }, count: 1 }, { panel: source, count: 2 }])
    expect(rows.at(-1)?.[0]).toBe('Subtotal (partial):')
    expect(rows.at(-1)?.[6]).toBe('10.00 EUR')
    expect(purchasingSchedule([])).toEqual([['Total:', '', '', '', '', '', 'N/A']])
  })
})

it.each(['A4', 'A3'] as const)('keeps hierarchical parent rows with their first child across %s page breaks', async paper => {
  for (const orientation of ['portrait', 'landscape'] as const) {
    const { pdf, tables } = await tableFixture(paper, orientation)
    const columns = [{ label: 'Ref', weight: 1, nowrap: true }, { label: 'Panel / Part name', weight: 3 }, { label: 'Dimensions (mm)', weight: 2, nowrap: true }, { label: 'Qty', weight: 1, numeric: true }]
    const rows = Array.from({ length: 30 }, (_, index) => [
      { cells: [`Panel ${String(index + 1)}`, 'Birch panel', '2500 × 1250 × 18 mm', '1'], kind: 'parent' as const, keepWithNext: true },
      { cells: ['P1', 'Shelf', '500 × 200 × 18 mm', '2'], kind: 'child' as const },
    ]).flat()
    tables.table('Panel inventory', columns, rows)
    const body = tables.placements.filter(row => !row.header)
    expect(body).toHaveLength(60)
    expect(pdf.getPageCount()).toBeGreaterThan(1)
    for (let index = 0; index < 60; index += 2) expect(body[index]?.page).toBe(body[index + 1]?.page)
    for (const page of pdf.getPages()) expect(tables.placements.filter(row => row.page === page)[0]?.header).toBe(true)
  }
})

it('moves a parent/child pair to the next sheet before drawing an orphaned table heading', async () => {
  const { pdf, tables } = await tableFixture('A4', 'landscape')
  tables.table('Parts', [{ label: 'Part name', weight: 1 }], Array.from({ length: 14 }, () => ['Shelf']))
  tables.table('Panel inventory', [{ label: 'Ref', weight: 1 }], [{ cells: ['Panel 1'], kind: 'parent', keepWithNext: true }, { cells: ['P1'], kind: 'child' }])
  expect(pdf.getPageCount()).toBe(2)
  expect(tables.placements.filter(row => row.page === pdf.getPage(0) && row.header)).toHaveLength(1)
  expect(tables.placements.filter(row => row.page === pdf.getPage(1) && !row.header)).toHaveLength(2)
})

it('measures single-line headers and unbroken numeric cells while wrapping long names', async () => {
  const { pdf, tables } = await tableFixture('A4', 'portrait')
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const columns = [{ label: 'Panel reference', weight: 2 }, { label: 'Material', weight: 1 }, { label: 'Dimensions (mm)', weight: 1, nowrap: true }, { label: 'Qty', weight: 1, numeric: true }, { label: 'Unit price', weight: 1, numeric: true }, { label: 'Total', weight: 1, numeric: true }]
  const cells = ['Workshop reference '.repeat(10), 'Birch', '2500 × 1250 × 18 mm', '1234', '19.95 EUR', '24618.30 EUR']
  tables.table('Purchasing', columns, [cells])
  const header = tables.placements[0]
  expect(header?.top && header.top - header.bottom).toBe(21)
  for (const [index, column] of columns.entries()) {
    const width = header?.widths[index] ?? 0
    expect(width - 12).toBeGreaterThanOrEqual(bold.widthOfTextAtSize(column.label, 8))
    if (column.numeric || column.nowrap) expect(width - 12).toBeGreaterThanOrEqual(font.widthOfTextAtSize(cells[index] ?? '', 8))
  }
  const row = tables.placements[1]
  expect(row?.top && row.top - row.bottom).toBeGreaterThan(21)
})

it('rejects unbreakable columns that exceed the printable width instead of clipping cells', async () => {
  const { tables } = await tableFixture('A4', 'portrait')
  expect(() => { tables.table('Parts', [{ label: 'Dimensions (mm)', weight: 1, nowrap: true }], [['1234567890 × '.repeat(15)]]) }).toThrow('columns do not fit')
})

it('formats absent, complete and partial purchasing totals without inventing costs or mixing currencies', () => {
  const prepared = prepareProjectPdfDocument(multiPanelPdfRequest())
  if (!prepared.ok || !prepared.document.panels[0]) throw new Error('Missing fixture')
  const source = prepared.document.panels[0]
  expect(purchasingSchedule([{ panel: source, count: 2 }]).at(-1)).toEqual(['Total:', '', '', '', '', '', 'N/A'])
  expect(purchasingSchedule([{ panel: { ...source, pricing: { price: 10, currency: 'EUR' } }, count: 2 }]).at(-1)).toEqual(['Total:', '', '', '', '', '', '20.00 EUR'])
  const mixed = purchasingSchedule([{ panel: { ...source, pricing: { price: 10, currency: 'EUR' } }, count: 2 }, { panel: { ...source, pricing: { price: 5, currency: 'USD' } }, count: 3 }, { panel: source, count: 1 }])
  expect(mixed.slice(-2).map(row => [row[0], row[6]])).toEqual([['Subtotal (partial):', '20.00 EUR'], ['Subtotal (partial):', '15.00 USD']])
  expect(mixed.flat().join(' ')).not.toContain('partial): N/A')
})
