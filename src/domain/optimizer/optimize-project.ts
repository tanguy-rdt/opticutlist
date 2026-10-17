import { panelQuantitySchema } from '../model/cutting-project'
import { cuttingSettingsSchema } from '../model/cutting-settings'
import { partSchema } from '../model/part'
import { optimizationPanelSchema } from './panel-source'
import { isCompatible } from '../compatibility'
import type { CuttingTreeNode } from '../cutting-tree/cutting-tree'
import type { PartId } from '../model/ids'
import { optimizePanel } from './optimize-panel'
import { areaUm2, type UnplacedParts } from './plan-with-strategy'
import type {
  AllocatedPanel,
  OptimizeProjectInput,
  OptimizeProjectResult,
  ProjectCuttingPlan,
  ProjectUnplacedParts,
} from './project-plan'
import { validateProjectPlan } from './validate-project-plan'

/** Preserve original copy identities while the reusable engine sees only remaining quantities. */
function remapTree(node: CuttingTreeNode, offsets: ReadonlyMap<PartId, number>): CuttingTreeNode {
  if (node.kind === 'cut') {
    return { ...node, first: remapTree(node.first, offsets), second: remapTree(node.second, offsets) }
  }
  return node.kind === 'part' ? { ...node, copyIndex: node.copyIndex + (offsets.get(node.partId) ?? 0) } : node
}

function comparePlans(a: ProjectCuttingPlan, b: ProjectCuttingPlan): number {
  return (
    b.metrics.placedCount - a.metrics.placedCount
    || a.panels.length - b.panels.length
    || Math.round(a.metrics.wasteAreaMm2 * 1_000_000) - Math.round(b.metrics.wasteAreaMm2 * 1_000_000)
  )
}

