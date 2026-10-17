import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import { layoutPartTitleBlock, drawPartTitleBlock } from '../part-title-block'
import { pdfPageSize } from '../pdf-layout'

describe('Shared individual-drawing page title block', () => {
  it.each(['A4', 'A3'] as const)('fits the document type, project name, units and SCALE/SHEET block on %s in either orientation', async paper => {
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
    for (const orientation of ['portrait', 'landscape'] as const) {
      const size = pdfPageSize(paper, orientation)
      const page = pdf.addPage([size.width, size.height])
      const text = vi.spyOn(page, 'drawText')
      const block = layoutPartTitleBlock(size.width - 56)
      const numbering = drawPartTitleBlock(page, font, bold, block, 'Workshop project')
      expect(text.mock.calls.map(([value]) => value)).toEqual(['PROJECT', 'Workshop project', 'UNITS', 'Millimeters (mm)', 'SCALE', 'SHEET', 'N/A'])
      expect(numbering.x + numbering.width).toBeCloseTo(size.width - 28)
      for (const [label, options] of text.mock.calls) {
        if (!options?.font || options.x === undefined || options.y === undefined) throw new Error('Missing text bounds')
        expect([6, 7, 8]).toContain(options.size)
        expect(options.x).toBeGreaterThanOrEqual(34)
        expect(options.x + options.font.widthOfTextAtSize(label, options.size ?? 8)).toBeLessThanOrEqual(size.width - 34)
        expect(options.y).toBeGreaterThan(36)
        expect(options.y).toBeLessThan(block.top)
      }
    }
  })
  it('uses bold drawing type, secondary project and units with N/A scale in the unchanged footer', async () => {
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
    const page = pdf.addPage()
    const text = vi.spyOn(page, 'drawText')
    const block = layoutPartTitleBlock(page.getWidth() - 56)
    expect(block.height).toBe(52)
    drawPartTitleBlock(page, font, bold, block, 'Workshop project')
    expect(text.mock.calls.map(([value]) => value)).toEqual(['PROJECT', 'Workshop project', 'UNITS', 'Millimeters (mm)', 'SCALE', 'SHEET', 'N/A'])
    expect(text.mock.calls[1]?.[1]?.font).toBe(bold)
    expect(text.mock.calls[3]?.[1]?.font).toBe(font)

  })
})
