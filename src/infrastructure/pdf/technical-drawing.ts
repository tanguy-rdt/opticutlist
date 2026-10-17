import { clip, degrees, endPath, popGraphicsState, pushGraphicsState, rectangle, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { Rect } from '../../domain/geometry/rect'
import type { GrainDirection } from '../../domain/model/orientation'
import { fitPdfPanel, millimetresToPoints, type PdfBox, type PdfTransform } from './pdf-layout'

export interface DrawingLine { readonly start: { x: number; y: number }; readonly end: { x: number; y: number } }

const ink = rgb(0.16, 0.18, 0.17)
const hatchInk = rgb(0.64, 0.65, 0.63)
export const DIMENSION_CLEARANCE = 42

/** Physical drawing ratio, independent of PDF viewer zoom. Never enlarge above 1:1. */
export function technicalTransform(rect: Rect, available: PdfBox): PdfTransform {
  fitPdfPanel(rect, available) // validate the physical drawing area
  const fullWidth = millimetresToPoints(rect.lengthMm)
  const fullHeight = millimetresToPoints(rect.widthMm)
  let denominator = 1
  outer: for (let power = 0; power <= 16; power += 1) {
    for (const factor of [1, 2, 5]) {
      denominator = factor * 10 ** power
      if (fullWidth / denominator <= available.width && fullHeight / denominator <= available.height) {
        break outer
      }
    }
  }
  const scale = 1 / denominator
  const width = fullWidth / denominator
  const height = fullHeight / denominator
  if (width > available.width || height > available.height) {
    throw new RangeError('No supported technical scale fits this drawing area.')
  }
  return {
    x: available.x + (available.width - width) / 2,
    y: available.y + (available.height - height) / 2,
    scale,
    panelHeight: millimetresToPoints(rect.widthMm)
  }
}

export function scaleLabel(transform: PdfTransform): string {
  return `1:${String(Math.round(1 / transform.scale))}`
}

/** Hatch strokes terminate at the waste rectangle; no paths extend into neighboring parts. */
export function wasteHatchLines(box: PdfBox, spacing = 8): readonly DrawingLine[] {
  if (
    ![box.x, box.y, box.width, box.height, spacing].every(Number.isFinite)
    || box.width < 0
    || box.height < 0
    || spacing <= 0
  ) {
    throw new RangeError('Invalid hatch area')
  }
  const lines: DrawingLine[] = []
  const step = spacing * Math.SQRT2
  for (let offset = step; offset < box.width + box.height; offset += step) {
    const x1 = Math.max(0, offset - box.height)
    const y1 = Math.min(box.height, offset)
    const x2 = Math.min(box.width, offset)
    const y2 = Math.max(0, offset - box.width)
    lines.push({ start: { x: box.x + x1, y: box.y + y1 }, end: { x: box.x + x2, y: box.y + y2 } })
  }
  return lines
}

export function drawWaste(page: PDFPage, box: PdfBox): void {
  page.pushOperators(pushGraphicsState(), rectangle(box.x, box.y, box.width, box.height), clip(), endPath())
  for (const line of wasteHatchLines(box)) {
    page.drawLine({ ...line, thickness: 0.25, color: hatchInk })
  }
  page.pushOperators(popGraphicsState())
}

export function drawDimensions(
  page: PDFPage,
  font: PDFFont,
  box: PdfBox,
  lengthMm: number,
  widthMm: number,
  markers: 'ticks' | 'arrows' = 'ticks'
): void {
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.4, color: ink })
  }
  const tick = (x: number, y: number) => {
    line(x - 2.5, y - 2.5, x + 2.5, y + 2.5)
  }
  const horizontalEnd = (x: number, y: number, direction: number) => {
    if (markers === 'ticks') {
      tick(x, y);
      return
    }
    line(x, y, x + direction * 4, y + 1.5);
    line(x, y, x + direction * 4, y - 1.5)
  }
  const verticalEnd = (x: number, y: number, direction: number) => {
    if (markers === 'ticks') {
      tick(x, y);
      return
    }
    line(x, y, x + 1.5, y + direction * 4);
    line(x, y, x - 1.5, y + direction * 4)
  }
  const horizontalOutside = markers === 'arrows' && box.width < 12
  const verticalOutside = markers === 'arrows' && box.height < 12
  const y = box.y - 20
  line(box.x, box.y - 4, box.x, y - 5);
  line(box.x + box.width, box.y - 4, box.x + box.width, y - 5)
  line(box.x - (horizontalOutside ? 10 : 0), y, box.x + box.width + (horizontalOutside ? 10 : 0), y)
  horizontalEnd(box.x, y, horizontalOutside ? -1 : 1);
  horizontalEnd(box.x + box.width, y, horizontalOutside ? 1 : -1)
  const length = `${String(lengthMm)} mm`
  page.drawText(length, { x: box.x + box.width / 2 - font.widthOfTextAtSize(length, 9) / 2, y: y - 13, size: 9, font, color: ink })
  const x = box.x - 20
  line(box.x - 4, box.y, x - 5, box.y);
  line(box.x - 4, box.y + box.height, x - 5, box.y + box.height)
  line(x, box.y - (verticalOutside ? 10 : 0), x, box.y + box.height + (verticalOutside ? 10 : 0))
  verticalEnd(x, box.y, verticalOutside ? -1 : 1);
  verticalEnd(x, box.y + box.height, verticalOutside ? 1 : -1)
  const width = `${String(widthMm)} mm`
  page.drawText(width, { x: x - 8, y: box.y + box.height / 2 - font.widthOfTextAtSize(width, 9) / 2, size: 9, font, color: ink, rotate: degrees(90) })
}

export function drawGrain(page: PDFPage, box: PdfBox, direction: GrainDirection): void {
  if (direction === 'none' || box.width < 32 || box.height < 32) {
    return
  }
  const end = { x: box.x + box.width - 9, y: box.y + 9 }
  const start = direction === 'length' ? { x: end.x - 16, y: end.y } : { x: end.x, y: end.y + 16 }
  page.drawLine({ start, end, thickness: 0.4, color: ink })
  page.drawLine({ start: end, end: { x: end.x - 3, y: end.y + 3 }, thickness: 0.4, color: ink })
  page.drawLine({
    start: end,
    end: direction === 'length' ? { x: end.x - 3, y: end.y - 3 } : { x: end.x + 3, y: end.y + 3 },
    thickness: 0.4,
    color: ink
  })
}

export function drawScaleBar(page: PDFPage, font: PDFFont, x: number, y: number, transform: PdfTransform): void {
  const distance = 20 / transform.scale
  const width = millimetresToPoints(20)
  page.drawLine({ start: { x, y }, end: { x: x + width, y }, thickness: 0.6, color: ink })
  for (const position of [x, x + width / 2, x + width]) {
    page.drawLine({ start: { x: position, y: y - 3 }, end: { x: position, y: y + 3 }, thickness: 0.4, color: ink })
  }
  page.drawText('0', { x, y: y - 12, font, size: 7, color: ink })
  const label = `${String(distance)} mm`
  page.drawText(label, { x: x + width - font.widthOfTextAtSize(label, 7), y: y - 12, font, size: 7, color: ink })
}
