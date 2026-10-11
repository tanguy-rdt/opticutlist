import { toPositiveUm } from '../../domain/geometry/units'

/** Presentation coordinates only. Length is horizontal; physical proportions are never clamped. */
export function fitPartPreview(lengthMm: number, widthMm: number) {
  const length = toPositiveUm(lengthMm)
  const width = toPositiveUm(widthMm)
  const scale = Math.min(220 / length, 130 / width)
  const rectWidth = length * scale
  const rectHeight = width * scale
  return { x: (300 - rectWidth) / 2, y: (210 - rectHeight) / 2, width: rectWidth, height: rectHeight }
}
