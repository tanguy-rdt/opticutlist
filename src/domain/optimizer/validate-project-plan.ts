import { validateCuttingTree } from '../cutting-tree/validate-cutting-tree'
import type { CuttingTreeNode } from '../cutting-tree/cutting-tree'
import { getOrientedDimensions } from '../geometry/part-orientation'
import { tryToMicrometres } from '../geometry/units'
import type { PanelSpec } from '../geometry/part-fit'
import type { SupplierProduct } from '../model/supplier-product'
import type { PartId } from '../model/ids'
import { PLACEMENT_STRATEGIES, areaUm2, computeAreaMetrics, type PlacedPart } from './plan-with-strategy'
import type { OptimizeProjectInput, ProjectCuttingPlan, ProjectPlanIssue } from './project-plan'

interface Range { start: number; count: number }

export type ProjectPlanContext = Omit<OptimizeProjectInput, 'panels'> & { readonly panels: readonly { readonly product: PanelSpec & Pick<SupplierProduct, 'id' | 'availability'>; readonly quantity: number }[] }

function complete(ranges: readonly Range[], quantity: number): boolean {
  let cursor = 0
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    if (range.start !== cursor) return false
    cursor += range.count
  }
  return cursor === quantity
}
function samePlacement(a: PlacedPart, b: PlacedPart | undefined): boolean {
  if (b === undefined || a.partId !== b.partId || a.copyIndex !== b.copyIndex || a.orientation !== b.orientation
    || a.dimensions.thicknessMm !== b.dimensions.thicknessMm) return false
  return (['xMm', 'yMm', 'lengthMm', 'widthMm'] as const).every(key => tryToMicrometres(a.region[key], 0) === tryToMicrometres(b.region[key], 0)) &&
    (['lengthMm', 'widthMm'] as const).every(key => tryToMicrometres(a.dimensions[key], 1) === tryToMicrometres(b.dimensions[key], 1))
}

