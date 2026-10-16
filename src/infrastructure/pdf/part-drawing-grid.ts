import type { Rect } from '../../domain/geometry/rect'
import { pdfRect, type PdfBox } from './pdf-layout'
import { DIMENSION_CLEARANCE, technicalTransform } from './technical-drawing'

/** PDF-point layout only; the source millimetre rectangle is never resized or rotated. */
export function partDrawingCells(size: { width: number; height: number }, minimumHeight = 170, count = 6): readonly PdfBox[] {
  const area = { x: 28, y: 36, width: size.width - 56, height: size.height - 96 }
  if (![area.width, area.height, minimumHeight].every(Number.isFinite) || area.width < 170 || area.height < minimumHeight || minimumHeight <= 0) throw new RangeError('The paper is too small for readable part drawings.')
  if (!Number.isSafeInteger(count) || count < 1) throw new RangeError('Invalid drawing count.')
  const capacity = Math.min(3, Math.floor(area.height / minimumHeight)) * 2
  const drawingCount = Math.min(count, capacity)
  const columns = drawingCount === 1 ? 1 : 2
  const rows = Math.ceil(drawingCount / columns)
  const width = area.width / columns
  const height = area.height / rows
  return Array.from({ length: drawingCount }, (_, index) => ({ x: area.x + index % columns * width, y: area.y + area.height - (Math.floor(index / columns) + 1) * height, width, height }))
}
export function partDrawingGeometry(rect: Rect, cell: PdfBox, headerHeight: number, footerHeight: number) {
  const available = { x: cell.x + DIMENSION_CLEARANCE, y: cell.y + footerHeight + DIMENSION_CLEARANCE, width: cell.width - DIMENSION_CLEARANCE * 2, height: cell.height - headerHeight - footerHeight - DIMENSION_CLEARANCE - 10 }
  const transform = technicalTransform(rect, available)
  return { transform, box: pdfRect(rect, transform), available }
}
