import { describe, expect, it } from 'vitest'
import { createCuttingPlanScene } from '../../../../application/optimization/cutting-plan-scene'
import { viewerPanel, viewerPart, viewerPlan, viewerSettings } from '../../../../domain/cutting-tree/__tests__/viewer-fixtures'
import { dimensionAnnotations, fitDimensionedViewport } from '@/ui/canvas/dimensions'
function scene() {
  const result = createCuttingPlanScene(viewerPlan, { panel: viewerPanel, parts: [viewerPart], settings: viewerSettings })
  if (result.status !== 'valid') throw new Error('Invalid fixture')
  return result.scene
}
describe('Technical dimensions from validated geometry', () => {
  it('always shows exterior overall length and width without thickness', () => {
    expect(dimensionAnnotations(scene(), { x: 100, y: 90, scale: 2 }, '', false)).toEqual([
      { id: 'panel-length', axis: 'horizontal', start: 100, end: 300, edge: 90, lane: 60, label: '100 mm' },
      { id: 'panel-width', axis: 'vertical', start: 90, end: 250, edge: 100, lane: 70, label: '80 mm' },
    ])
  })
  it.each([0.5, 2, 8])('uses oriented dimensions and exact margin-aware datum positions at zoom %s', scale => {
    const data = scene()
    const original = structuredClone(data)
    const annotations = dimensionAnnotations(data, { x: 100, y: 90, scale }, JSON.stringify([viewerPart.id, 0]), true)
    expect(annotations).toHaveLength(6)
    expect(annotations.find(item => item.id === 'part-length')).toMatchObject({ start: 100 + 5 * scale, end: 100 + 35 * scale, label: '30 mm' })
    expect(annotations.find(item => item.id === 'part-width')).toMatchObject({ start: 90 + 5 * scale, end: 90 + 55 * scale, label: '50 mm' })
    expect(annotations.find(item => item.id === 'position-x')).toMatchObject({ start: 100, end: 100 + 5 * scale, label: 'X 5 mm' })
    expect(annotations.find(item => item.id === 'position-y')).toMatchObject({ start: 90, end: 90 + 5 * scale, label: 'Y 5 mm' })
    // Kerf begins at x=35, not at the following waste edge x=37.
    expect(data.kerfs[0]).toMatchObject({ xMm: 35, lengthMm: 2 })
    expect(data).toEqual(original)
    expect(dimensionAnnotations(data, { x: 0, y: 0, scale }, '', true)).toHaveLength(2)
    expect(dimensionAnnotations(data, { x: 0, y: 0, scale }, JSON.stringify([viewerPart.id, 0]), false)).toHaveLength(2)
  })
  it.each([
    [{ xMm: 0, yMm: 0, lengthMm: 100, widthMm: 80 }, { width: 900, height: 500 }, { x: 243.25, y: 90, scale: 4.375 }],
    [{ xMm: 0, yMm: 0, lengthMm: 10000, widthMm: 10 }, { width: 1168, height: 400 }, { x: 96, y: 214.5, scale: 0.1 }],
    [{ xMm: 0, yMm: 0, lengthMm: 10, widthMm: 10000 }, { width: 400, height: 1150 }, { x: 211.5, y: 90, scale: 0.1 }],
    [{ xMm: 0, yMm: 0, lengthMm: 1, widthMm: 1 }, { width: 320, height: 240 }, { x: 127, y: 90, scale: 90 }],
  ])('fits and centers the full reserved annotation envelope for %j', (panel, size, expected) => {
    expect(fitDimensionedViewport(panel, size)).toEqual(expected)
  })
})
