import type { PDFFont, PDFPage } from 'pdf-lib'
import { boundedPdfText, wrapPdfText } from './pdf-text'
import { technicalInk, technicalRule, type SheetNumberPosition } from './technical-sheet'
import type { CuttingSettings } from '../../domain/model/cutting-settings'

/** Identical physical frame and proportions on every non-cover sheet. */
export function technicalTitleBlockLayout(width: number) {
  const contextWidth = 145
  const cellWidth = 72.5
  return { x: 28, width, projectWidth: width - contextWidth - cellWidth * 2, contextWidth, cellWidth, height: 52, top: 88 }
}
export function cuttingSettingsContext(settings: CuttingSettings) {
  return { label: 'CUTTING SETTINGS', lines: [`Kerf: ${String(settings.kerfMm)} mm`, `Edge margin: ${String(settings.edgeMarginMm)} mm`] }
}
export type TechnicalTitleContent = {
  readonly projectName: string
  readonly context: { readonly label: string; readonly lines: readonly string[] }
  readonly scale: string
}
/** One renderer; sheet values are filled in after complete document pagination. */
export function drawTechnicalTitleBlock(page: PDFPage, font: PDFFont, bold: PDFFont, block: ReturnType<typeof technicalTitleBlockLayout>, content: TechnicalTitleContent): SheetNumberPosition {
  const { x, top, height, width } = block
  const projectEnd = x + block.projectWidth
  const contextEnd = projectEnd + block.contextWidth
  const scaleEnd = contextEnd + block.cellWidth
  const rule = (x1: number, y1: number, x2: number, y2: number) => { page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.3, color: technicalRule }) }
  rule(x, top, x + width, top)
  for (const end of [projectEnd, contextEnd, scaleEnd]) rule(end, 36, end, top)
  const label = (value: string, left: number) => { page.drawText(value, { x: left, y: top - 12, size: 6, font, color: technicalInk }) }
  label('PROJECT', x + 6)
  const wrapped = wrapPdfText(content.projectName, bold, 8, block.projectWidth - 12)
  const projectLines = wrapped.slice(0, 3)
  if (wrapped.length > 3) projectLines[2] = boundedPdfText(wrapped.slice(2).join(' '), bold, 8, block.projectWidth - 12)
  projectLines.forEach((value, index) => { page.drawText(value, { x: x + 6, y: top - 26 - index * 10, size: 8, font: bold, color: technicalInk }) })
  label(content.context.label, projectEnd + 6)
  const contextLines = content.context.lines.flatMap(value => wrapPdfText(value, font, 7, block.contextWidth - 12))
  if (contextLines.length > 3) throw new Error('The technical title-block settings are too long to fit safely.')
  contextLines.forEach((value, index) => { page.drawText(value, { x: projectEnd + 6, y: top - 26 - index * 10, size: 7, font, color: technicalInk }) })
  // Center each label/value pair as a measured group, not at fixed baseline offsets.
  const labelHeight = font.heightAtSize(6, { descender: false })
  const valueHeight = bold.heightAtSize(8, { descender: false })
  const valueY = 36 + (height - labelHeight - 5 - valueHeight) / 2
  const labelY = valueY + valueHeight + 5
  for (const [value, left] of [['SCALE', contextEnd], ['SHEET', scaleEnd]] as const) page.drawText(value, { x: left + (block.cellWidth - font.widthOfTextAtSize(value, 6)) / 2, y: labelY, size: 6, font, color: technicalInk })
  if (font.widthOfTextAtSize(content.scale, 8) > block.cellWidth - 12) throw new Error('The drawing scale does not fit the technical title block.')
  page.drawText(content.scale, { x: contextEnd + (block.cellWidth - font.widthOfTextAtSize(content.scale, 8)) / 2, y: valueY, size: 8, font, color: technicalInk })
  return { x: scaleEnd, y: valueY, width: block.cellWidth, fontSize: 8, bold: true }
}
