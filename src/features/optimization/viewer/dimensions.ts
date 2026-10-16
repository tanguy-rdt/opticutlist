import Konva from 'konva'
import { toNonNegativeUm } from '../../../domain/geometry/units'
import type { CuttingPlanScene } from '../../../application/optimization/cutting-plan-scene'
import { fitViewport, rectToCanvas, type CanvasSize, type Viewport } from './viewport'

/** Fixed screen-space annotation lanes, independent of physical millimeter geometry. */
const insets = { left: 96, top: 90, right: 72, bottom: 60 }
export function fitDimensionedViewport(panel: CuttingPlanScene['panel'], size: CanvasSize): Viewport {
  const fitted = fitViewport(panel, { width: size.width - insets.left - insets.right, height: size.height - insets.top - insets.bottom }, 0)
  return { ...fitted, x: fitted.x + insets.left, y: fitted.y + insets.top }
}
export interface DimensionAnnotation {
  readonly id: string
  readonly axis: 'horizontal' | 'vertical'
  readonly start: number
  readonly end: number
  readonly edge: number
  readonly lane: number
  readonly label: string
}
/** Values come from validated millimeters; only annotation placement uses screen coordinates. */
export function dimensionAnnotations(scene: CuttingPlanScene, view: Viewport, selected: string, detailed: boolean): readonly DimensionAnnotation[] {
  const panel = rectToCanvas(scene.panel, view)
  const annotations: DimensionAnnotation[] = [
    { id: 'panel-length', axis: 'horizontal', start: panel.x, end: panel.x + panel.width, edge: panel.y, lane: panel.y - 30, label: `${String(scene.panel.lengthMm)} mm` },
    { id: 'panel-width', axis: 'vertical', start: panel.y, end: panel.y + panel.height, edge: panel.x, lane: panel.x - 30, label: `${String(scene.panel.widthMm)} mm` },
  ]
  const part = detailed ? scene.parts.find(item => item.key === selected) : undefined
  if (!part) return annotations
  const rect = rectToCanvas(part.region, view)
  annotations.push(
    { id: 'part-length', axis: 'horizontal', start: rect.x, end: rect.x + rect.width, edge: rect.y + rect.height, lane: panel.y + panel.height + 26, label: `${String(part.dimensions.lengthMm)} mm` },
    { id: 'part-width', axis: 'vertical', start: rect.y, end: rect.y + rect.height, edge: rect.x + rect.width, lane: panel.x + panel.width + 30, label: `${String(part.dimensions.widthMm)} mm` },
  )
  if (toNonNegativeUm(part.region.xMm) > 0) annotations.push({ id: 'position-x', axis: 'horizontal', start: panel.x, end: rect.x, edge: rect.y, lane: panel.y - 62, label: `X ${String(part.region.xMm)} mm` })
  if (toNonNegativeUm(part.region.yMm) > 0) annotations.push({ id: 'position-y', axis: 'vertical', start: panel.y, end: rect.y, edge: rect.x, lane: panel.x - 62, label: `Y ${String(part.region.yMm)} mm` })
  return annotations
}

/** Inverse stage transform keeps text, strokes and ticks screen-sized; nodes never listen. */
export function createDimensionOverlay(layer: Konva.Layer) {
  const group = new Konva.Group({ name: 'technical-dimensions', listening: false })
  layer.add(group)
  const slots = Array.from({ length: 6 }, () => {
    const lines = Array.from({ length: 5 }, () => new Konva.Line<Konva.LineConfig>({ listening: false, strokeWidth: 0.8 }))
    const text = new Konva.Text({ listening: false, fontSize: 12, align: 'center', wrap: 'none' })
    group.add(...lines, text)
    return { lines, text }
  })
  return (annotations: readonly DimensionAnnotation[], view: Viewport, color: string): void => {
    group.setAttrs({ x: -view.x / view.scale, y: -view.y / view.scale, scaleX: 1 / view.scale, scaleY: 1 / view.scale })
    slots.forEach(({ lines, text }, index) => {
      const item = annotations[index]
      for (const line of lines) line.setAttrs({ visible: item !== undefined })
      text.setAttrs({ visible: item !== undefined })
      if (!item) return
      const { start, end, lane, edge } = item
      const direction = Math.sign(lane - edge)
      const paths: [number, number, number, number][] = [
        [start, edge + direction * 4, start, lane + direction * 5],
        [end, edge + direction * 4, end, lane + direction * 5],
        [start, lane, end, lane],
        [start - 3, lane + 3, start + 3, lane - 3],
        [end - 3, lane + 3, end + 3, lane - 3],
      ]
      lines.forEach((line, lineIndex) => {
        const points = paths[lineIndex]
        if (!points) return
        line.setAttrs({ stroke: color, points: item.axis === 'horizontal' ? points : [points[1], points[0], points[3], points[2]] })
      })
      const width = Math.max(90, item.label.length * 7)
      const midpoint = (start + end) / 2
      text.setAttrs({ name: item.id, text: item.label, fill: color, width, height: 15,
        x: item.axis === 'horizontal' ? midpoint - width / 2 : lane + (direction > 0 ? 8 : -23),
        y: item.axis === 'horizontal' ? lane + (direction > 0 ? 8 : -23) : midpoint + width / 2,
        rotation: item.axis === 'horizontal' ? 0 : -90 })
    })
  }
}
