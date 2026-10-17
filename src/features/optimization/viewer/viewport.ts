import type { GrainDirection } from '../../../domain/model/orientation'
import type { Rect, Size2D } from '../../../domain/geometry/rect'
import { toMm, toNonNegativeUm, toPositiveUm } from '../../../domain/geometry/units'

export interface Point { readonly x: number; readonly y: number }
export interface CanvasSize { readonly width: number; readonly height: number }
export interface CanvasRect extends Point, CanvasSize { }
/** Canvas pixels per millimeter; x/y are canvas-pixel translations. */
export interface Viewport extends Point { readonly scale: number }

function finite(value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError('Expected a finite canvas coordinate')
  }
}

function positive(value: number): void {
  finite(value);
  if (value <= 0) {
    throw new RangeError('Expected a positive canvas extent or scale')
  }
}

function validateView(view: Viewport): void {
  positive(view.scale);
  finite(view.x);
  finite(view.y)
}

export function rectToCanvas(rect: Rect, view: Viewport): CanvasRect {
  validateView(view)
  return {
    x: toMm(toNonNegativeUm(rect.xMm)) * view.scale + view.x,
    y: toMm(toNonNegativeUm(rect.yMm)) * view.scale + view.y,
    width: toMm(toNonNegativeUm(rect.lengthMm)) * view.scale,
    height: toMm(toNonNegativeUm(rect.widthMm)) * view.scale,
  }
}

export function fitViewport(panel: Size2D, canvas: CanvasSize, padding = 24): Viewport {
  positive(canvas.width);
  positive(canvas.height);
  finite(padding)
  if (padding < 0 || canvas.width <= padding * 2 || canvas.height <= padding * 2) {
    throw new RangeError('Canvas has no space inside its padding')
  }
  const width = toMm(toPositiveUm(panel.lengthMm))
  const height = toMm(toPositiveUm(panel.widthMm))
  const scale = Math.min((canvas.width - padding * 2) / width, (canvas.height - padding * 2) / height)
  return { scale, x: (canvas.width - width * scale) / 2, y: (canvas.height - height * scale) / 2 }
}

export function zoomViewport(view: Viewport, factor: number, anchor: Point, minScale: number, maxScale: number): Viewport {
  validateView(view);
  positive(factor);
  finite(anchor.x);
  finite(anchor.y);
  positive(minScale);
  positive(maxScale)
  if (minScale > maxScale) {
    throw new RangeError('Zoom bounds are reversed')
  }
  const scale = Math.max(minScale, Math.min(maxScale, view.scale * factor))
  const ratio = scale / view.scale
  return { scale, x: anchor.x - (anchor.x - view.x) * ratio, y: anchor.y - (anchor.y - view.y) * ratio }
}

export function panViewport(view: Viewport, delta: Point): Viewport {
  validateView(view);
  finite(delta.x);
  finite(delta.y)
  return { ...view, x: view.x + delta.x, y: view.y + delta.y }
}

/** Annotation arithmetic is in canvas units, never raw physical millimeters. */
export function labelLayout(rect: CanvasRect, scale: number) {
  positive(scale)
  const padding = 6 / scale
  return {
    x: rect.x + padding,
    y: rect.y + padding,
    width: Math.max(0, rect.width - 2 * padding),
    height: Math.max(0, rect.height - 2 * padding),
    fontSize: 13 / scale,
    visible: rect.width * scale >= 100 && rect.height * scale >= 44
  }
}

export function grainPoints(rect: CanvasRect, grain: GrainDirection): readonly number[] {
  if (grain === 'none') {
    return []
  }
  return grain === 'length'
    ? [rect.x + rect.width * 0.2, rect.y + rect.height * 0.8, rect.x + rect.width * 0.8, rect.y + rect.height * 0.8]
    : [rect.x + rect.width * 0.8, rect.y + rect.height * 0.2, rect.x + rect.width * 0.8, rect.y + rect.height * 0.8]
}

/** Screen-sized grain marker just outside the panel outline, within the fit padding. */
export function panelGrainPoints(rect: CanvasRect, grain: GrainDirection, scale: number): readonly number[] {
  positive(scale)
  if (grain === 'none') {
    return []
  }
  const half = 15 / scale
  const offset = 10 / scale
  const centerX = rect.x + rect.width / 2
  const centerY = rect.y + rect.height / 2
  return grain === 'length'
    ? [centerX - half, rect.y - offset, centerX + half, rect.y - offset]
    : [rect.x - offset, centerY - half, rect.x - offset, centerY + half]
}

/** Screen-sized annotations, independent of the physical cutting geometry. */
export function grainMarker(rect: CanvasRect, grain: GrainDirection, scale: number) {
  positive(scale)
  if (grain === 'none' || rect.width * scale < 48 || rect.height * scale < 48) {
    return null
  }
  const x = rect.x + rect.width - 12 / scale
  const y = rect.y + rect.height - 12 / scale
  const span = 20 / scale
  const gap = 3 / scale
  const arrow = grain === 'length' ? [x - span, y, x, y] : [x, y - span, x, y]
  const lines = [1, 2, 3].map(index => grain === 'length'
    ? [x - span, y - gap * index, x, y - gap * index]
    : [x - gap * index, y - span, x - gap * index, y])
  return { arrow, lines }
}

/** 45-degree strokes spaced in screen pixels; Konva clips them to the waste leaf. */
export function hatchLines(rect: CanvasRect, scale: number): readonly (readonly [number, number, number, number])[] {
  positive(scale)
  const step = Math.SQRT2 * 8 / scale
  const min = rect.x + rect.y
  const max = min + rect.width + rect.height
  const lines: [number, number, number, number][] = []
  for (let sum = Math.ceil(min / step) * step; sum <= max; sum += step) {
    lines.push([sum - rect.y, rect.y, sum - rect.y - rect.height, rect.y + rect.height])
  }
  return lines
}
