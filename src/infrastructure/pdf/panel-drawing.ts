import { rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { CuttingPlanPdfDocument } from '../../application/export/cutting-plan-pdf-service'
import type { ScenePart } from '../../application/optimization/cutting-plan-scene'
import type { GrainDirection } from '../../domain/model/orientation'
import { pdfPageSize, pdfRect, type PdfBox } from './pdf-layout'
import { DIMENSION_CLEARANCE, drawDimensions, drawGrain, drawWaste, scaleLabel, technicalTransform } from './technical-drawing'

const ink = rgb(0.14, 0.14, 0.14)
const muted = rgb(0.4, 0.4, 0.4)
const margin = 36
function bounded(text: string, font: PDFFont, size: number, width: number): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text
  let result = text
  while (result.length && font.widthOfTextAtSize(`${result}...`, size) > width) result = result.slice(0, -1)
  return `${result}...`
}
function identifier(document: CuttingPlanPdfDocument, part: ScenePart): string {
  return `P${String(document.parts.findIndex(record => record.id === part.part.id) + 1)}${part.part.quantity > 1 ? `.${String(part.copyIndex + 1)}` : ''}`
}
function orientedSize(part: ScenePart): string { return `${String(part.dimensions.lengthMm)} x ${String(part.dimensions.widthMm)} mm${part.orientation === 'rotated' ? ' / 90°' : ''}` }
function fitsLabel(document: CuttingPlanPdfDocument, part: ScenePart, font: PDFFont, transform: ReturnType<typeof technicalTransform>): boolean {
  const box = pdfRect(part.region, transform)
  const size = box.height >= 52 ? 8 : 7
  return box.height >= 28 && box.width >= Math.max(font.widthOfTextAtSize(identifier(document, part), size), font.widthOfTextAtSize(orientedSize(part), size), 32) + 12
}
/** A short corner marker for low-height labels, entirely inside the physical part outline. */
function compactGrain(page: PDFPage, box: PdfBox, direction: GrainDirection): void {
  if (direction === 'none') return
  const end = direction === 'length' ? { x: box.x + box.width - 4, y: box.y + box.height - 4 } : { x: box.x + box.width - 4, y: box.y + box.height - 16 }
  const start = direction === 'length' ? { x: end.x - 12, y: end.y } : { x: end.x, y: end.y + 12 }
  page.drawLine({ start, end, thickness: 0.35, color: ink })
  for (const side of [-1, 1]) page.drawLine({ start: end, end: direction === 'length' ? { x: end.x - 2, y: end.y + side * 1.5 } : { x: end.x + side * 1.5, y: end.y + 2 }, thickness: 0.35, color: ink })
}
/** Read-only sheet projection. External annotations occupy a separate band, with no leaders crossing placements. */
export function layoutPanelDrawing(document: CuttingPlanPdfDocument, font: PDFFont) {
  const size = pdfPageSize(document.pageSize ?? 'A4', document.orientation)
  const contentWidth = size.width - margin * 2
  let externalCount = 0
  for (let iteration = 0; iteration <= document.scene.parts.length; iteration += 1) {
    const columns = externalCount > 12 ? Math.floor(contentWidth / 145) : size.width > size.height ? 3 : 2
    const labelWidth = contentWidth / columns
    const labelHeight = externalCount ? 16 + Math.ceil(externalCount / columns) * 30 : 0
    const available = { x: margin + 30, y: 130 + labelHeight + DIMENSION_CLEARANCE, width: contentWidth - 60, height: size.height - 318 - labelHeight }
    if (available.height < 60) throw new Error('Too many tiny-part annotations for one panel sheet. Choose a larger paper size or orientation.')
    const transform = technicalTransform(document.scene.panel, available)
    const external = document.scene.parts.filter(part => !fitsLabel(document, part, font, transform))
    if (external.length > externalCount) { externalCount = external.length; continue }
    return { size, transform, panelBox: pdfRect(document.scene.panel, transform), external, labelWidth, columns, labelHeight, available }
  }
  throw new Error('Could not fit panel annotations on one sheet.')
}
export function drawPanelSheet(page: PDFPage, font: PDFFont, bold: PDFFont, document: CuttingPlanPdfDocument, heading: string) {
  const layout = layoutPanelDrawing(document, font)
  const { size, transform, panelBox, external, labelWidth, columns } = layout
  const leftWidth = size.width - margin * 2 - 190
  page.drawText(bounded(heading, bold, 13, leftWidth), { x: margin, y: size.height - 42, size: 13, font: bold, color: ink })
  page.drawText(bounded(document.panel.name, font, 9, leftWidth), { x: margin, y: size.height - 58, size: 9, font, color: ink })
  page.drawText(`${String(document.panel.lengthMm)} x ${String(document.panel.widthMm)} x ${String(document.panel.thicknessMm)} mm`, { x: margin, y: size.height - 72, size: 9, font, color: muted })
  const elsewhere = document.unplaced.filter(range => range.reason.kind === 'allocatedElsewhere').reduce((sum, range) => sum + range.count, 0)
  const unplaced = document.unplaced.reduce((sum, range) => sum + range.count, 0) - elsewhere
  if (unplaced) page.drawText(`${String(unplaced)} copies unplaced`, { x: margin, y: size.height - 86, size: 8, font, color: muted })
  const parameters = { x: size.width - margin - 170, y: size.height - 100, width: 170, height: 62 }
  page.drawRectangle({ ...parameters, borderColor: muted, borderWidth: 0.4 })
  page.drawText('Cutting parameters', { x: parameters.x + 8, y: parameters.y + 47, font: bold, size: 8, color: ink })
  page.drawText(`Kerf: ${String(document.settings.kerfMm)} mm`, { x: parameters.x + 8, y: parameters.y + 31, font, size: 8, color: ink })
  page.drawText(`Edge margin: ${String(document.settings.edgeMarginMm)} mm`, { x: parameters.x + 8, y: parameters.y + 17, font, size: 8, color: ink })
  page.drawText(`Grain: ${document.panel.grainDirection}`, { x: parameters.x + 8, y: parameters.y + 5, font, size: 8, color: muted })
  for (const waste of document.scene.waste) drawWaste(page, pdfRect(waste, transform))
  const externalKeys = new Set(external.map(part => part.key))
  for (const part of document.scene.parts) {
    const box = pdfRect(part.region, transform)
    page.drawRectangle({ ...box, borderWidth: 0.5, borderColor: ink })
    if (!externalKeys.has(part.key)) {
      const compact = box.height < 52
      const textSize = compact ? 7 : 8
      const labels = compact ? [bounded(`${identifier(document, part)} / ${part.part.name}`, bold, textSize, box.width - 12), orientedSize(part)]
        : [identifier(document, part), bounded(part.part.name, bold, textSize, box.width - 12), orientedSize(part)]
      labels.forEach((text, index) => {
        const selectedFont = index === (compact ? 0 : 1) ? bold : font
        page.drawText(text, { x: box.x + box.width / 2 - selectedFont.widthOfTextAtSize(text, textSize) / 2, y: box.y + box.height / 2 + (compact ? 3 : 10) - index * (compact ? 10 : 12), size: textSize, font: selectedFont, color: ink })
      })
    }
    if (box.height >= 52 || externalKeys.has(part.key)) drawGrain(page, box, part.grain)
    else compactGrain(page, box, part.grain)
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
  if (external.length) {
    page.drawText('Small parts / positions from top-left origin (mm)', { x: margin, y: 130 + layout.labelHeight - 10, font, size: 8, color: muted })
    external.forEach((part, index) => {
      const x = margin + index % columns * labelWidth
      const y = 130 + layout.labelHeight - 26 - Math.floor(index / columns) * 30
      const labels = [bounded(`${identifier(document, part)} / ${part.part.name}`, bold, 8, labelWidth - 12), orientedSize(part), `Position: ${String(part.region.xMm)}, ${String(part.region.yMm)}${part.grain === 'none' ? '' : ` / Grain: ${part.grain}`}`]
      labels.forEach((text, lineIndex) => {
        const selectedFont = lineIndex === 0 ? bold : font
        if (selectedFont.widthOfTextAtSize(text, 8) > labelWidth - 12) throw new Error('A small-part annotation does not fit. Choose a larger paper size or orientation.')
        page.drawText(text, { x, y: y - lineIndex * 10, font: selectedFont, size: 8, color: ink })
      })
    })
  }
  page.drawText('Hatch: waste / Dashed: usable area / Dark band: kerf', { x: margin, y: 116, font, size: 7, color: muted })
  return { ...layout, scale: scaleLabel(transform) }
}
