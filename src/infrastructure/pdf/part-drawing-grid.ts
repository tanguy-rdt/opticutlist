import type { Rect } from '../../domain/geometry/rect'
import { pdfRect, type PdfBox } from './pdf-layout'
import { DIMENSION_CLEARANCE, technicalTransform } from './technical-drawing'

/** PDF-point layout only; the source millimetre rectangle is never resized or rotated. */
export function partDrawingCells(size: { width: number; height: number }, minimumHeight = 170): readonly PdfBox[] {
  const area = { x: 36, y: 120, width: size.width - 72, height: size.height - 180 }
  if (![area.width, area.height, minimumHeight].every(Number.isFinite) || area.width < 170 || area.height < minimumHeight || minimumHeight <= 0) throw new RangeError('The paper is too small for readable part drawings.')
  const rows = Math.min(3, Math.floor(area.height / minimumHeight))
  const width = area.width / 2
  const height = area.height / rows
  return Array.from({ length: rows * 2 }, (_, index) => ({ x: area.x + index % 2 * width, y: area.y + area.height - (Math.floor(index / 2) + 1) * height, width, height }))
}
export function partDrawingGeometry(rect: Rect, cell: PdfBox, headerHeight: number, footerHeight: number) {
  const available = { x: cell.x + DIMENSION_CLEARANCE, y: cell.y + footerHeight + DIMENSION_CLEARANCE, width: cell.width - DIMENSION_CLEARANCE * 2, height: cell.height - headerHeight - footerHeight - DIMENSION_CLEARANCE - 10 }
  const transform = technicalTransform(rect, available)
  return { transform, box: pdfRect(rect, transform), available }
}
