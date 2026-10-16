// @vitest-environment node
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import { drawCoverPage } from '../cover-page'
import { prepareCoverImage } from '../cover-image'
import { pdfPageSize } from '../pdf-layout'
import { prepareProjectPdfDocument } from '../../../application/export/cutting-plan-pdf-service'
import { projectPdfRequest } from '../../../application/export/__tests__/pdf-fixtures'
import { coverImageSchema, MAX_COVER_IMAGE_BYTES } from '../../../domain/model/pdf-settings'
import { jpegCover, pngCover } from './cover-image-fixtures'

describe('PDF cover', () => {
  it.each([pngCover, jpegCover])('validates actual $mimeType contents and rejects mismatches', async fixture => {
    const bytes = Buffer.from(fixture.data, 'base64')
    expect(await prepareCoverImage(new Blob([bytes], { type: fixture.mimeType }))).toEqual(fixture)
    await expect(prepareCoverImage(new Blob([bytes], { type: fixture.mimeType === 'image/png' ? 'image/jpeg' : 'image/png' }))).rejects.toThrow('valid PNG or JPEG')
    expect(coverImageSchema.safeParse({ ...fixture, data: 'invalid' }).success).toBe(false)
  })
  it('rejects unsupported, empty, oversized and corrupt files', async () => {
    await expect(prepareCoverImage(new Blob(['image'], { type: 'image/gif' }))).rejects.toThrow('PNG or JPEG')
    await expect(prepareCoverImage(new Blob([], { type: 'image/png' }))).rejects.toThrow('2 MB')
    await expect(prepareCoverImage(new Blob([new Uint8Array(MAX_COVER_IMAGE_BYTES + 1)], { type: 'image/png' }))).rejects.toThrow('2 MB')
    await expect(prepareCoverImage(new Blob(['not an image'], { type: 'image/png' }))).rejects.toThrow('valid PNG or JPEG')
  })
  it('rejects exceptionally tall cover text rather than clipping or dropping lines', async () => {
    const prepared = prepareProjectPdfDocument({ ...projectPdfRequest(), orientation: 'landscape', cover: { description: Array.from({ length: 100 }, () => 'Line').join('\n'), image: pngCover } })
    if (!prepared.ok) throw new Error(prepared.error.message)
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.HelveticaOblique)
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
    const size = pdfPageSize('A4', 'landscape')
    await expect(drawCoverPage(pdf, pdf.addPage([size.width, size.height]), font, bold, prepared.document)).rejects.toThrow('Shorten the description or choose A3')
  })
  for (const pageSize of ['A4', 'A3'] as const) for (const orientation of ['portrait', 'landscape'] as const) {
    it.each([{}, { description: 'First paragraph\nSecond paragraph' }, { image: pngCover }, { description: 'Technical project notes. '.repeat(60), image: jpegCover }])('fits optional content on ' + pageSize + ' ' + orientation, async cover => {
      const prepared = prepareProjectPdfDocument({ ...projectPdfRequest(), pageSize, orientation, cover: { title: 'Fabrication drawings', ...cover } })
      if (!prepared.ok) throw new Error(prepared.error.message)
      const pdf = await PDFDocument.create()
      const font = await pdf.embedFont(StandardFonts.HelveticaOblique)
      const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
      const size = pdfPageSize(pageSize, orientation)
      const page = pdf.addPage([size.width, size.height])
      const text = vi.spyOn(page, 'drawText')
      const image = vi.spyOn(page, 'drawImage')
      await drawCoverPage(pdf, page, font, bold, prepared.document)
      expect(text.mock.calls.map(call => call[0])).toContain('Fabrication drawings')
      expect(text.mock.calls.map(call => call[0])).not.toContain('OptiCutList / Cutting plans')
      const titleRows = text.mock.calls.filter(call => call[1]?.font === bold)
      const descriptionRows = text.mock.calls.filter(call => call[1]?.font === font)
      if ('description' in cover) {
        expect(descriptionRows.length).toBeGreaterThan(0)
        for (const [, options] of descriptionRows) {
          expect(options?.font?.name).toBe('Helvetica-Oblique')
          expect(options?.color).toMatchObject({ red: 0.4, green: 0.4, blue: 0.4 })
        }
        const lastTitle = titleRows.at(-1)?.[1]
        const firstDescription = descriptionRows[0]?.[1]
        expect((lastTitle?.y ?? 0) - (firstDescription?.y ?? 0) - (firstDescription?.size ?? 0)).toBeGreaterThanOrEqual(28)
      } else expect(descriptionRows).toHaveLength(0)

      expect(text.mock.calls.map(call => call[0])).not.toContain('Workshop project')
      for (const [value, options] of text.mock.calls) {
        if (!options?.font || options.x === undefined || options.y === undefined || options.size === undefined) throw new Error('Unmeasured cover text')
        expect(options.x).toBeGreaterThanOrEqual(36)
        expect(options.x + options.font.widthOfTextAtSize(value, options.size)).toBeLessThanOrEqual(size.width - 36)
        expect(options.y).toBeGreaterThanOrEqual(36)
        expect(options.y + options.size).toBeLessThanOrEqual(size.height - 36)
      }
      if ('image' in cover) {
        const options = image.mock.calls[0]?.[1]
        if (!options?.width || !options.height || options.x === undefined || options.y === undefined) throw new Error('Missing image bounds')
        expect(options.width / options.height).toBeCloseTo(2)
        expect((text.mock.calls.at(-1)?.[1]?.y ?? 0) - (options.y + options.height)).toBeGreaterThanOrEqual(32)
        expect(options.x).toBeGreaterThanOrEqual(36)
        expect(options.y).toBeGreaterThanOrEqual(36)
        expect(options.y + options.height).toBeLessThanOrEqual(size.height - 36)
        expect(options.x + options.width).toBeLessThanOrEqual(size.width - 36)
      } else expect(image).not.toHaveBeenCalled()
      if ('description' in cover && cover.description.includes('\n')) {
        expect(text.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining(['First paragraph', 'Second paragraph']))
      }
    })
  }
})