/** Independent cross-panel accounting. Trees are the source of placements, never worker summaries. */
export function validateProjectPlan(plan: ProjectCuttingPlan, input: ProjectPlanContext): { valid: true } | { valid: false; issues: readonly ProjectPlanIssue[] } {
  const issues: ProjectPlanIssue[] = []
  if (new Set(input.parts.map(part => part.id)).size !== input.parts.length
    || new Set(input.panels.map(source => source.product.id)).size !== input.panels.length) issues.push({ kind: 'invalidAccounting', message: 'Optimization input references must be unique' })
  const ranges = new Map<PartId, Range[]>(input.parts.map(part => [part.id, []]))
  const placedCopies = new Map<PartId, number[]>(input.parts.map(part => [part.id, []]))
  const allocated = new Set<string>()
  let panelUm2 = 0
  let usedUm2 = 0
  let placedCount = 0
  let unplacedCount = 0
  try {
    for (const [panelIndex, panel] of plan.panels.entries()) {
      const source = input.panels.find(source => source.product.id === panel.supplierProductId)
      if (source === undefined || source.product.availability === 'unavailable') {
        issues.push({ kind: 'invalidPanel', panelIndex, message: 'Unknown or unavailable panel reference' });
        continue
      }
      if (!PLACEMENT_STRATEGIES.some(strategy => strategy === panel.strategy)) issues.push({ kind: 'invalidPanel', panelIndex, message: 'Unknown placement strategy' })
      const key = JSON.stringify([panel.supplierProductId, panel.panelCopyIndex])
      if (!Number.isSafeInteger(panel.panelCopyIndex) || panel.panelCopyIndex < 0 || panel.panelCopyIndex >= source.quantity || allocated.has(key)) issues.push({ kind: 'panelLimit', panelIndex, message: 'Panel quantity exceeded or panel instance reused' })
      allocated.add(key)
      const validation = validateCuttingTree(panel.plan.tree, { ...input, panel: source.product })
      if (!validation.valid) {
        issues.push({
          kind: 'invalidTree',
          panelIndex,
          message: validation.issues.map(issue => `${issue.path.join('.') || 'root'}: ${issue.kind}`).join(', ')
        });
        continue
      }
      const placements: PlacedPart[] = []
      function visit(node: CuttingTreeNode): void {
        if (node.kind === 'cut') {
          visit(node.first);
          visit(node.second)
        }
        else if (node.kind === 'part') {
          const part = input.parts.find(part => part.id === node.partId)
          if (part === undefined) return // Already rejected by the independent tree validator.
          placements.push({
            partId: node.partId,
            copyIndex: node.copyIndex,
            orientation: node.orientation,
            region: node.region,
            dimensions: getOrientedDimensions(part, node.orientation)
          })
          ranges.get(part.id)?.push({ start: node.copyIndex, count: 1 })
          placedCopies.get(part.id)?.push(node.copyIndex)
          usedUm2 += areaUm2(part.lengthMm, part.widthMm)
        }
      }
      visit(panel.plan.tree)
      if (placements.length === 0) issues.push({ kind: 'emptyPanel', panelIndex, message: 'Empty panels must not be allocated' })
      const metrics = computeAreaMetrics(source.product, placements)
      if (placements.length !== panel.plan.placements.length || !placements.every((placed, index) => samePlacement(placed, panel.plan.placements[index])) ||
        !Object.entries(metrics).every(([key, value]) => Object.entries(panel.plan.metrics).some(([reportedKey, reportedValue]) => key === reportedKey && value === reportedValue))) issues.push({ kind: 'invalidAccounting', panelIndex, message: 'Reported placements or panel metrics disagree with its tree' })
      placedCount += placements.length
      panelUm2 += areaUm2(source.product.lengthMm, source.product.widthMm)
    }
    for (const missing of plan.unplaced) {
      const part = input.parts.find(part => part.id === missing.partId)
      if (part === undefined || !Number.isSafeInteger(missing.firstCopyIndex) || missing.firstCopyIndex < 0 || !Number.isSafeInteger(missing.count)
        || missing.count <= 0
        || missing.firstCopyIndex + missing.count > part.quantity
        || !['noCompatiblePanel', 'constraintsPreventPlacement', 'panelLimitReached'].includes(missing.reason)) {
        issues.push({ kind: 'invalidAccounting', message: 'Invalid unplaced range' });
        continue
      }
      ranges.get(part.id)?.push({ start: missing.firstCopyIndex, count: missing.count })
      unplacedCount += missing.count
    }
    for (const part of input.parts) {
      if (!complete(ranges.get(part.id) ?? [], part.quantity)) issues.push({ kind: 'invalidAccounting', message: `Missing or duplicate copy of ${part.id}` })
    }
    // Per-panel summaries/PDFs must also account for all copies, without claiming copies on other panels are unproduced.
    for (const [panelIndex, panel] of plan.panels.entries()) {
      const local = new Map<PartId, Range[]>(input.parts.map(part => [part.id, panel.plan.placements.filter(placed => placed.partId === part.id).map(placed => ({ start: placed.copyIndex, count: 1 }))]))
      for (const missing of panel.plan.unplaced) {
        const part = input.parts.find(part => part.id === missing.partId)
        if (part === undefined || !Number.isSafeInteger(missing.firstCopyIndex) || missing.firstCopyIndex < 0 || !Number.isSafeInteger(missing.count)
          || missing.count <= 0
          || missing.firstCopyIndex + missing.count > part.quantity) {
          issues.push({ kind: 'invalidAccounting', panelIndex, message: 'Invalid panel unplaced range' });
          continue
        }
        const elsewhere = (placedCopies.get(part.id) ?? []).filter(index => index >= missing.firstCopyIndex && index < missing.firstCopyIndex + missing.count).length
        if ((missing.reason.kind === 'allocatedElsewhere' ? elsewhere !== missing.count : elsewhere !== 0)
          || !['allocatedElsewhere', 'noSpaceLeft', 'remainderNarrowerThanKerf', 'cannotFitPanel'].includes(missing.reason.kind)) issues.push({ kind: 'invalidAccounting', panelIndex, message: 'Panel summary misrepresents copies allocated elsewhere' })
        local.get(part.id)?.push({ start: missing.firstCopyIndex, count: missing.count })
      }
      for (const part of input.parts) if (!complete(local.get(part.id) ?? [], part.quantity)) issues.push({ kind: 'invalidAccounting', panelIndex, message: `Incomplete panel summary for ${part.id}` })
    }
    const metrics = {
      panelAreaMm2: panelUm2 / 1_000_000,
      usedAreaMm2: usedUm2 / 1_000_000,
      wasteAreaMm2: (panelUm2 - usedUm2) / 1_000_000,
      utilizationPercent: panelUm2 === 0 ? 0 : usedUm2 / panelUm2 * 100,
      placedCount,
      unplacedCount,
      panelCount: plan.panels.length
    }
    if (!Object.entries(metrics).every(([key, value]) => Object.entries(plan.metrics).some(([reportedKey, reportedValue]) => key === reportedKey && value === reportedValue))) issues.push({ kind: 'invalidMetrics', message: 'Global metrics disagree with independently accounted placements' })
  } catch (cause) {
    issues.push({ kind: 'invalidTree', message: cause instanceof Error ? cause.message : 'Cannot validate project plan' })
  }
  return issues.length === 0 ? { valid: true } : { valid: false, issues }
}
