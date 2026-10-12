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
    expect(purchasingSchedule([{ panel: panel(), count: 2 }])).toEqual([['Birch plywood', 'Workshop panel', '210 x 110 x 18 mm', '2', 'Supplier', 'Not available', 'Not available']])
  })
  it('keeps known totals separate per currency, including zero prices', () => {
    const source = panel()
    const rows = purchasingSchedule([{ panel: { ...source, pricing: { price: 19.95, currency: 'EUR' } }, count: 2 }, { panel: { ...source, pricing: { price: 5, currency: 'USD' } }, count: 3 }, { panel: { ...source, pricing: { price: 0, currency: 'EUR' } }, count: 1 }])
    expect(rows[0]?.slice(-2)).toEqual(['19.95 EUR', '39.90 EUR'])
    expect(rows.slice(-2).map(row => [row[0], row[6]])).toEqual([['Total', '39.90 EUR'], ['Total', '15.00 USD']])
  })
  it('labels partial totals and never infers an owned-stock price', () => {
    const source = panel()
    const rows = purchasingSchedule([{ panel: { ...source, pricing: { price: 10, currency: 'EUR' } }, count: 1 }, { panel: source, count: 2 }])
    expect(rows.at(-1)?.[0]).toBe('Known subtotal')
    expect(rows.at(-1)?.[6]).toBe('10.00 EUR')
    expect(purchasingSchedule([])).toEqual([])
  })
})
