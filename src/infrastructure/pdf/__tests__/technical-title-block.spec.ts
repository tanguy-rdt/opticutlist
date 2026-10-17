import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import { cuttingSettingsContext, drawTechnicalTitleBlock, technicalTitleBlockLayout } from '../technical-title-block'
import { pdfPageSize } from '../pdf-layout'

describe('Unified technical title block', () => {
  it.each(['portrait', 'landscape'] as const)('uses identical borders and measured centered technical cells for every context in %s', async orientation => {
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
    const size = pdfPageSize('A4', orientation)
    const block = technicalTitleBlockLayout(size.width - 56)
    const borders: unknown[] = []
    for (const context of [cuttingSettingsContext({ kerfMm: 2.5, edgeMarginMm: 5 }), { label: 'UNITS', lines: ['Millimeters (mm)'] }]) {
      const page = pdf.addPage([size.width, size.height])
      const text = vi.spyOn(page, 'drawText')
      const lines = vi.spyOn(page, 'drawLine')
      const position = drawTechnicalTitleBlock(page, font, bold, block, { projectName: 'Kitchen cabinet', context, scale: 'N/A' })
      borders.push(lines.mock.calls)
      expect(position.bold).toBe(true)
      expect(text.mock.calls.find(([label]) => label === 'Kitchen cabinet')?.[1]?.font).toBe(bold)
      expect(text.mock.calls.some(([label]) => label === context.label)).toBe(true)
      for (const [label, options] of text.mock.calls) {
        if (!options?.font || options.x === undefined || options.y === undefined || !options.size) throw new Error('Missing text geometry')
        expect(options.y).toBeGreaterThan(36)
        expect(options.y + options.font.heightAtSize(options.size, { descender: false })).toBeLessThan(block.top)
        expect(options.x).toBeGreaterThanOrEqual(34)
        expect(options.x + options.font.widthOfTextAtSize(label, options.size)).toBeLessThanOrEqual(size.width - 34)
      }
      const scale = text.mock.calls.find(([label]) => label === 'SCALE')?.[1]
      const sheet = text.mock.calls.find(([label]) => label === 'SHEET')?.[1]
      const value = text.mock.calls.find(([label]) => label === 'N/A')?.[1]
      if (!scale || !sheet || !value || scale.x === undefined || sheet.x === undefined || value.x === undefined || scale.y === undefined || value.y === undefined) throw new Error('Missing centered cells')
      expect(scale.x + font.widthOfTextAtSize('SCALE', 6) / 2).toBeCloseTo(position.x - block.cellWidth / 2)
      expect(value.x + font.widthOfTextAtSize('N/A', 8) / 2).toBeCloseTo(position.x - block.cellWidth / 2)
      expect(sheet.x + font.widthOfTextAtSize('SHEET', 6) / 2).toBeCloseTo(position.x + block.cellWidth / 2)
      expect(sheet.y).toBe(scale.y)
      expect(position.y).toBe(value.y)
      expect((scale.y + font.heightAtSize(6, { descender: false }) + value.y) / 2).toBeCloseTo(36 + block.height / 2)
    }
    expect(borders[0]).toEqual(borders[1])
  })
  it('bounds long project names without changing the physical height or hiding context values', async () => {
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
    const page = pdf.addPage()
    const block = technicalTitleBlockLayout(page.getWidth() - 56)
    const text = vi.spyOn(page, 'drawText')
    drawTechnicalTitleBlock(page, font, bold, block, { projectName: 'Long project name '.repeat(100), context: cuttingSettingsContext({ kerfMm: 0, edgeMarginMm: 10 }), scale: '1:5' })
    expect(block.height).toBe(52)
    expect(text.mock.calls.some(([value]) => value.endsWith('...'))).toBe(true)
    expect(text.mock.calls.map(([value]) => value)).toContain('Kerf: 0 mm')
    expect(text.mock.calls.map(([value]) => value)).toContain('Edge margin: 10 mm')
  })
})