/** Deterministic greedy schedules, compared globally; no claim of an exhaustive/optimal search. */
export function optimizeProject(input: OptimizeProjectInput): OptimizeProjectResult {
  const fail = (kind: 'invalidInput' | 'invalidPlan', message: string): OptimizeProjectResult => ({
    ok: false,
    error: { kind, message, issues: [] },
  })

  if (
    !cuttingSettingsSchema.safeParse(input.settings).success
    || input.parts.some(part => !partSchema.safeParse(part).success)
    || input.panels.some(panel =>
      !optimizationPanelSchema.safeParse(panel.product).success
      || !panelQuantitySchema.safeParse(panel.quantity).success)
  ) {
    return fail('invalidInput', 'Invalid optimization inputs')
  }
  if (
    new Set(input.parts.map(part => part.id)).size !== input.parts.length
    || new Set(input.panels.map(panel => panel.product.id)).size !== input.panels.length
    || !Number.isSafeInteger(input.parts.reduce((total, part) => total + part.quantity, 0))
  ) {
    return fail('invalidInput', 'Duplicate references or unsupported total quantity')
  }

  try {
    function schedule(firstReference: number | null, preferSmall: boolean, preferStock = false): ProjectCuttingPlan {
      const offsets = new Map<PartId, number>(input.parts.map(part => [part.id, 0]))
      const usage = input.panels.map(() => 0)
      const panels: AllocatedPanel[] = []
      let panelAreaUm2 = 0
      let usedAreaUm2 = 0

      while (input.parts.some(part => (offsets.get(part.id) ?? 0) < part.quantity)) {
        const remaining = input.parts
          .map(part => ({ ...part, quantity: part.quantity - (offsets.get(part.id) ?? 0) }))
          .filter(part => part.quantity > 0)
        if (remaining.length === 0) {
          break
        }
        const candidates = input.panels.flatMap((source, index) => {
          if ((usage[index] ?? 0) >= source.quantity || source.product.availability === 'unavailable') {
            return []
          }
          const selection = optimizePanel({ panel: source.product, parts: remaining, settings: input.settings })
          if (!selection.ok || selection.plan.placements.length === 0) {
            return []
          }
          return [{
            index,
            selection,
            area: areaUm2(source.product.lengthMm, source.product.widthMm),
            used: selection.plan.placements.reduce((sum, part) => sum + areaUm2(part.region.lengthMm, part.region.widthMm), 0)
          }]
        })

        candidates.sort((a, b) => {
          if (a.index === b.index) {
            return 0
          }
          if (panels.length === 0 && firstReference !== null && (a.index === firstReference || b.index === firstReference)) {
            return a.index === firstReference ? -1 : 1
          }
          if (preferStock) {
            const aSource = input.panels[a.index]?.product
            const aOwned = aSource !== undefined && 'stockItemId' in aSource
            const bSource = input.panels[b.index]?.product
            const bOwned = bSource !== undefined && 'stockItemId' in bSource
            if (aOwned !== bOwned) {
              return aOwned ? -1 : 1
            }
          }
          return (
            (preferSmall ? a.area - b.area : b.selection.plan.placements.length - a.selection.plan.placements.length)
            || (a.area - a.used) - (b.area - b.used)
            || a.index - b.index
          )
        })

        const chosen = candidates[0]
        if (chosen === undefined) {
          break
        }
        const source = input.panels[chosen.index]
        if (source === undefined) {
          break
        }

        const tree = remapTree(chosen.selection.plan.tree, offsets)
        const placements = chosen.selection.plan.placements.map(part => ({
          ...part,
          copyIndex: part.copyIndex + (offsets.get(part.partId) ?? 0),
        }))
        panels.push({
          supplierProductId: source.product.id,
          panelCopyIndex: usage[chosen.index] ?? 0,
          strategy: chosen.selection.strategy,
          plan: {
            ...chosen.selection.plan,
            tree,
            placements,
            unplaced: chosen.selection.plan.unplaced.map(missing => ({
              ...missing,
              firstCopyIndex: missing.firstCopyIndex + (offsets.get(missing.partId) ?? 0),
            }))
          }
        })
        usage[chosen.index] = (usage[chosen.index] ?? 0) + 1
        for (const placed of placements) {
          offsets.set(placed.partId, (offsets.get(placed.partId) ?? 0) + 1)
        }
        panelAreaUm2 += chosen.area
        usedAreaUm2 += chosen.used
      }

      const unplaced: ProjectUnplacedParts[] = input.parts.flatMap(part => {
        const firstCopyIndex = offsets.get(part.id) ?? 0
        if (firstCopyIndex === part.quantity) {
          return []
        }
        const compatible = input.panels.filter(source => isCompatible(part, source.product))
        const fits = compatible.some(source => {
          const result = optimizePanel({ panel: source.product, parts: [{ ...part, quantity: 1 }], settings: input.settings })
          return result.ok && result.plan.placements.length === 1
        })
        let reason: ProjectUnplacedParts['reason']
        if (compatible.length === 0) {
          reason = 'noCompatiblePanel'
        } else if (fits) {
          reason = 'panelLimitReached'
        } else {
          reason = 'constraintsPreventPlacement'
        }
        return [{
          partId: part.id,
          firstCopyIndex,
          count: part.quantity - firstCopyIndex,
          reason
        }]
      })

      // Per-panel PDFs remain truthful about copies produced elsewhere, while global unplaced demand is separate.
      const completed = panels.map(panel => {
        const missing: UnplacedParts[] = []
        for (const part of input.parts) {
          const indices = panel.plan.placements
            .filter(placed => placed.partId === part.id)
            .map(placed => placed.copyIndex)
            .sort((a, b) => a - b)
          const placedEnd = offsets.get(part.id) ?? 0
          let cursor = 0
          for (const end of [...indices, part.quantity]) {
            if (end > cursor) {
              if (cursor < placedEnd) {
                missing.push({
                  partId: part.id,
                  firstCopyIndex: cursor,
                  count: Math.min(end, placedEnd) - cursor,
                  reason: { kind: 'allocatedElsewhere' },
                })
              }
              if (end > placedEnd) {
                missing.push({
                  partId: part.id,
                  firstCopyIndex: Math.max(cursor, placedEnd),
                  count: end - Math.max(cursor, placedEnd),
                  reason: panel.plan.unplaced.find(missing => missing.partId === part.id)?.reason ?? { kind: 'noSpaceLeft' }
                })
              }
            }
            cursor = end + 1
          }
        }
        return { ...panel, plan: { ...panel.plan, unplaced: missing } }
      })

      const placedCount = panels.reduce((sum, panel) => sum + panel.plan.placements.length, 0)
      const unplacedCount = unplaced.reduce((sum, part) => sum + part.count, 0)
      return {
        panels: completed,
        unplaced,
        metrics: {
          panelAreaMm2: panelAreaUm2 / 1_000_000,
          usedAreaMm2: usedAreaUm2 / 1_000_000,
          wasteAreaMm2: (panelAreaUm2 - usedAreaUm2) / 1_000_000,
          utilizationPercent: panelAreaUm2 === 0 ? 0 : usedAreaUm2 / panelAreaUm2 * 100,
          placedCount,
          unplacedCount,
          panelCount: panels.length
        }
      }
    }

    const stockIds = new Set(input.panels.filter(source => 'stockItemId' in source.product).map(source => source.product.id))
    const preferStock = input.settings.preferStockPanels !== false && stockIds.size > 0
    const candidates = [
      schedule(null, false),
      schedule(null, true),
      ...input.panels.map((_, index) => schedule(index, false)),
    ]
    // Reuse the same validated scheduler with Stock-aware continuation after each first-source seed.
    // This keeps the existing finite search shape (linear schedules in source count), rather than
    // merely reranking utilization-first results or committing to one greedy Stock-first plan.
    if (preferStock) {
      candidates.push(
        schedule(null, false, true),
        schedule(null, true, true),
        ...input.panels.map((_, index) => schedule(index, false, true)),
      )
    }

    const catalogCount = (plan: ProjectCuttingPlan): number =>
      plan.panels.filter(panel => !stockIds.has(panel.supplierProductId)).length
    candidates.sort((a, b) =>
      // Never prefer an incomplete solution over one producing more requested copies.
      b.metrics.placedCount - a.metrics.placedCount
      || (preferStock ? catalogCount(a) - catalogCount(b) : 0)
      || comparePlans(a, b))

    const best = candidates[0]
    if (best === undefined) {
      return fail('invalidPlan', 'No candidate schedule')
    }
    const validation = validateProjectPlan(best, input)
    if (!validation.valid) {
      return {
        ok: false,
        error: {
          kind: 'invalidPlan',
          message: 'Independent project-plan validation failed',
          issues: validation.issues,
        },
      }
    }
    return { ok: true, plan: best }
  } catch (cause) {
    return fail('invalidInput', cause instanceof Error ? cause.message : 'Optimization inputs exceed supported geometry')
  }
}
