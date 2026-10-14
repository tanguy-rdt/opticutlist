import { toPositiveUm } from '../../domain/geometry/units'
import type { GrainDirection } from '../../domain/model/orientation'

export type PanelPreviewSize = 'small' | 'default'
type Point = { x: number; y: number }
type Line = { start: Point; end: Point }
const sizes = { small: { width: 280, height: 200 }, default: { width: 320, height: 230 } } as const
const spacing = { padding: 10, fontSize: 15, dimensionOffset: 16, labelGap: 8, extensionGap: 3, overrun: 3, arrowLength: 4, arrowHalfWidth: 2, outsideTail: 10 } as const
function arrow(tip: Point, axis: 'length' | 'width', direction: number): string {
  const base = axis === 'length' ? { x: tip.x + direction * spacing.arrowLength, y: tip.y } : { x: tip.x, y: tip.y + direction * spacing.arrowLength }
  const points = axis === 'length'
    ? [tip, { x: base.x, y: base.y - spacing.arrowHalfWidth }, { x: base.x, y: base.y + spacing.arrowHalfWidth }]
    : [tip, { x: base.x - spacing.arrowHalfWidth, y: base.y }, { x: base.x + spacing.arrowHalfWidth, y: base.y }]
  return `M ${points.map(point => `${String(point.x)} ${String(point.y)}`).join(' L ')} Z`
}
function drawing(width: number, height: number, lengthLabel: string, widthLabel: string) {
  const left = -width / 2; const right = width / 2; const top = -height / 2; const bottom = height / 2
  const dimensionX = left - spacing.dimensionOffset; const dimensionY = bottom + spacing.dimensionOffset
  // Conservative text envelopes keep labels clear without depending on a browser font measurement.
  const labelWidth = lengthLabel.length * spacing.fontSize * 0.65
  const labelHeight = widthLabel.length * spacing.fontSize * 0.65
  const verticalLabel = { x: dimensionX - spacing.labelGap - spacing.fontSize / 2, y: 0 }
  const horizontalLabel = { x: 0, y: dimensionY + spacing.labelGap + spacing.fontSize / 2 }
  if (-labelWidth / 2 < verticalLabel.x + spacing.fontSize / 2) {
    horizontalLabel.y = Math.max(horizontalLabel.y, labelHeight / 2 + spacing.labelGap + spacing.fontSize / 2)
  }
  const horizontalOutside = width < spacing.arrowLength * 2 + spacing.labelGap
  const verticalOutside = height < spacing.arrowLength * 2 + spacing.labelGap
  const horizontal: Line = { start: { x: left - (horizontalOutside ? spacing.outsideTail : 0), y: dimensionY }, end: { x: right + (horizontalOutside ? spacing.outsideTail : 0), y: dimensionY } }
  const vertical: Line = { start: { x: dimensionX, y: top - (verticalOutside ? spacing.outsideTail : 0) }, end: { x: dimensionX, y: bottom + (verticalOutside ? spacing.outsideTail : 0) } }
  const extensions: Line[] = [
    { start: { x: left, y: bottom + spacing.extensionGap }, end: { x: left, y: dimensionY + spacing.overrun } },
    { start: { x: right, y: bottom + spacing.extensionGap }, end: { x: right, y: dimensionY + spacing.overrun } },
    { start: { x: left - spacing.extensionGap, y: top }, end: { x: dimensionX - spacing.overrun, y: top } },
    { start: { x: left - spacing.extensionGap, y: bottom }, end: { x: dimensionX - spacing.overrun, y: bottom } },
  ]
  const bounds = {
    left: Math.min(dimensionX - spacing.overrun, verticalLabel.x - spacing.fontSize / 2, -labelWidth / 2, horizontal.start.x),
    right: Math.max(right, labelWidth / 2, horizontal.end.x),
    top: Math.min(top, -labelHeight / 2, vertical.start.y),
    bottom: Math.max(horizontalLabel.y + spacing.fontSize / 2, labelHeight / 2, vertical.end.y, dimensionY + spacing.overrun),
  }
  return { panel: { x: left, y: top, width, height }, horizontal, vertical, horizontalLabel, verticalLabel, horizontalOutside, verticalOutside, extensions, bounds }
}

/** Millimetres are converted once to supported integer micrometres; annotations use SVG pixels. */
export function fitPanelDimensionPreview(lengthMm: number, widthMm: number, size: PanelPreviewSize = 'default') {
  const length = toPositiveUm(lengthMm); const width = toPositiveUm(widthMm)
  const box = sizes[size]
  const lengthLabel = `${String(lengthMm)} mm`; const widthLabel = `${String(widthMm)} mm`
  const availableWidth = box.width - spacing.padding * 2; const availableHeight = box.height - spacing.padding * 2
  const empty = drawing(0, 0, lengthLabel, widthLabel)
  if (empty.bounds.right - empty.bounds.left > availableWidth || empty.bounds.bottom - empty.bounds.top > availableHeight) throw new RangeError('Dimensions cannot be annotated legibly in this preview size')
  let low = 0; let high = Math.min(availableWidth / length, availableHeight / width)
  // Fit the complete annotation envelope, not merely the rectangle. Fixed iterations are deterministic.
  for (let iteration = 0; iteration < 40; iteration++) {
    const scale = (low + high) / 2
    const candidate = drawing(length * scale, width * scale, lengthLabel, widthLabel)
    if (candidate.bounds.right - candidate.bounds.left <= availableWidth && candidate.bounds.bottom - candidate.bounds.top <= availableHeight) low = scale
    else high = scale
  }
  const layout = drawing(length * low, width * low, lengthLabel, widthLabel)
  const translation = { x: (box.width - layout.bounds.left - layout.bounds.right) / 2, y: (box.height - layout.bounds.top - layout.bounds.bottom) / 2 }
  return {
    ...layout, ...box, translation, lengthLabel, widthLabel, fontSize: spacing.fontSize,
    horizontalArrows: [arrow({ x: layout.panel.x, y: layout.horizontal.start.y }, 'length', layout.horizontalOutside ? -1 : 1), arrow({ x: layout.panel.x + layout.panel.width, y: layout.horizontal.end.y }, 'length', layout.horizontalOutside ? 1 : -1)],
    verticalArrows: [arrow({ x: layout.vertical.start.x, y: layout.panel.y }, 'width', layout.verticalOutside ? -1 : 1), arrow({ x: layout.vertical.end.x, y: layout.panel.y + layout.panel.height }, 'width', layout.verticalOutside ? 1 : -1)],
  }
}
export function previewGrainPath(panel: { width: number; height: number }, direction: GrainDirection): string | null {
  if (direction === 'none' || Math.min(panel.width, panel.height) < 16) return null
  const half = Math.min(24, (direction === 'length' ? panel.width : panel.height) / 4)
  return direction === 'length'
    ? `M ${String(-half)} 0 H ${String(half)} M ${String(half - 4)} -3 L ${String(half)} 0 L ${String(half - 4)} 3`
    : `M 0 ${String(-half)} V ${String(half)} M -3 ${String(half - 4)} L 0 ${String(half)} L 3 ${String(half - 4)}`
}
