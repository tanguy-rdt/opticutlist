import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { CuttingPlanPdfDocument } from '../../application/export/cutting-plan-pdf-service'
import { a4PageSize, fitPdfPanel, pdfRect } from './pdf-layout'

const ink = rgb(0.12, 0.15, 0.17)
const muted = rgb(0.35, 0.38, 0.4)
const margin = 36
const lineHeight = 14

/** Wrap even long IDs, measure with the embedded font, and never silently drop unsupported glyphs. */
export function wrapPdfText(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split(/\r?\n/u)) {
    let line = ''
    for (const word of paragraph.split(/\s+/u).filter(Boolean)) {
      if (line && font.widthOfTextAtSize(`${line} ${word}`, size) <= width) { line += ` ${word}`; continue }
      if (line) { lines.push(line); line = '' }
      for (const character of word) {
        if (font.widthOfTextAtSize(character, size) > width) throw new Error('The PDF text area is too narrow.')
        if (line && font.widthOfTextAtSize(line + character, size) > width) { lines.push(line); line = '' }
        line += character
      }
    }
    lines.push(line)
  }
  return lines
}
function drawLines(page: PDFPage, lines: readonly string[], font: PDFFont, x: number, y: number, size = 10): number {
  for (const text of lines) { page.drawText(text, { x, y, size, font, color: ink }); y -= lineHeight }
  return y
}
function dimensions(item: { lengthMm: number; widthMm: number; thicknessMm: number }): string {
  return `${String(item.lengthMm)} x ${String(item.widthMm)} x ${String(item.thicknessMm)} mm`
}

