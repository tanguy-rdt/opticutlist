import { copyLabel } from './copy-label'
import Konva from 'konva'
import { createDimensionOverlay, dimensionAnnotations } from './dimensions'
import type { CuttingPlanScene } from '../../../application/optimization/cutting-plan-scene'
import { grainMarker, hatchLines, panelGrainPoints, labelLayout, rectToCanvas, type CanvasSize, type Viewport } from './viewport'

export interface PlanPalette {
  readonly annotation?: string
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
  setDimensions?(detailed: boolean): void
  setKeptWaste?(indices: readonly number[]): void
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
    let viewport: Viewport = base
    const hatching = scene.waste.map(region => {
      const rect = rectToCanvas(region, base)
      const group = new Konva.Group({ name: 'waste-hatching', listening: false, clipX: rect.x, clipY: rect.y, clipWidth: rect.width, clipHeight: rect.height })
      group.add(new Konva.Shape({ listening: false, sceneFunc(context) {
        context.save()
        // Bound annotation work to the visible canvas, including at high manual zoom.
        const x = Math.max(rect.x, -viewport.x / viewport.scale)
        const y = Math.max(rect.y, -viewport.y / viewport.scale)
        const right = Math.min(rect.x + rect.width, (size.width - viewport.x) / viewport.scale)
        const bottom = Math.min(rect.y + rect.height, (size.height - viewport.y) / viewport.scale)
        if (right > x && bottom > y) {
          context.beginPath()
          for (const points of hatchLines({ x, y, width: right - x, height: bottom - y }, viewport.scale)) {
            context.moveTo(points[0], points[1]); context.lineTo(points[2], points[3])
          }
          context.strokeStyle = colors.muted; context.globalAlpha = 0.28; context.lineWidth = 0.65 / viewport.scale; context.stroke()
        }
        context.restore()
      } }))
      return group
    })
    for (const hatch of hatching) layer.add(hatch)
    const kerfs = scene.kerfs.map(region => {
      const rect = rectToCanvas(region, base)
      return new Konva.Rect({ ...rect, name: 'saw-kerf', listening: false, strokeWidth: rect.width === 0 || rect.height === 0 ? 0.75 : 0, strokeScaleEnabled: false })
    })
    for (const rect of kerfs) layer.add(rect)
    const shapes = new Map<string, Konva.Rect>()
    const labels: { text: Konva.Text; rect: ReturnType<typeof rectToCanvas> }[] = []
    const grains: { arrow: Konva.Arrow; lines: Konva.Line[]; rect: ReturnType<typeof rectToCanvas>; direction: typeof scene.panelGrain }[] = []
    for (const item of scene.parts) {
      const rect = rectToCanvas(item.region, base)
      const shape = new Konva.Rect({ ...rect, draggable: false, strokeWidth: 1, strokeScaleEnabled: false })
      shape.on('click tap', () => { onSelect(item.key) })
      shapes.set(item.key, shape)
      layer.add(shape)
      const text = new Konva.Text({ text: `${copyLabel(item.part, item.copyIndex)}\n${String(item.dimensions.lengthMm)} × ${String(item.dimensions.widthMm)} × ${String(item.dimensions.thicknessMm)} mm`, listening: false, wrap: 'none', ellipsis: true })
      labels.push({ text, rect })
      layer.add(text)
      if (item.grain !== 'none') {
        const arrow = new Konva.Arrow({ name: 'part-grain', listening: false, strokeWidth: 0.75, strokeScaleEnabled: false })
        const lines = [0, 1, 2].map(() => new Konva.Line({ name: 'grain-line', listening: false, strokeWidth: 0.65, strokeScaleEnabled: false }))
        grains.push({ arrow, lines, rect, direction: item.grain }); layer.add(...lines, arrow)
      }
    }
    const usableOutline = new Konva.Rect({ ...rectToCanvas(scene.usableArea, base), listening: false, dash: [5, 4], strokeWidth: 1, strokeScaleEnabled: false })
    layer.add(usableOutline)
    const panelArrow = scene.panelGrain === 'none' ? null : new Konva.Arrow({ name: 'panel-grain', points: [...panelGrainPoints(rectToCanvas(scene.panel, base), scene.panelGrain, 1)], listening: false, strokeWidth: 1, strokeScaleEnabled: false })
    const panelLines: Konva.Line[] = panelArrow === null ? [] : [0, 1, 2].map(() => new Konva.Line({ name: 'panel-grain-line', listening: false, strokeWidth: 0.65, strokeScaleEnabled: false }))
    if (panelArrow !== null) layer.add(...panelLines, panelArrow)
    let dimensionOverlay: ReturnType<typeof createDimensionOverlay> | undefined
    let detailedDimensions = false
    function updateDimensions(): void { dimensionOverlay?.(dimensionAnnotations(scene, viewport, selected, detailedDimensions), viewport, colors.annotation ?? colors.ink) }
    let selected = ''
    let colors = palette
    let keptWaste: readonly number[] = []
    function applyPalette(): void {
      panel.fill(colors.margin); panel.stroke(colors.ink)
      usable.fill(colors.surface); usable.stroke(colors.muted); usableOutline.stroke(colors.muted)
      for (const [index, rect] of waste.entries()) { rect.fill(colors.margin); rect.stroke(keptWaste.includes(index) ? colors.selected : colors.muted); rect.strokeWidth(keptWaste.includes(index) ? 2 : 1) }
      for (const rect of kerfs) { rect.fill(colors.kerf); rect.stroke(colors.kerf) }
      for (const [key, shape] of shapes) { shape.fill(colors.part); shape.stroke(key === selected ? colors.selected : colors.partBorder) }
      for (const { text } of labels) text.fill(colors.ink)
      for (const { arrow, lines } of grains) { arrow.stroke(colors.partBorder); arrow.fill(colors.partBorder); for (const line of lines) line.stroke(colors.partBorder) }
      for (const line of panelLines) line.stroke(colors.muted)
      panelArrow?.stroke(colors.ink); panelArrow?.fill(colors.ink)
      updateDimensions()
      layer.batchDraw()
    }
    stage.on('dragmove', () => { viewport = { x: stage.x(), y: stage.y(), scale: stage.scaleX() }; updateDimensions(); layer.batchDraw() })
    stage.on('dragend', () => { viewport = { x: stage.x(), y: stage.y(), scale: stage.scaleX() }; onPan(viewport) })
    applyPalette()
    return {
      setDimensions(detailed) { detailedDimensions = detailed; dimensionOverlay ??= createDimensionOverlay(layer); updateDimensions(); layer.batchDraw() },
      setKeptWaste(indices) { keptWaste = indices; applyPalette() },
      setViewport(view) {
        viewport = view
        stage.position({ x: view.x, y: view.y }); stage.scale({ x: view.scale, y: view.scale })
        for (const { text, rect } of labels) text.setAttrs(labelLayout(rect, view.scale))
        for (const { arrow, lines, rect, direction } of grains) {
          const marker = grainMarker(rect, direction, view.scale)
          arrow.setAttrs({ visible: marker !== null, points: marker?.arrow ?? [], pointerLength: 3 / view.scale, pointerWidth: 3 / view.scale })
          lines.forEach((line, index) => { line.setAttrs({ visible: marker !== null, points: marker?.lines[index] ?? [] }) })
        }
        const panelPoints = panelGrainPoints(rectToCanvas(scene.panel, base), scene.panelGrain, view.scale)
        panelLines.forEach((line, index) => {
          const offset = (index + 1) * 2 / view.scale
          line.setAttrs({ points: panelPoints.map((point, coordinate) => point - ((scene.panelGrain === 'length' ? coordinate % 2 === 1 : coordinate % 2 === 0) ? offset : 0)) })
        })
        panelArrow?.setAttrs({ points: [...panelGrainPoints(rectToCanvas(scene.panel, base), scene.panelGrain, view.scale)], pointerLength: 3 / view.scale, pointerWidth: 3 / view.scale })
        updateDimensions()
        layer.batchDraw()
      },
      setSelection(key) {
        if (key === selected) return
        const previous = shapes.get(selected)
        previous?.stroke(colors.partBorder); previous?.strokeWidth(1)
        selected = key
        const next = shapes.get(selected)
        next?.stroke(colors.selected); next?.strokeWidth(2)
        updateDimensions()
        layer.batchDraw()
      },
      setPalette(next) { colors = next; applyPalette() },
      resize(next) { size = next; stage.size(next); layer.batchDraw() },
      destroy() { stage.off(); stage.destroy() },
    }
  } catch (cause) {
    stage.destroy()
    throw cause
  }
}
