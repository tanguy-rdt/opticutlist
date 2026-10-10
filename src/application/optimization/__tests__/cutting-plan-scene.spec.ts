import { describe, expect, it } from 'vitest'
import { createCuttingPlanScene } from '../cutting-plan-scene'
import { freezeDeep, viewerPanel, viewerPart, viewerPlan, viewerSettings } from '../../../domain/cutting-tree/__tests__/viewer-fixtures'
const input = { panel: viewerPanel, parts: [viewerPart], settings: viewerSettings }
describe('Validated read-only cutting scene', () => {
  it('uses the full panel and exact usable area inside margins', () => {
    const result = createCuttingPlanScene(viewerPlan, input)
    expect(result.status).toBe('valid')
    if (result.status !== 'valid') throw new Error('Invalid fixture')
    expect(result.scene.panel).toEqual({ xMm: 0, yMm: 0, lengthMm: 100, widthMm: 80 })
    expect(result.scene.usableArea).toEqual({ xMm: 5, yMm: 5, lengthMm: 90, widthMm: 70 })
    expect(result.scene.panelGrain).toBe('width')
    expect(result.scene.kerfs).toEqual([
      { xMm: 35, yMm: 5, lengthMm: 2, widthMm: 70 },
      { xMm: 5, yMm: 55, lengthMm: 30, widthMm: 2 },
    ])
    expect(result.scene.waste).toEqual([
      { xMm: 5, yMm: 57, lengthMm: 30, widthMm: 18 },
      { xMm: 37, yMm: 5, lengthMm: 58, widthMm: 70 },
    ])
  })
  it('preserves rotated dimensions, thickness, grain axis and copy identity', () => {
    const result = createCuttingPlanScene(viewerPlan, input)
    if (result.status !== 'valid') throw new Error('Invalid fixture')
    expect(result.scene.parts).toMatchObject([{ part: viewerPart, copyIndex: 0, orientation: 'rotated', grain: 'width', region: { xMm: 5, yMm: 5, lengthMm: 30, widthMm: 50 }, dimensions: { lengthMm: 30, widthMm: 50, thicknessMm: 18 } }])
  })
  it('projects only the validated tree even if redundant placements were changed', () => {
    const result = createCuttingPlanScene({ ...viewerPlan, placements: [] }, input)
    expect(result.status === 'valid' && result.scene.parts).toHaveLength(1)
  })
  it('does not modify frozen plans or inputs and is deterministic', () => {
    const plan = structuredClone(viewerPlan)
    const inputs = structuredClone(input)
    const before = structuredClone({ plan, inputs })
    freezeDeep(plan); freezeDeep(inputs)
    expect(createCuttingPlanScene(plan, inputs)).toEqual(createCuttingPlanScene(plan, inputs))
    expect({ plan, inputs }).toEqual(before)
  })
  it('rejects incorrect regions and incompatible thickness independently', () => {
    expect(createCuttingPlanScene({ ...viewerPlan, tree: { ...viewerPlan.tree, region: { xMm: 6, yMm: 5, lengthMm: 90, widthMm: 70 } } }, input)).toMatchObject({ status: 'invalid' })
    expect(createCuttingPlanScene(viewerPlan, { ...input, panel: { ...viewerPanel, thicknessMm: 19 } })).toMatchObject({ status: 'invalid' })
  })
  it('rejects malformed structures, cycles and invalid contexts gracefully', () => {
    const malformed = structuredClone(viewerPlan)
    Object.defineProperty(malformed, 'tree', { value: { kind: 'unexpected' } })
    expect(createCuttingPlanScene(malformed, input)).toMatchObject({ status: 'invalid' })
    const cyclic = structuredClone(viewerPlan)
    Object.assign(cyclic.tree, { first: cyclic.tree })
    expect(createCuttingPlanScene(cyclic, input)).toMatchObject({ status: 'invalid' })
    expect(createCuttingPlanScene(viewerPlan, { ...input, parts: [viewerPart, viewerPart] })).toMatchObject({ status: 'invalid' })
  })
  it('handles unavailable and valid waste-only plans without inventing placements', () => {
    expect(createCuttingPlanScene(null, input)).toEqual({ status: 'unavailable' })
    const waste = { ...viewerPlan, tree: { kind: 'waste' as const, region: { xMm: 5, yMm: 5, lengthMm: 90, widthMm: 70 } } }
    expect(createCuttingPlanScene(waste, input)).toMatchObject({ status: 'valid', scene: { parts: [], kerfs: [], waste: [{ xMm: 5, yMm: 5, lengthMm: 90, widthMm: 70 }] } })
  })
})