/** True PDF paths and text from the shared validated scene; no canvas/image dependency. */
async function renderCuttingPlanPdf(document: CuttingPlanPdfDocument): Promise<Uint8Array<ArrayBuffer>> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const size = a4PageSize(document.orientation)
  const page = pdf.addPage([size.width, size.height])
  const contentWidth = size.width - 2 * margin
  let y = size.height - margin
  page.drawText('OptiCutList / Cutting plan', { x: margin, y, size: 19, font: bold, color: ink }); y -= 24
  y = drawLines(page, wrapPdfText(`${document.edited ? 'Manually edited' : 'Optimized'} single-panel plan - independently validated`, font, 10, contentWidth), font, margin, y)
  y = drawLines(page, wrapPdfText(`Panel: ${document.panel.name} / ${dimensions(document.panel)}`, font, 10, contentWidth), font, margin, y)
  y = drawLines(page, wrapPdfText(`Material: ${document.materialName} / ID: ${document.panel.materialId}`, font, 10, contentWidth), font, margin, y)
  y = drawLines(page, wrapPdfText(`Panel grain: ${document.panel.grainDirection} / Kerf: ${String(document.settings.kerfMm)} mm / Edge margin: ${String(document.settings.edgeMarginMm)} mm`, font, 10, contentWidth), font, margin, y)
  const unplacedCount = document.unplaced.reduce((total, part) => total + part.count, 0)
  y -= 6
  y = drawLines(page, wrapPdfText(`${String(document.scene.parts.length)} copies placed / ${String(unplacedCount)} copies unplaced / Utilization: ${document.metrics.utilizationPercent.toFixed(2)}%`, bold, 11, contentWidth), bold, margin, y, 11)
  y = drawLines(page, wrapPdfText(`Waste: ${document.metrics.wasteAreaMm2.toLocaleString('en-US')} mm² (includes margins and kerf)`, font, 10, contentWidth), font, margin, y)
  const transform = fitPdfPanel(document.scene.panel, { x: margin, y: 92, width: contentWidth, height: y - 110 })
  page.drawRectangle({ ...pdfRect(document.scene.panel, transform), color: rgb(0.9, 0.9, 0.9) })
  page.drawRectangle({ ...pdfRect(document.scene.usableArea, transform), color: rgb(1, 1, 1) })
  for (const waste of document.scene.waste) page.drawRectangle({ ...pdfRect(waste, transform), color: rgb(0.96, 0.96, 0.96) })
  for (const part of document.scene.parts) {
    const box = pdfRect(part.region, transform)
    page.drawRectangle({ ...box, borderWidth: 0.5, borderColor: ink })
    const labels = [`${part.part.name} / ${String(part.copyIndex + 1)}`, dimensions(part.dimensions), `${part.orientation === 'rotated' ? 'Rotated 90°' : 'Normal'} / Grain: ${part.grain}`]
    const hasGrainArrow = part.grain !== 'none' && box.width >= 38 && box.height >= 65
    let labelY = box.y + box.height - 13
    for (const label of labels) {
      if (labelY < box.y + (hasGrainArrow ? 40 : 5) || font.widthOfTextAtSize(label, 8) > box.width - 8) break
      page.drawText(label, { x: box.x + 4, y: labelY, size: 8, font, color: ink })
      labelY -= 11
    }
    if (hasGrainArrow) {
      const x = box.x + box.width - 12
      const arrowY = box.y + 16
      const horizontal = part.grain === 'length'
      const start = { x: horizontal ? x - 20 : x, y: arrowY }
      const end = { x, y: horizontal ? arrowY : arrowY + 20 }
      page.drawLine({ start, end, thickness: 0.6, color: muted })
      page.drawLine({ start: end, end: { x: end.x - 3, y: end.y - 3 }, thickness: 0.6, color: muted })
      page.drawLine({ start: end, end: { x: horizontal ? end.x - 3 : end.x + 3, y: horizontal ? end.y + 3 : end.y - 3 }, thickness: 0.6, color: muted })
    }
  }
  for (const kerf of document.scene.kerfs) {
    const box = pdfRect(kerf, transform)
    if (box.width === 0 || box.height === 0) page.drawLine({ start: { x: box.x, y: box.y }, end: { x: box.x + box.width, y: box.y + box.height }, thickness: 0.4, color: muted })
    else page.drawRectangle({ ...box, color: rgb(0.55, 0.55, 0.55) })
  }
  page.drawRectangle({ ...pdfRect(document.scene.usableArea, transform), borderColor: muted, borderWidth: 0.6, borderDashArray: [3, 3] })
  page.drawRectangle({ ...pdfRect(document.scene.panel, transform), borderColor: ink, borderWidth: 1 })
  drawLines(page, [
    'Solid outline: panel / Dashed outline: usable area / Outer gray band: margins',
    'Light gray: waste / Dark gray: saw kerf (zero kerf shown as a line) / Arrows: grain',
    `Drawing scale: 1:${(1 / transform.scale).toPrecision(4)} / Dimensions in mm. Use listed dimensions, not a print measurement.`,
  ], font, margin, 70, 9)

  // Full names, IDs and all unplaced demand remain readable even when diagram labels cannot fit.
  let details = pdf.addPage([size.width, size.height])
  let rowY = size.height - margin
  function newDetailsPage(): void {
    details = pdf.addPage([size.width, size.height]); rowY = size.height - margin
    details.drawText('Cutting plan / Details continued', { x: margin, y: rowY, size: 14, font: bold, color: ink }); rowY -= 24
  }
  function row(text: string, heading = false): void {
    const selectedFont = heading ? bold : font
    const lines = wrapPdfText(text, selectedFont, 10, contentWidth)
    if (rowY - lines.length * lineHeight < 50) newDetailsPage()
    rowY = drawLines(details, lines, selectedFont, margin, rowY) - 6
  }
  row('Placed parts - oriented dimensions, thickness and grain', true)
  if (document.scene.parts.length === 0) row('No parts were placed on this panel.')
  for (const part of document.scene.parts) row(`${part.part.name} / Copy ${String(part.copyIndex + 1)} / ID: ${part.part.id}\n${dimensions(part.dimensions)} / ${part.orientation === 'rotated' ? 'Rotated 90°' : 'Normal'} / Grain in panel axes: ${part.grain}\nOriginal grain: ${part.part.grainDirection} / Rotation: ${part.part.rotation} / Position: ${String(part.region.xMm)}, ${String(part.region.yMm)} mm`)
  row('Unplaced parts - not produced by this panel', true)
  if (document.unplaced.length === 0) row('None. All requested copies are placed on this panel.')
  for (const missing of document.unplaced) {
    const part = document.parts.find(part => part.id === missing.partId)
    const reason = missing.reason.kind === 'noSpaceLeft' ? 'No space left on this panel'
      : missing.reason.kind === 'remainderNarrowerThanKerf' ? 'Remainder cannot be cut with this kerf'
        : missing.reason.issues.map(issue => ({ materialMismatch: 'Material mismatch', thicknessMismatch: 'Exact thickness mismatch', noUsableArea: 'No usable area', grainRequiresRotation: 'Grain requires forbidden rotation', exceedsUsableArea: 'Exceeds usable panel size' })[issue.kind]).join('; ')
    row(`${part?.name ?? missing.partId} / ID: ${missing.partId}\n${String(missing.count)} unplaced copies, starting at copy ${String(missing.firstCopyIndex + 1)}${part === undefined ? '' : ` / ${dimensions(part)}`}\nReason: ${reason}`)
  }
  row('Single-panel plan only. Export does not purchase or consume inventory. Print at actual size to retain the stated drawing scale.')
  for (const [index, current] of pdf.getPages().entries()) current.drawText(`OptiCutList / ${String(index + 1)} of ${String(pdf.getPageCount())}`, { x: margin, y: 24, size: 9, font, color: muted })
  pdf.setTitle('OptiCutList cutting plan')
  pdf.setProducer('OptiCutList / pdf-lib')
  return new Uint8Array(await pdf.save())
}

export async function generateCuttingPlanPdf(document: CuttingPlanPdfDocument): Promise<Uint8Array<ArrayBuffer>> {
  try { return await renderCuttingPlanPdf(document) }
  catch (cause) {
    if (cause instanceof Error && cause.message.includes('WinAnsi cannot encode')) throw new Error('A name contains characters unsupported by the built-in PDF font. Use Latin-script names for this export; no characters have been replaced.', { cause })
    throw cause
  }
}
