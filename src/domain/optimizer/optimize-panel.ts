import type { CuttingTreeNode } from '../cutting-tree/cutting-tree'
import { getUsableArea } from '../geometry/rect'
import {
  areaUm2,
  PLACEMENT_STRATEGIES,
  planWithStrategy,
  type AreaMetrics,
  type OptimizePanelError,
  type OptimizePanelInput,
  type PanelCuttingPlan,
  type PlacementStrategy,
} from './plan-with-strategy'

/** Metrics used to compare candidate plans; areas in mm². */
export interface CandidateMetrics extends AreaMetrics {
  readonly placedCount: number
  readonly unplacedCount: number
  /** Largest single waste region: a bigger offcut is more reusable. */
  readonly largestWasteRegionMm2: number
}

export type StrategyCandidate =
  | { readonly strategy: PlacementStrategy; readonly status: 'valid'; readonly metrics: CandidateMetrics }
  /** The independent validator rejected the strategy's tree; it is never selected. */
  | { readonly strategy: PlacementStrategy; readonly status: 'rejected'; readonly error: OptimizePanelError }

export type OptimizePanelSelection =
  | {
      readonly ok: true
      readonly strategy: PlacementStrategy
      readonly plan: PanelCuttingPlan
      /** Every strategy, in `PLACEMENT_STRATEGIES` order. */
      readonly comparison: readonly StrategyCandidate[]
    }
  | { readonly ok: false; readonly error: { readonly kind: 'noUsableArea' } }
  | { readonly ok: false; readonly error: { readonly kind: 'noValidCandidate'; readonly comparison: readonly StrategyCandidate[] } }

interface RankedCandidate {
  readonly strategy: PlacementStrategy
  readonly plan: PanelCuttingPlan
  readonly unplacedCount: number
  readonly usedUm2: number
  readonly largestWasteUm2: number
}


function largestWasteUm2(node: CuttingTreeNode): number {
  switch (node.kind) {
    case 'waste':
      return areaUm2(node.region.lengthMm, node.region.widthMm)
    case 'part':
      return 0
    case 'cut':
      return Math.max(largestWasteUm2(node.first), largestWasteUm2(node.second))
  }
}

/**
 * Ranking, best first: fewer unplaced copies, then more used area (less waste on the same panel),
 * then a larger single waste region, then `PLACEMENT_STRATEGIES` order. Compared in integer units.
 */
function compareCandidates(a: RankedCandidate, b: RankedCandidate): number {
  return (
    a.unplacedCount - b.unplacedCount ||
    b.usedUm2 - a.usedUm2 ||
    b.largestWasteUm2 - a.largestWasteUm2 ||
    PLACEMENT_STRATEGIES.indexOf(a.strategy) - PLACEMENT_STRATEGIES.indexOf(b.strategy)
  )
}

/**
 * Runs every placement strategy on one panel and selects the best validated plan.
 * Each candidate is checked by the independent validator inside `planWithStrategy`; rejected candidates
 * are listed in the comparison but never selected.
 */
export function optimizePanel(input: OptimizePanelInput): OptimizePanelSelection {
  if (getUsableArea(input.panel, input.settings) === null) {
    return { ok: false, error: { kind: 'noUsableArea' } }
  }

  const comparison: StrategyCandidate[] = []
  const ranked: RankedCandidate[] = []

  for (const strategy of PLACEMENT_STRATEGIES) {
    const result = planWithStrategy(input, strategy)
    if (!result.ok) {
      comparison.push({ strategy, status: 'rejected', error: result.error })
      continue
    }

    const { plan } = result
    const unplacedCount = plan.unplaced.reduce((sum, unplaced) => sum + unplaced.count, 0)
    const usedUm2 = plan.placements.reduce((sum, placed) => sum + areaUm2(placed.region.lengthMm, placed.region.widthMm), 0)
    const wasteUm2 = largestWasteUm2(plan.tree)

    ranked.push({ strategy, plan, unplacedCount, usedUm2, largestWasteUm2: wasteUm2 })
    comparison.push({
      strategy,
      status: 'valid',
      metrics: {
        ...plan.metrics,
        placedCount: plan.placements.length,
        unplacedCount,
        largestWasteRegionMm2: wasteUm2 / 1_000_000,
      },
    })
  }

  const [best] = [...ranked].sort(compareCandidates)
  if (best === undefined) {
    return { ok: false, error: { kind: 'noValidCandidate', comparison } }
  }
  return { ok: true, strategy: best.strategy, plan: best.plan, comparison }
}
