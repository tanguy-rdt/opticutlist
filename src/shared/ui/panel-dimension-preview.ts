import { toPositiveUm } from '../../domain/geometry/units'
import type { GrainDirection } from '../../domain/model/orientation'

export type PanelPreviewSize = 'small' | 'default'
type Point = { x: number; y: number }
type Line = { start: Point; end: Point }
const sizes = { small: { width: 280, height: 200 }, default: { width: 320, height: 230 } } as const
const spacing = {
  padding: 10,
  fontSize: 15,
  dimensionOffset: 16,
  labelGap: 8,
  extensionGap: 3,
  overrun: 3,
  arrowLength: 4,
  arrowHalfWidth: 2,
  outsideTail: 10
} as const
function arrow(tip: Point, axis: 'length' | 'width', direction: number): string {
  const base = axis === 'length' ? { x: tip.x + direction * spacing.arrowLength, y: tip.y } : { x: tip.x, y: tip.y + direction * spacing.arrowLength }
  const points = axis === 'length'
    ? [tip, { x: base.x, y: base.y - spacing.arrowHalfWidth }, { x: base.x, y: base.y + spacing.arrowHalfWidth }]
    : [tip, { x: base.x - spacing.arrowHalfWidth, y: base.y }, { x: base.x + spacing.arrowHalfWidth, y: base.y }]
  return `M ${points.map(point => `${String(point.x)} ${String(point.y)}`).join(' L ')} Z`
}
function drawing(width: number, height: number, lengthLabel: string, widthLabel: string) {
  const left = -width / 2;
  const right = width / 2;
  const top = -height / 2;
  const bottom = height / 2
  const dimensionX = left - spacing.dimensionOffset;
  const dimensionY = bottom + spacing.dimensionOffset
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
  const horizontal: Line = {
    start: { x: left - (horizontalOutside ? spacing.outsideTail : 0), y: dimensionY },
    end: { x: right + (horizontalOutside ? spacing.outsideTail : 0), y: dimensionY }
  }
  const vertical: Line = {
    start: { x: dimensionX, y: top - (verticalOutside ? spacing.outsideTail : 0) },
    end: { x: dimensionX, y: bottom + (verticalOutside ? spacing.outsideTail : 0) }
  }
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
  return {
    panel: { x: left, y: top, width, height },
    horizontal,
    vertical,
    horizontalLabel,
    verticalLabel,
    horizontalOutside,
    verticalOutside,
    extensions,
    bounds
  }
}

/** Millimetres are converted once to supported integer micrometres; annotations use SVG pixels. */
export function fitPanelDimensionPreview(lengthMm: number, widthMm: number, size: PanelPreviewSize = 'default') {
  const length = toPositiveUm(lengthMm);
  const width = toPositiveUm(widthMm)
  const box = sizes[size]
  const lengthLabel = `${String(lengthMm)} mm`;
  const widthLabel = `${String(widthMm)} mm`
  const availableWidth = box.width - spacing.padding * 2;
  const availableHeight = box.height - spacing.padding * 2
  const empty = drawing(0, 0, lengthLabel, widthLabel)
  if (empty.bounds.right - empty.bounds.left > availableWidth || empty.bounds.bottom - empty.bounds.top > availableHeight) throw new RangeError('Dimensions cannot be annotated legibly in this preview size')
  let low = 0;
  let high = Math.min(availableWidth / length, availableHeight / width)
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
// Fixed vector curves in a lengthwise 1000 × 400 drawing space. The gaps flow around two knots.
const grainLines = [
  'M -540 -174 C -350 -144 -210 -199 -40 -171 S 310 -142 540 -169',
  'M -540 -129 C -370 -111 -310 -156 -172 -133 S 110 -88 258 -121 S 433 -141 540 -109',
  'M -540 -80 C -360 -46 -285 -113 -150 -112 S 84 -46 250 -79 S 430 -96 540 -62',
  'M -540 -34 C -390 -12 -270 -105 -145 -90 S 80 -2 230 -34 S 415 -64 540 -28',
  'M -540 8 C -370 44 -255 55 -145 48 S 45 3 188 28 S 410 55 540 17',
  'M -540 57 C -390 89 -252 75 -90 91 S 110 62 260 65 S 436 85 540 60',
  'M -540 111 C -352 145 -177 109 15 129 S 175 151 278 150 S 430 112 540 123',
  'M -540 170 C -359 151 -216 190 -37 169 S 140 182 293 180 S 423 160 540 174',
] as const
const grainKnots = [
  'M -224 -24 C -209 -66 -92 -69 -62 -23 C -82 22 -205 25 -224 -24 Z',
  'M -194 -23 C -182 -45 -117 -44 -94 -20 C -112 4 -179 7 -194 -23 Z',
  'M 225 108 C 238 80 302 79 324 105 C 309 135 246 139 225 108 Z',
  'M 249 109 C 260 94 286 94 299 108 C 287 122 260 124 249 109 Z',
] as const
export function previewGrainIllustration(panel: { width: number; height: number }, direction: GrainDirection) {
  if (direction === 'none' || Math.min(panel.width, panel.height) < 16) return null
  return {
    transform: direction === 'length'
      ? `scale(${String(panel.width / 1000)} ${String(panel.height / 400)})`
      : `rotate(90) scale(${String(panel.height / 1000)} ${String(panel.width / 400)})`,
    lines: grainLines,
    knots: grainKnots,
  }
}
