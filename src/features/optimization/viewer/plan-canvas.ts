import Konva from 'konva'
import type { CuttingPlanScene } from '../../../application/optimization/cutting-plan-scene'
import { grainPoints, panelGrainPoints, labelLayout, rectToCanvas, type CanvasSize, type Viewport } from './viewport'

export interface PlanPalette {
  readonly surface: string
  readonly margin: string
  readonly ink: string
  readonly muted: string
  readonly part: string
  readonly partBorder: string
  readonly selected: string
  readonly kerf: string
}
export interface PlanCanvas {
  setViewport(view: Viewport): void
  setSelection(key: string): void
  setPalette(palette: PlanPalette): void
  resize(size: CanvasSize): void
  destroy(): void
}

/** Read-only Konva adapter. Only the stage is draggable, which pans the viewport. */
export function createPlanCanvas(container: HTMLDivElement, scene: CuttingPlanScene, size: CanvasSize, palette: PlanPalette, onSelect: (key: string) => void, onPan: (view: Viewport) => void): PlanCanvas {
  const stage = new Konva.Stage({ container, ...size, draggable: true })
  try {
    const layer = new Konva.Layer()
    stage.add(layer)
    const base = { x: 0, y: 0, scale: 1 }
    const panel = new Konva.Rect({ ...rectToCanvas(scene.panel, base), listening: false, strokeWidth: 2, strokeScaleEnabled: false })
    const usable = new Konva.Rect({ ...rectToCanvas(scene.usableArea, base), listening: false, dash: [5, 4], strokeWidth: 1, strokeScaleEnabled: false })
    layer.add(panel, usable)
    const waste = scene.waste.map(region => new Konva.Rect({ ...rectToCanvas(region, base), listening: false, dash: [4, 3], strokeWidth: 1, strokeScaleEnabled: false }))
    for (const rect of waste) layer.add(rect)
    const kerfs = scene.kerfs.map(region => new Konva.Rect({ ...rectToCanvas(region, base), listening: false, strokeWidth: 1, strokeScaleEnabled: false }))
    for (const rect of kerfs) layer.add(rect)
    const shapes = new Map<string, Konva.Rect>()
    const labels: { text: Konva.Text; rect: ReturnType<typeof rectToCanvas> }[] = []
    const arrows: Konva.Arrow[] = []
    for (const item of scene.parts) {
      const rect = rectToCanvas(item.region, base)
      const shape = new Konva.Rect({ ...rect, draggable: false, strokeWidth: 1, strokeScaleEnabled: false })
      shape.on('click tap', () => { onSelect(item.key) })
      shapes.set(item.key, shape)
      layer.add(shape)
      const text = new Konva.Text({ text: `${item.part.name} / ${String(item.copyIndex + 1)}\n${String(item.dimensions.lengthMm)} × ${String(item.dimensions.widthMm)} × ${String(item.dimensions.thicknessMm)} mm`, listening: false, wrap: 'none', ellipsis: true })
      labels.push({ text, rect })
      layer.add(text)
      const points = grainPoints(rect, item.grain)
      if (points.length > 0) {
        const arrow = new Konva.Arrow({ points: [...points], listening: false, strokeWidth: 1, strokeScaleEnabled: false })
        arrows.push(arrow); layer.add(arrow)
      }
    }
    const usableOutline = new Konva.Rect({ ...rectToCanvas(scene.usableArea, base), listening: false, dash: [5, 4], strokeWidth: 1, strokeScaleEnabled: false })
    layer.add(usableOutline)
    const panelArrow = scene.panelGrain === 'none' ? null : new Konva.Arrow({ name: 'panel-grain', points: [...panelGrainPoints(rectToCanvas(scene.panel, base), scene.panelGrain, 1)], listening: false, strokeWidth: 1, strokeScaleEnabled: false })
    if (panelArrow !== null) layer.add(panelArrow)
    let selected = ''
    let colors = palette
    function applyPalette(): void {
      panel.fill(colors.margin); panel.stroke(colors.ink)
      usable.fill(colors.surface); usable.stroke(colors.muted); usableOutline.stroke(colors.muted)
      for (const rect of waste) { rect.fill(colors.margin); rect.stroke(colors.muted) }
      for (const rect of kerfs) { rect.fill(colors.kerf); rect.stroke(colors.kerf) }
      for (const [key, shape] of shapes) { shape.fill(colors.part); shape.stroke(key === selected ? colors.selected : colors.partBorder) }
      for (const { text } of labels) text.fill(colors.ink)
      for (const arrow of arrows) { arrow.stroke(colors.partBorder); arrow.fill(colors.partBorder) }
      panelArrow?.stroke(colors.ink); panelArrow?.fill(colors.ink)
      layer.batchDraw()
    }
    stage.on('dragend', () => { onPan({ x: stage.x(), y: stage.y(), scale: stage.scaleX() }) })
    applyPalette()
    return {
      setViewport(view) {
        stage.position({ x: view.x, y: view.y }); stage.scale({ x: view.scale, y: view.scale })
        for (const { text, rect } of labels) text.setAttrs(labelLayout(rect, view.scale))
        for (const arrow of arrows) { arrow.pointerLength(5 / view.scale); arrow.pointerWidth(5 / view.scale) }
        panelArrow?.setAttrs({ points: [...panelGrainPoints(rectToCanvas(scene.panel, base), scene.panelGrain, view.scale)], pointerLength: 5 / view.scale, pointerWidth: 5 / view.scale })
        layer.batchDraw()
      },
      setSelection(key) {
        if (key === selected) return
        const previous = shapes.get(selected)
        previous?.stroke(colors.partBorder); previous?.strokeWidth(1)
        selected = key
        const next = shapes.get(selected)
        next?.stroke(colors.selected); next?.strokeWidth(2)
        layer.batchDraw()
      },
      setPalette(next) { colors = next; applyPalette() },
      resize(next) { stage.size(next); layer.batchDraw() },
      destroy() { stage.off(); stage.destroy() },
    }
  } catch (cause) {
    stage.destroy()
    throw cause
  }
}
