import type { CuttingTreeNode } from '../../domain/cutting-tree/cutting-tree'
import { getUsableArea, splitRect, type Rect } from '../../domain/geometry/rect'
import { checkPartFit } from '../../domain/geometry/part-fit'
import type { CompactTree, SavedPlanContents } from '../../domain/model/saved-cutting-plan'
import { computeAreaMetrics, type PanelCuttingPlan, type UnplacedParts } from '../../domain/optimizer/plan-with-strategy'
import type { ProjectCuttingPlan } from '../../domain/optimizer/project-plan'
import { validateProjectPlan, type ProjectPlanContext } from '../../domain/optimizer/validate-project-plan'
import { createCuttingPlanScene } from '../optimization/cutting-plan-scene'

export function compactTree(tree: CuttingTreeNode): CompactTree {
  if (tree.kind === 'cut') return { kind: 'cut', cut: tree.cut, first: compactTree(tree.first), second: compactTree(tree.second) }
  return tree.kind === 'part' ? { kind: 'part', partId: tree.partId, copyIndex: tree.copyIndex, orientation: tree.orientation } : { kind: 'waste' }
}
function expandTree(tree: CompactTree, region: Rect, settings: SavedPlanContents['settings']): CuttingTreeNode {
  if (tree.kind !== 'cut') return { ...tree, region }
  const split = splitRect(region, tree.cut, settings)
  if (split.second === null) throw new Error('The saved cut leaves no executable remainder.')
  return { ...tree, region, first: expandTree(tree.first, split.first, settings), second: expandTree(tree.second, split.second, settings) }
}
export function savedPlanContext(contents: Pick<SavedPlanContents, 'sources' | 'parts' | 'settings'>): ProjectPlanContext {
  return { parts: contents.parts, settings: contents.settings, panels: contents.sources.map(source => ({ product: { ...source.product, availability: 'available' }, quantity: source.quantity })) }
}
/** Reconstruct only derived geometry and summaries, then independently validate every tree and copy. */
export function restoreSavedPlan(contents: SavedPlanContents): ProjectCuttingPlan {
  const context = savedPlanContext(contents)
  const panels = contents.panels.map(panel => {
    const source = contents.sources.find(source => source.product.id === panel.supplierProductId)
    if (source === undefined) throw new Error('A historical panel snapshot is missing.')
    const region = getUsableArea(source.product, contents.settings)
    if (region === null) throw new Error('Saved margins leave no usable panel area.')
    const tree = expandTree(panel.tree, region, contents.settings)
    const emptyMetrics = { panelAreaMm2: 0, usedAreaMm2: 0, wasteAreaMm2: 0, utilizationPercent: 0 }
    const projection = createCuttingPlanScene({ tree, placements: [], unplaced: [], metrics: emptyMetrics }, { panel: source.product, parts: contents.parts, settings: contents.settings })
    if (projection.status !== 'valid') throw new Error(projection.status === 'invalid' ? projection.message : 'The saved tree is unavailable.')
    const placements = projection.scene.parts.map(placed => ({ partId: placed.part.id, copyIndex: placed.copyIndex, orientation: placed.orientation, region: placed.region, dimensions: placed.dimensions }))
    const plan: PanelCuttingPlan = { tree, placements, unplaced: [], metrics: computeAreaMetrics(source.product, placements) }
    return { supplierProductId: panel.supplierProductId, panelCopyIndex: panel.panelCopyIndex, strategy: panel.strategy, plan }
  })
  // Compress global placed identities once. Reconstructing summaries must not expand demand
  // or scan every other tree again for each panel.
  const placedRanges = new Map(contents.parts.map(part => {
    const indices = panels.flatMap(panel => panel.plan.placements.filter(placed => placed.partId === part.id).map(placed => placed.copyIndex)).sort((a, b) => a - b)
    const ranges: Pick<UnplacedParts, 'firstCopyIndex' | 'count'>[] = []
    for (const index of indices) {
      const last = ranges.at(-1)
      if (last !== undefined && last.firstCopyIndex + last.count === index) ranges[ranges.length - 1] = { ...last, count: last.count + 1 }
      else ranges.push({ firstCopyIndex: index, count: 1 })
    }
    return [part.id, ranges] as const
  }))
  // A panel's absent copies are either allocated elsewhere or globally unplaced. Keep ranges compact.
  for (const [panelIndex, panel] of panels.entries()) {
    const source = contents.sources.find(source => source.product.id === panel.supplierProductId)
    if (source === undefined) throw new Error('Missing historical source')
    const missing: UnplacedParts[] = []
    for (const part of contents.parts) {
      const placedHere = panel.plan.placements.filter(placed => placed.partId === part.id).map(placed => placed.copyIndex).sort((a, b) => a - b)
      for (const range of placedRanges.get(part.id) ?? []) {
        let cursor = range.firstCopyIndex
        const end = range.firstCopyIndex + range.count
        for (const index of placedHere.filter(index => index >= cursor && index < end)) {
          if (index > cursor) missing.push({ partId: part.id, firstCopyIndex: cursor, count: index - cursor, reason: { kind: 'allocatedElsewhere' } })
          cursor = index + 1
        }
        if (cursor < end) missing.push({ partId: part.id, firstCopyIndex: cursor, count: end - cursor, reason: { kind: 'allocatedElsewhere' } })
      }
      const fit = checkPartFit(part, source.product, contents.settings)
      const diagnostic = contents.panels[panelIndex]?.unplacedReasons?.find(reason => reason.partId === part.id)
      if (diagnostic?.kind === 'cannotFitPanel' && fit.fits) throw new Error('A saved unplaced diagnostic contradicts its historical dimensions.')
      for (const range of contents.unplaced.filter(range => range.partId === part.id)) missing.push({ partId: part.id, firstCopyIndex: range.firstCopyIndex, count: range.count, reason: !fit.fits ? { kind: 'cannotFitPanel', issues: fit.issues } : { kind: diagnostic?.kind === 'remainderNarrowerThanKerf' ? 'remainderNarrowerThanKerf' : 'noSpaceLeft' } })
    }
    panel.plan = { ...panel.plan, unplaced: missing }
  }
  const plan = { panels, unplaced: contents.unplaced, metrics: contents.metrics }
  const validation = validateProjectPlan(plan, context)
  if (!validation.valid) throw new Error(`Saved plan failed independent validation: ${validation.issues.map(issue => issue.message).join('; ')}`)
  return plan
}
