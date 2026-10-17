import type { Rect } from '../../domain/geometry/rect'
import { pdfRect, type PdfBox } from './pdf-layout'
import { DIMENSION_CLEARANCE, technicalTransform } from './technical-drawing'

/** PDF-point layout only; the source millimetre rectangle is never resized or rotated. */
export function partDrawingCells(
  size: { width: number; height: number },
  minimumHeight = 170,
  count = 6,
  titleBlockHeight = 42
): readonly PdfBox[] {
  const area = { x: 28, y: 36 + titleBlockHeight, width: size.width - 56, height: size.height - 52 - titleBlockHeight }
  if (
    ![area.width, area.height, minimumHeight, titleBlockHeight].every(Number.isFinite)
    || area.width < 170
    || area.height < minimumHeight
    || minimumHeight <= 0
    || titleBlockHeight < 0
  ) {
    throw new RangeError('The paper is too small for readable part drawings.')
  }
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new RangeError('Invalid drawing count.')
  }
  const rowCapacity = Math.min(3, Math.floor(area.height / minimumHeight))
  const capacity = rowCapacity * 2
  const drawingCount = Math.min(count, capacity)
  const columns = 2
  const width = area.width / columns
  // A partial page keeps the same cell size as a full page; unused rows stay blank.
  const height = area.height / rowCapacity
  return Array.from({ length: drawingCount }, (_, index) => ({ x: area.x + index % columns * width, y: area.y + area.height - (Math.floor(index / columns) + 1) * height, width, height }))
}

export function partDrawingGeometry(rect: Rect, cell: PdfBox, headerHeight: number, footerHeight: number) {
  const available = {
    x: cell.x + DIMENSION_CLEARANCE,
    y: cell.y + footerHeight + DIMENSION_CLEARANCE,
    width: cell.width - DIMENSION_CLEARANCE * 2,
    height: cell.height - headerHeight - footerHeight - DIMENSION_CLEARANCE - 10
  }
  const transform = technicalTransform(rect, available)
  return { transform, box: pdfRect(rect, transform), available }
}
