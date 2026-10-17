import { rgb, type PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib'
import type { ProjectCuttingPdfDocument } from '../../application/export/cutting-plan-pdf-service'
import { wrapPdfText } from './pdf-text'

/** Measured vector text and contained image; title overrides affect only this cover. */
export async function drawCoverPage(pdf: PDFDocument, page: PDFPage, descriptionFont: PDFFont, bold: PDFFont, document: ProjectCuttingPdfDocument): Promise<void> {
  const margin = 36
  const width = Math.min(page.getWidth() - margin * 2, 680)
  const availableHeight = page.getHeight() - margin * 2
  const title = document.cover?.title?.trim() || document.title
  const description = document.cover?.description?.trim() ?? ''
  let titleSize = 28
  let bodySize = 11
  const image = document.cover?.image
    ? document.cover.image.mimeType === 'image/png'
      ? await pdf.embedPng(document.cover.image.data)
      : await pdf.embedJpg(document.cover.image.data)
    : null
  const descriptionGap = 28
  const imageGap = 32
  const measure = () => {
    const titles = wrapPdfText(title, bold, titleSize, width)
    const paragraphs = description ? wrapPdfText(description, descriptionFont, bodySize, width) : []
    const titleHeight = titles.length * titleSize * 1.22
    const bodyHeight = paragraphs.length ? descriptionGap + paragraphs.length * bodySize * 1.4 : 0
    return { titles, paragraphs, textHeight: titleHeight + bodyHeight, titleHeight }
  }
  let layout = measure()
  const minimumImageSpace = image ? imageGap + 90 : 0
  while (layout.textHeight + minimumImageSpace > availableHeight && (titleSize > 18 || bodySize > 9)) {
    if (titleSize > 18) titleSize -= 1
    if (bodySize > 9) bodySize -= 0.5
    layout = measure()
  }
  if (layout.textHeight + minimumImageSpace > availableHeight) throw new Error('Cover text is too long for this paper size. Shorten the description or choose A3.')
  const imageSize = image?.scaleToFit(width, Math.min(page.getHeight() * 0.38, availableHeight - layout.textHeight - imageGap))
  const height = layout.textHeight + (imageSize ? imageGap + imageSize.height : 0)
  let y = (page.getHeight() + height) / 2
  const drawCentered = (text: string, selectedFont: PDFFont, size: number, color = rgb(0.15, 0.19, 0.17)) => {
    page.drawText(text, { x: (page.getWidth() - selectedFont.widthOfTextAtSize(text, size)) / 2, y: y - size, font: selectedFont, size, color })
  }
  for (const text of layout.titles) {
    drawCentered(text, bold, titleSize);
    y -= titleSize * 1.22
  }
  if (layout.paragraphs.length) {
    y -= descriptionGap
    for (const text of layout.paragraphs) {
      drawCentered(text, descriptionFont, bodySize, rgb(0.4, 0.4, 0.4));
      y -= bodySize * 1.4
    }
  }
  if (image && imageSize) {
    y -= imageGap
    page.drawImage(image, { x: (page.getWidth() - imageSize.width) / 2, y: y - imageSize.height, ...imageSize })
  }
}
