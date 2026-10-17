import { rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { CuttingPlanPdfDocument } from '../../application/export/cutting-plan-pdf-service'
import type { ScenePart } from '../../application/optimization/cutting-plan-scene'
import type { GrainDirection } from '../../domain/model/orientation'
import { boundedPdfText as bounded } from './pdf-text'
import { pdfPageSize, pdfRect, type PdfBox } from './pdf-layout'
import { drawPanelTitleBlock, layoutPanelTitleBlock, panelPartReference } from './panel-title-block'
import { DIMENSION_CLEARANCE, drawDimensions, drawGrain, drawWaste, scaleLabel, technicalTransform } from './technical-drawing'

const ink = rgb(0.14, 0.14, 0.14)
const muted = rgb(0.4, 0.4, 0.4)
const margin = 36
function orientedSize(part: ScenePart): string { return `${String(part.dimensions.lengthMm)} × ${String(part.dimensions.widthMm)} mm${part.orientation === 'rotated' ? ' / 90°' : ''}` }
function fitsLabel(document: CuttingPlanPdfDocument, part: ScenePart, font: PDFFont, bold: PDFFont, transform: ReturnType<typeof technicalTransform>): boolean {
  const box = pdfRect(part.region, transform)
  const size = box.height >= 52 ? 8 : 7
  return box.height >= 28 && box.width >= Math.max((box.height >= 52 ? font : bold).widthOfTextAtSize(`${panelPartReference(document, part)}${box.height >= 52 ? '' : ' /...'}`, size), font.widthOfTextAtSize(orientedSize(part), size), 32) + 12
}
/** A short corner marker for low-height labels, entirely inside the physical part outline. */
function compactGrain(page: PDFPage, box: PdfBox, direction: GrainDirection): void {
  if (direction === 'none') return
  const end = direction === 'length' ? { x: box.x + box.width - 4, y: box.y + box.height - 4 } : { x: box.x + box.width - 4, y: box.y + box.height - 16 }
  const start = direction === 'length' ? { x: end.x - 12, y: end.y } : { x: end.x, y: end.y + 12 }
  page.drawLine({ start, end, thickness: 0.35, color: ink })
  for (const side of [-1, 1]) page.drawLine({ start: end, end: direction === 'length' ? { x: end.x - 2, y: end.y + side * 1.5 } : { x: end.x + side * 1.5, y: end.y + 2 }, thickness: 0.35, color: ink })
}
/** Reserve the measured bottom block and physical dimension/grain clearance only. */
export function layoutPanelDrawing(document: CuttingPlanPdfDocument, font: PDFFont, bold: PDFFont, reference = 'Panel 1') {
  const size = pdfPageSize(document.pageSize ?? 'A4', document.orientation)
  const titleBlock = layoutPanelTitleBlock(document, font, bold, reference)
  const bottom = titleBlock.top + 12 + DIMENSION_CLEARANCE
  const grainClearance = document.panel.grainDirection === 'none' ? 0 : 43
  const top = size.height - 28 - grainClearance
  const available = { x: margin + 30, y: bottom, width: size.width - margin * 2 - 60, height: top - bottom }
  const transform = technicalTransform(document.scene.panel, available)
  return { size, transform, panelBox: pdfRect(document.scene.panel, transform), available, titleBlock }
}
export function drawPanelSheet(page: PDFPage, font: PDFFont, bold: PDFFont, document: CuttingPlanPdfDocument, heading: string) {
  const layout = layoutPanelDrawing(document, font, bold, heading)
  const { transform, panelBox } = layout
  for (const waste of document.scene.waste) drawWaste(page, pdfRect(waste, transform))
  for (const part of document.scene.parts) {
    const box = pdfRect(part.region, transform)
    page.drawRectangle({ ...box, borderWidth: 0.5, borderColor: ink })
    const fullLabel = fitsLabel(document, part, font, bold, transform)
    if (fullLabel) {
      const compact = box.height < 52
      const textSize = compact ? 7 : 8
      const labels = compact ? [bounded(`${panelPartReference(document, part)} / ${part.part.name}`, bold, textSize, box.width - 12), orientedSize(part)]
        : [panelPartReference(document, part), bounded(part.part.name, bold, textSize, box.width - 12), orientedSize(part)]
      labels.forEach((text, index) => {
        const selectedFont = index === (compact ? 0 : 1) ? bold : font
        page.drawText(text, { x: box.x + box.width / 2 - selectedFont.widthOfTextAtSize(text, textSize) / 2, y: box.y + box.height / 2 + (compact ? 3 : 10) - index * (compact ? 10 : 12), size: textSize, font: selectedFont, color: ink })
      })
    }
    else {
      // A tiny reference remains a vector glyph inside its exact region; full details stay in the tables.
      const text = panelPartReference(document, part)
      const padding = Math.min(3, box.width / 8, box.height / 8)
      const textSize = Math.min(6, (box.width - padding * 2) / bold.widthOfTextAtSize(text, 1), box.height - padding * 2)
      const glyphHeight = bold.heightAtSize(textSize, { descender: false })
      page.drawText(text, { x: box.x + box.width / 2 - bold.widthOfTextAtSize(text, textSize) / 2, y: box.y + box.height / 2 - glyphHeight / 2, size: textSize, font: bold, color: ink })
    }
    if (fullLabel || box.width >= 24 && box.height >= 52) compactGrain(page, box, part.grain)
  }
  for (const kerf of document.scene.kerfs) {
    const box = pdfRect(kerf, transform)
    if (box.width === 0 || box.height === 0) page.drawLine({ start: { x: box.x, y: box.y }, end: { x: box.x + box.width, y: box.y + box.height }, thickness: 0.4, color: muted })
    else page.drawRectangle({ ...box, color: rgb(0.38, 0.38, 0.38) })
  }
  page.drawRectangle({ ...pdfRect(document.scene.usableArea, transform), borderColor: muted, borderWidth: 0.4, borderDashArray: [3, 3] })
  page.drawRectangle({ ...panelBox, borderColor: ink, borderWidth: 0.6 })
  drawDimensions(page, font, panelBox, document.panel.lengthMm, document.panel.widthMm)
  if (document.panel.grainDirection !== 'none') drawGrain(page, { x: panelBox.x, y: panelBox.y + panelBox.height + 8, width: 40, height: 35 }, document.panel.grainDirection)
  const sheetPosition = drawPanelTitleBlock(page, font, bold, layout.titleBlock, scaleLabel(transform))
  return { ...layout, sheetPosition, scale: scaleLabel(transform) }
}
