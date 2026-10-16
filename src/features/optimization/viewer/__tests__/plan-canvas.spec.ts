import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCuttingPlanScene } from '../../../../application/optimization/cutting-plan-scene'
import { viewerPanel, viewerPart, viewerPlan, viewerSettings } from '../../../../domain/cutting-tree/__tests__/viewer-fixtures'
import { swapInput, swapPlan } from '../../../../domain/cutting-tree/__tests__/editing-fixtures'
import { createPlanCanvas, type PlanPalette } from '../plan-canvas'

// jsdom has no canvas backend: test Konva node attributes and events, not browser rasterization.
const fake = vi.hoisted(() => {
  const nodes: FakeNode[] = []
  class FakeNode {
    readonly attrs: Record<string, unknown>
    readonly children: FakeNode[] = []
    readonly events = new Map<string, () => void>()
    destroyed = false
    draws = 0
    constructor(readonly kind: string, attrs: Record<string, unknown> = {}) { this.attrs = { ...attrs }; nodes.push(this) }
    setAttrs(attrs: Record<string, unknown>): void { Object.assign(this.attrs, attrs) }
    add(...children: FakeNode[]): void { this.children.push(...children) }
    fill(value: string): void { this.attrs.fill = value }
    stroke(value: string): void { this.attrs.stroke = value }
    strokeWidth(value: number): void { this.attrs.strokeWidth = value }
    opacity(value: number): void { this.attrs.opacity = value }
    pointerLength(value: number): void { this.attrs.pointerLength = value }
    pointerWidth(value: number): void { this.attrs.pointerWidth = value }
    position(value: { x: number; y: number }): void { this.setAttrs(value) }
    scale(value: { x: number; y: number }): void { this.attrs.scale = value.x }
    size(value: { width: number; height: number }): void { this.setAttrs(value) }
    x(): number { return typeof this.attrs.x === 'number' ? this.attrs.x : 0 }
    y(): number { return typeof this.attrs.y === 'number' ? this.attrs.y : 0 }
    scaleX(): number { return typeof this.attrs.scale === 'number' ? this.attrs.scale : 1 }
    on(name: string, handler: () => void): void { this.events.set(name, handler) }
    off(): void { this.events.clear() }
    destroy(): void { this.destroyed = true; this.events.clear(); this.children.forEach(child => { child.destroy() }) }
    batchDraw(): void { this.draws += 1 }
  }
  class Stage extends FakeNode { constructor(attrs: Record<string, unknown>) { super('Stage', attrs) } }
  class Layer extends FakeNode { constructor() { super('Layer') } }
  class Rect extends FakeNode { constructor(attrs: Record<string, unknown>) { super('Rect', attrs) } }
  class Text extends FakeNode { constructor(attrs: Record<string, unknown>) { super('Text', attrs) } }
  class Group extends FakeNode { constructor(attrs: Record<string, unknown>) { super('Group', attrs) } }
  class Shape extends FakeNode { constructor(attrs: Record<string, unknown>) { super('Shape', attrs) } }
  class Line extends FakeNode { constructor(attrs: Record<string, unknown>) { super('Line', attrs) } }
  class Arrow extends FakeNode { constructor(attrs: Record<string, unknown>) { super('Arrow', attrs) } }
  return { nodes, Stage, Layer, Rect, Text, Arrow, Shape, Line, Group }
})
vi.mock('konva', () => ({ default: { Stage: fake.Stage, Layer: fake.Layer, Rect: fake.Rect, Text: fake.Text, Arrow: fake.Arrow, Shape: fake.Shape, Line: fake.Line, Group: fake.Group } }))
beforeEach(() => { fake.nodes.length = 0 })
afterEach(() => { vi.unstubAllGlobals() })
const palette: PlanPalette = { surface: 'surface', margin: 'margin', ink: 'ink', muted: 'muted', part: 'part', partBorder: 'part-border', selected: 'selected', kerf: 'kerf' }
function setup() {
  const result = createCuttingPlanScene(viewerPlan, { panel: viewerPanel, parts: [viewerPart], settings: viewerSettings })
  if (result.status !== 'valid') throw new Error('Invalid fixture')
  const selected = vi.fn<(key: string) => void>()
  const panned = vi.fn()
  const canvas = createPlanCanvas(document.createElement('div'), result.scene, { width: 640, height: 400 }, palette, selected, panned)
  const part = fake.nodes.find(node => node.kind === 'Rect' && node.attrs.draggable === false)
  const stage = fake.nodes.find(node => node.kind === 'Stage')
  const layer = fake.nodes.find(node => node.kind === 'Layer')
  if (part === undefined || stage === undefined || layer === undefined) throw new Error('Missing canvas nodes')
  return { canvas, scene: result.scene, selected, panned, part, stage, layer }
}
describe('Konva read-only canvas adapter', () => {
  it('renders solid regions without creating images or changing the validated scene', () => {
    const createImage = vi.fn()
    vi.stubGlobal('Image', createImage)
    const { canvas, scene, part } = setup()
    const original = structuredClone(scene)
    expect(createImage).not.toHaveBeenCalled()
    expect(fake.nodes.every(node => node.attrs.fillPatternImage === undefined)).toBe(true)
    expect(part.attrs.fill).toBe('part')
    canvas.setPalette({ ...palette, part: 'warm-part', margin: 'warm-waste', kerf: 'subtle-kerf' })
    expect(part.attrs.fill).toBe('warm-part')
    expect(scene).toEqual(original)
    canvas.destroy()
  })
  it('draws correct panel, usable area, waste, kerf and rotated part rectangles', () => {
    const { canvas, part, stage } = setup()
    expect(stage.attrs.draggable).toBe(true)
    expect(part.attrs).toMatchObject({ x: 5, y: 5, width: 30, height: 50, draggable: false, fill: 'part' })
    const rectangles = fake.nodes.filter(node => node.kind === 'Rect').map(node => node.attrs)
    expect(rectangles).toContainEqual(expect.objectContaining({ x: 0, y: 0, width: 100, height: 80, fill: 'margin' }))
    expect(rectangles).toContainEqual(expect.objectContaining({ x: 5, y: 5, width: 90, height: 70, fill: 'surface' }))
    expect(rectangles).toContainEqual(expect.objectContaining({ x: 35, y: 5, width: 2, height: 70, fill: 'kerf' }))
    expect(rectangles).toContainEqual(expect.objectContaining({ x: 5, y: 55, width: 30, height: 2, fill: 'kerf' }))
    expect(rectangles).toContainEqual(expect.objectContaining({ x: 37, y: 5, width: 58, height: 70, fill: 'margin' }))
    expect(fake.nodes.find(node => node.kind === 'Text')?.attrs.text).toBe('Shelf\n30 × 50 × 18 mm')
    canvas.setViewport({ x: 0, y: 0, scale: 2 })
    expect(fake.nodes.find(node => node.attrs.name === 'part-grain')?.attrs.points).toEqual([29, 39, 29, 49])
    canvas.destroy()
  })
  it('labels repeated demand with the stable copy identity and total quantity', () => {
    const part = { ...viewerPart, quantity: 2 }
    const scene = createCuttingPlanScene(viewerPlan, { panel: viewerPanel, parts: [part], settings: viewerSettings })
    if (scene.status !== 'valid') throw new Error('Invalid repeated-copy fixture')
    const canvas = createPlanCanvas(document.createElement('div'), scene.scene, { width: 640, height: 400 }, palette, vi.fn(), vi.fn())
    expect(fake.nodes.find(node => node.kind === 'Text')?.attrs.text).toBe('Shelf · 1/2\n30 × 50 × 18 mm')
    expect(part.name).toBe('Shelf')
    canvas.destroy()
  })
  it('clips vector hatching to each exact waste leaf and leaves placed parts solid', () => {
    const { canvas } = setup()
    const clips = fake.nodes.filter(node => node.kind === 'Group').map(node => node.attrs)
    expect(clips).toEqual([
      expect.objectContaining({ name: 'waste-hatching', clipX: 5, clipY: 57, clipWidth: 30, clipHeight: 18, listening: false }),
      expect.objectContaining({ name: 'waste-hatching', clipX: 37, clipY: 5, clipWidth: 58, clipHeight: 70, listening: false }),
    ])
    expect(fake.nodes.filter(node => node.kind === 'Shape')).toHaveLength(2)
    canvas.destroy()
  })
  it('keeps nonzero kerf bands at exact physical width and zero kerf as a screen separator', () => {
    const { canvas } = setup()
    canvas.setViewport({ x: 0, y: 0, scale: 4 })
    expect(fake.nodes.filter(node => node.attrs.name === 'saw-kerf').map(node => node.attrs)).toEqual([
      expect.objectContaining({ x: 35, y: 5, width: 2, height: 70, strokeWidth: 0 }),
      expect.objectContaining({ x: 5, y: 55, width: 30, height: 2, strokeWidth: 0 }),
    ])
    canvas.destroy(); fake.nodes.length = 0
    const scene = createCuttingPlanScene(swapPlan, swapInput)
    if (scene.status !== 'valid') throw new Error('Invalid zero-kerf fixture')
    const zero = createPlanCanvas(document.createElement('div'), scene.scene, { width: 640, height: 400 }, palette, vi.fn(), vi.fn())
    expect(fake.nodes.filter(node => node.attrs.name === 'saw-kerf').map(node => node.attrs)).toEqual([
      expect.objectContaining({ x: 35, y: 5, width: 0, height: 50, strokeWidth: 0.75, strokeScaleEnabled: false }),
      expect.objectContaining({ x: 35, y: 35, width: 50, height: 0, strokeWidth: 0.75, strokeScaleEnabled: false }),
    ])
    expect(fake.nodes.some(node => node.kind === 'Arrow')).toBe(false)
    zero.destroy()
  })
  it.each([0.5, 2, 4])('scales red physical cuts at zoom %s without recoloring piece borders', scale => {
    const { canvas, stage, part } = setup()
    canvas.setPalette({ ...palette, kerf: '#9b3430' })
    canvas.setViewport({ x: 24, y: 24, scale })
    expect(stage.attrs.scale).toBe(scale)
    const cuts = fake.nodes.filter(node => node.attrs.name === 'saw-kerf')
    expect(cuts.map(node => node.attrs)).toEqual([
      expect.objectContaining({ x: 35, y: 5, width: 2, height: 70, fill: '#9b3430', strokeWidth: 0 }),
      expect.objectContaining({ x: 5, y: 55, width: 30, height: 2, fill: '#9b3430', strokeWidth: 0 }),
    ])
    expect(part.attrs.stroke).toBe('part-border')
    canvas.destroy()
  })
  it('keeps grain markings small, follows rotated grain and hides them at low zoom', () => {
    const { canvas } = setup()
    canvas.setViewport({ x: 0, y: 0, scale: 2 })
    expect(fake.nodes.filter(node => node.attrs.name === 'grain-line')).toHaveLength(3)
    expect(fake.nodes.find(node => node.attrs.name === 'part-grain')?.attrs).toMatchObject({ points: [29, 39, 29, 49], pointerLength: 1.5, visible: true })
    canvas.setViewport({ x: 0, y: 0, scale: 0.5 })
    expect(fake.nodes.filter(node => node.attrs.name === 'grain-line' || node.attrs.name === 'part-grain').every(node => node.attrs.visible === false)).toBe(true)
    canvas.destroy()
  })
  it('changes only highlight attributes on selection and avoids repeated redraws', () => {
    const { canvas, scene, part, selected, layer } = setup()
    const key = scene.parts[0]?.key
    if (key === undefined) throw new Error('Missing part')
    const position = { x: part.attrs.x, y: part.attrs.y, width: part.attrs.width, height: part.attrs.height }
    part.events.get('click tap')?.()
    expect(selected).toHaveBeenCalledWith(key)
    canvas.setSelection(key)
    expect(part.attrs.stroke).toBe('selected')
    expect(part.attrs.strokeWidth).toBe(2)
    const draws = layer.draws
    canvas.setSelection(key)
    expect(layer.draws).toBe(draws)
    expect(part.attrs).toMatchObject(position)
    canvas.setSelection('')
    expect(part.attrs.strokeWidth).toBe(1)
    canvas.destroy()
  })
  it('changes the stage transform for zoom/pan while preserving placement coordinates and readable labels', () => {
    const { canvas, stage, part, panned } = setup()
    canvas.setViewport({ scale: 4, x: 10, y: 20 })
    expect(stage.attrs).toMatchObject({ scale: 4, x: 10, y: 20 })
    expect(part.attrs).toMatchObject({ x: 5, y: 5, width: 30, height: 50 })
    expect(fake.nodes.find(node => node.kind === 'Text')?.attrs).toMatchObject({ fontSize: 3.25, visible: true })
    stage.position({ x: 40, y: 50 }); stage.events.get('dragend')?.()
    expect(panned).toHaveBeenCalledWith({ scale: 4, x: 40, y: 50 })
    canvas.setViewport({ scale: 1, x: 0, y: 0 })
    expect(fake.nodes.find(node => node.kind === 'Text')?.attrs.visible).toBe(false)
    canvas.destroy()
  })
  it('recolors without recreating nodes, resizes and destroys every node and listener', () => {
    const { canvas, part, stage } = setup()
    const nodeCount = fake.nodes.length
    canvas.setPalette({ ...palette, part: 'dark-part', kerf: 'dark-kerf' })
    expect(fake.nodes).toHaveLength(nodeCount)
    expect(part.attrs.fill).toBe('dark-part')
    canvas.resize({ width: 900, height: 400 })
    expect(stage.attrs.width).toBe(900)
    canvas.destroy()
    expect(fake.nodes.every(node => node.destroyed && node.events.size === 0)).toBe(true)
  })
})
