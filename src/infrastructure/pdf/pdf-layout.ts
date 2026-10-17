import type { PdfOrientation, PdfPageSize } from '../../application/export/cutting-plan-pdf-service'
import type { Rect } from '../../domain/geometry/rect'
import { toNonNegativeUm, toPositiveUm } from '../../domain/geometry/units'

export interface PdfBox { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

export interface PdfTransform { readonly x: number; readonly y: number; readonly scale: number; readonly panelHeight: number }


const POINTS_PER_MM = 72 / 25.4
export function millimetresToPoints(mm: number): number { return toNonNegativeUm(mm) / 1000 * POINTS_PER_MM }
export function a4PageSize(orientation: PdfOrientation): { width: number; height: number } { return pdfPageSize('A4', orientation) }
export function pdfPageSize(size: PdfPageSize, orientation: PdfOrientation): { width: number; height: number } {
  const short = millimetresToPoints(size === 'A3' ? 297 : 210)
  const long = millimetresToPoints(size === 'A3' ? 420 : 297)
  return orientation === 'portrait' ? { width: short, height: long } : { width: long, height: short }
}
/** Coordinates use PDF's bottom-left origin; a single scale preserves the panel aspect ratio. */
export function fitPdfPanel(panel: Rect, box: PdfBox): PdfTransform {
  if (![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0) throw new RangeError('Invalid PDF drawing area')
  const width = toPositiveUm(panel.lengthMm) / 1000 * POINTS_PER_MM
  const height = toPositiveUm(panel.widthMm) / 1000 * POINTS_PER_MM
  const scale = Math.min(box.width / width, box.height / height)
  return { x: box.x + (box.width - width * scale) / 2, y: box.y + (box.height - height * scale) / 2, scale, panelHeight: height }
}
/** Zero-width/height kerf lines are preserved, rather than inflated into fake physical regions. */
export function pdfRect(region: Rect, transform: PdfTransform): PdfBox {
  const x = millimetresToPoints(region.xMm)
  const y = millimetresToPoints(region.yMm)
  const width = millimetresToPoints(region.lengthMm)
  const height = millimetresToPoints(region.widthMm)
  return {
    x: transform.x + x * transform.scale,
    y: transform.y + (transform.panelHeight - y - height) * transform.scale,
    width: width * transform.scale,
    height: height * transform.scale
  }
}
