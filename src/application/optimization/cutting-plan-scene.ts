import type { CuttingTreeNode } from '../../domain/cutting-tree/cutting-tree'
import { validateCuttingTree } from '../../domain/cutting-tree/validate-cutting-tree'
import { getKerfRegion } from '../../domain/geometry/kerf-region'
import { getOrientedDimensions, grainInPanelAxes, type Orientation } from '../../domain/geometry/part-orientation'
import { getUsableArea, type Rect } from '../../domain/geometry/rect'
import type { Dimensions3D } from '../../domain/model/dimensions'
import type { GrainDirection } from '../../domain/model/orientation'
import type { Part } from '../../domain/model/part'
import type { OptimizePanelInput, PanelCuttingPlan } from '../../domain/optimizer/plan-with-strategy'
import { hasTreeStructure } from './optimization-protocol'

export interface ScenePart {
  readonly key: string
  readonly part: Part
  readonly copyIndex: number
  readonly orientation: Orientation
  readonly region: Rect
  readonly dimensions: Dimensions3D
  readonly grain: GrainDirection
}
export interface CuttingPlanScene {
  readonly panel: Rect
  readonly usableArea: Rect
  readonly panelGrain: GrainDirection
  readonly parts: readonly ScenePart[]
  readonly waste: readonly Rect[]
  readonly kerfs: readonly Rect[]
}
export type CuttingPlanSceneResult =
  | { readonly status: 'unavailable' }
  | { readonly status: 'invalid'; readonly message: string }
  | { readonly status: 'valid'; readonly scene: CuttingPlanScene }

/** Read-only projection from the independently validated tree, never the redundant placements array. */
export function createCuttingPlanScene(plan: PanelCuttingPlan | null, input: Omit<OptimizePanelInput, 'parts'> & { readonly parts: readonly Part[] }): CuttingPlanSceneResult {
  if (plan === null) return { status: 'unavailable' }
  if (!hasTreeStructure(plan.tree)) return { status: 'invalid', message: 'The cutting tree structure is invalid.' }
  try {
    const validation = validateCuttingTree(plan.tree, input)
    if (!validation.valid) return { status: 'invalid', message: `Independent validation failed: ${validation.issues.map(issue => issue.kind).join(', ')}.` }
    const usableArea = getUsableArea(input.panel, input.settings)
    if (usableArea === null) return { status: 'invalid', message: 'No usable panel area.' }
    const parts: ScenePart[] = []
    const waste: Rect[] = []
    const kerfs: Rect[] = []
    const byId = new Map(input.parts.map(part => [part.id, part]))
    const pending: CuttingTreeNode[] = [plan.tree]
    while (pending.length > 0) {
      const node = pending.pop()
      if (node === undefined) break
      switch (node.kind) {
        case 'cut':
          kerfs.push(getKerfRegion(node.region, node.cut, input.settings))
          pending.push(node.second, node.first)
          break
        case 'waste': waste.push({ ...node.region }); break
        case 'part': {
          const part = byId.get(node.partId)
          if (part === undefined) return { status: 'invalid', message: 'A placed part is unavailable.' }
          parts.push({
            key: JSON.stringify([part.id, node.copyIndex]),
            part,
            copyIndex: node.copyIndex,
            orientation: node.orientation,
            region: { ...node.region },
            dimensions: getOrientedDimensions(part, node.orientation),
            grain: grainInPanelAxes(part.grainDirection, node.orientation)
          })
          break
        }
      }
    }
    return {
      status: 'valid',
      scene: {
        panel: { xMm: 0, yMm: 0, lengthMm: input.panel.lengthMm, widthMm: input.panel.widthMm },
        usableArea,
        panelGrain: input.panel.grainDirection,
        parts,
        waste,
        kerfs
      }
    }
  } catch (cause) {
    return { status: 'invalid', message: cause instanceof Error ? cause.message : 'The cutting plan could not be validated.' }
  }
}
