import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import { partSchema } from '../../../domain/model/part'
import { validPartInput } from '../../../domain/model/__tests__/fixtures'
import { layoutPartTitleBlock, drawPartTitleBlock } from '../part-title-block'
import { partDrawingCells, partDrawingGeometry } from '../part-drawing-grid'
import { pdfPageSize } from '../pdf-layout'
import { technicalInk, technicalRule } from '../technical-sheet'

describe('Measured individual drawing title block', () => {
  it.each(['A4', 'A3'] as const)('reserves readable metadata below dimensions on %s in either orientation', async paper => {
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
    for (const orientation of ['portrait', 'landscape'] as const) {
      const size = pdfPageSize(paper, orientation)
      const page = pdf.addPage([size.width, size.height])
      const text = vi.spyOn(page, 'drawText')
      const lines = vi.spyOn(page, 'drawLine')
      const part = partSchema.parse({ ...validPartInput, name: 'A long descriptive fabrication component '.repeat(5).slice(0, 200).trim(), quantity: 4, grainDirection: 'length' })
      const cell = partDrawingCells(size, 170, 2)[0]
      if (!cell) throw new Error('Missing drawing cell')
      const block = layoutPartTitleBlock(part, 'P1', 'MDF', cell.width, font, bold)
      const short = layoutPartTitleBlock({ ...part, name: 'A' }, 'P1', 'MDF', cell.width, font, bold)
      expect(block.height).toBeGreaterThan(short.height)
      expect(block.name.join(' ')).toBe('P1 — ' + part.name)
      expect(block.metadata).toEqual(['MDF', `${String(part.lengthMm)} × ${String(part.widthMm)} × ${String(part.thicknessMm)} mm`, 'Quantity: 4', 'Grain: length'])
      const geometry = partDrawingGeometry({ xMm: 0, yMm: 0, lengthMm: part.lengthMm, widthMm: part.widthMm }, cell, 10, block.height)
      expect(geometry.box.y - 33).toBeGreaterThan(cell.y + block.height)
      const numbering = drawPartTitleBlock(page, font, bold, cell, block, '1:5')
      const labels = text.mock.calls.map(([value]) => value)
      expect(labels).toEqual([...block.name, ...block.metadata, 'SCALE', 'SHEET', '1:5'])
      for (const [value, options] of text.mock.calls) {
        if (!options?.font || options.x === undefined || options.y === undefined) throw new Error('Missing text bounds')
        expect(options.size).toBe(8)
        expect(options.color).toEqual(technicalInk)
        expect(options.x).toBeGreaterThanOrEqual(cell.x + 6)
        expect(options.x + options.font.widthOfTextAtSize(value, 8)).toBeLessThanOrEqual(cell.x + cell.width - 6)
        expect(options.y).toBeGreaterThan(cell.y)
        expect(options.y).toBeLessThan(cell.y + block.height)
      }
      expect(lines.mock.calls.every(([line]) => line.thickness === 0.3 && JSON.stringify(line.color) === JSON.stringify(technicalRule))).toBe(true)
      expect(numbering.x + numbering.width).toBe(cell.x + cell.width)
      expect(numbering.y).toBeGreaterThan(cell.y)
    }
  })
})
