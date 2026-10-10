import type { CuttingTreeNode, PartLeaf } from '../cutting-tree/cutting-tree'
import {
  validateCuttingTree,
  type CuttingTreeIssue,
  type CuttingTreePartSpec,
} from '../cutting-tree/validate-cutting-tree'
import { checkPartFit, type PanelSpec, type PartFitIssue } from '../geometry/part-fit'
import { getOrientedDimensions, type Orientation } from '../geometry/part-orientation'
import { getUsableArea, splitRect, type CutAxis, type GuillotineCut, type Rect } from '../geometry/rect'
import { toMm, toNonNegativeUm, toPositiveUm } from '../geometry/units'
import type { CuttingSettings } from '../model/cutting-settings'
import type { Dimensions3D } from '../model/dimensions'
import type { PartId } from '../model/ids'

export interface PlacedPart {
  readonly partId: PartId
  readonly copyIndex: number
  readonly orientation: Orientation
  readonly region: Rect
  /** Part dimensions in panel axes (length along x), thickness preserved. */
  readonly dimensions: Dimensions3D
}

export type UnplacedReason =
  /** The part cannot be cut from this panel at all (material, thickness, grain/rotation or size). */
  | { readonly kind: 'cannotFitPanel'; readonly issues: readonly PartFitIssue[] }
  /** It fits the empty usable area only by leaving a strip no wider than the kerf, which no cut can produce. */
  | { readonly kind: 'remainderNarrowerThanKerf' }
  /** It would fit the empty panel, but no remaining region could take it. */
  | { readonly kind: 'noSpaceLeft' }

/** Copies `firstCopyIndex` … `firstCopyIndex + count − 1` of a part that were not placed. */
export interface UnplacedParts {
  readonly partId: PartId
  readonly firstCopyIndex: number
  readonly count: number
  readonly reason: UnplacedReason
}

/** Areas in mm², relative to the whole panel: waste includes margins, kerf and waste leaves. */
export interface AreaMetrics {
  readonly panelAreaMm2: number
  readonly usedAreaMm2: number
  readonly wasteAreaMm2: number
  readonly utilizationPercent: number
}

export interface PanelCuttingPlan {
  /** Validated by `validateCuttingTree`. */
  readonly tree: CuttingTreeNode
  readonly placements: readonly PlacedPart[]
  readonly unplaced: readonly UnplacedParts[]
  readonly metrics: AreaMetrics
}

export type OptimizePanelError =
  | { readonly kind: 'noUsableArea' }
  /** The heuristic produced a tree the independent validator rejected; it is never returned as a plan. */
  | { readonly kind: 'invalidTree'; readonly issues: readonly CuttingTreeIssue[] }

export type OptimizePanelResult =
  | { readonly ok: true; readonly plan: PanelCuttingPlan }
  | { readonly ok: false; readonly error: OptimizePanelError }

export interface OptimizePanelInput {
  readonly panel: PanelSpec
  /** Schema-validated parts with unique IDs; each is placed up to `quantity` times. */
  readonly parts: readonly CuttingTreePartSpec[]
  readonly settings: CuttingSettings
}

/**
 * Deterministic placement strategies, in tie-break priority order.
 * - `largestAreaFirst` (baseline): each free region, filled depth-first, takes the first part that fits,
 *   with parts ordered by area, then longest side.
 * - `longestSideFirst`: the same region-driven fill, with parts ordered by longest side, then area.
 * - `bestShortSideFit`: part-driven; each copy, in `largestAreaFirst` order, goes to the free region and
 *   orientation leaving the smallest short-side leftover, then long-side leftover, then the oldest region.
 */
export const PLACEMENT_STRATEGIES = ['largestAreaFirst', 'longestSideFirst', 'bestShortSideFit'] as const
export type PlacementStrategy = (typeof PLACEMENT_STRATEGIES)[number]

/** Remaining copies of one part, expanded lazily in increasing `copyIndex` order. */
interface PartGroup {
  readonly part: CuttingTreePartSpec
  readonly orientations: readonly Orientation[]
  nextCopyIndex: number
}

/** Mutable build-time node; free slots (`content: null`) become waste leaves. */
interface Slot {
  readonly region: Rect
  /** Creation order, used for deterministic tie-breaking. */
  readonly sequence: number
  content: PartLeaf | { readonly cut: GuillotineCut; readonly first: Slot; readonly second: Slot } | null
}

/** A cut must leave a strictly positive remainder after the kerf, unless the size matches exactly. */
function fitsAlongAxis(sizeUm: number, extentUm: number, kerfUm: number): boolean {
  return sizeUm === extentUm || sizeUm + kerfUm < extentUm
}

export function areaUm2(lengthMm: number, widthMm: number): number {
  return toPositiveUm(lengthMm) * toPositiveUm(widthMm)
}

function longestSideUm(part: CuttingTreePartSpec): number {
  return Math.max(toPositiveUm(part.lengthMm), toPositiveUm(part.widthMm))
}

/** Part orders; `Array.prototype.sort` is stable, so equal parts keep their input order. */
const PART_ORDERS: Record<PlacementStrategy, (a: CuttingTreePartSpec, b: CuttingTreePartSpec) => number> = {
  largestAreaFirst: (a, b) =>
    areaUm2(b.lengthMm, b.widthMm) - areaUm2(a.lengthMm, a.widthMm) || longestSideUm(b) - longestSideUm(a),
  longestSideFirst: (a, b) =>
    longestSideUm(b) - longestSideUm(a) || areaUm2(b.lengthMm, b.widthMm) - areaUm2(a.lengthMm, a.widthMm),
  bestShortSideFit: (a, b) => PART_ORDERS.largestAreaFirst(a, b),
}

function toTree(slot: Slot): CuttingTreeNode {
  if (slot.content === null) {
    return { kind: 'waste', region: slot.region }
  }
  if ('kind' in slot.content) {
    return slot.content
  }
  return {
    kind: 'cut',
    region: slot.region,
    cut: slot.content.cut,
    first: toTree(slot.content.first),
    second: toTree(slot.content.second),
  }
}

function collectPlacements(node: CuttingTreeNode, parts: ReadonlyMap<PartId, CuttingTreePartSpec>, out: PlacedPart[]): void {
  if (node.kind === 'cut') {
    collectPlacements(node.first, parts, out)
    collectPlacements(node.second, parts, out)
  } else if (node.kind === 'part') {
    const part = parts.get(node.partId)
    if (part !== undefined) {
      out.push({
        partId: node.partId,
        copyIndex: node.copyIndex,
        orientation: node.orientation,
        region: node.region,
        dimensions: getOrientedDimensions(part, node.orientation),
      })
    }
  }
}

export function computeAreaMetrics(panel: PanelSpec, placements: readonly PlacedPart[]): AreaMetrics {
  const panelUm2 = areaUm2(panel.lengthMm, panel.widthMm)
  const usedUm2 = placements.reduce((sum, placed) => sum + areaUm2(placed.region.lengthMm, placed.region.widthMm), 0)
  const umPerMm2 = 1_000_000

  return {
    panelAreaMm2: panelUm2 / umPerMm2,
    usedAreaMm2: usedUm2 / umPerMm2,
    wasteAreaMm2: (panelUm2 - usedUm2) / umPerMm2,
    utilizationPercent: (usedUm2 / panelUm2) * 100,
  }
}

/**
 * Builds a guillotine cutting plan for one panel with one deterministic strategy.
 *
 * Parts that cannot be cut from the empty panel are reported first. Each placed part goes to its region's
 * start corner and is freed with up to two guillotine cuts whose order keeps the largest leftover rectangle
 * (ties: length cut first). The resulting tree is always checked by `validateCuttingTree`; an invalid tree
 * is reported as an error and never returned as a plan.
 */
export function planWithStrategy(
  { panel, parts, settings }: OptimizePanelInput,
  strategy: PlacementStrategy,
): OptimizePanelResult {
  const partsById = new Map<PartId, CuttingTreePartSpec>()
  for (const part of parts) {
    if (partsById.has(part.id)) {
      throw new Error(`Duplicate part ID ${part.id} in optimizer input`)
    }
    partsById.set(part.id, part)
  }

  const usableArea = getUsableArea(panel, settings)
  if (usableArea === null) {
    return { ok: false, error: { kind: 'noUsableArea' } }
  }

  const kerfUm = toNonNegativeUm(settings.kerfMm)
  const unplacedBeforeStart: UnplacedParts[] = []
  const groups: PartGroup[] = []

  for (const part of [...parts].sort(PART_ORDERS[strategy])) {
    const fit = checkPartFit(part, panel, settings)
    if (!fit.fits) {
      unplacedBeforeStart.push({ partId: part.id, firstCopyIndex: 0, count: part.quantity, reason: { kind: 'cannotFitPanel', issues: fit.issues } })
      continue
    }
    // Sub-regions are never larger than the usable area, so other orientations can never be used.
    const orientations = fit.orientations.filter((orientation) => {
      const { lengthMm, widthMm } = getOrientedDimensions(part, orientation)
      return (
        fitsAlongAxis(toPositiveUm(lengthMm), toPositiveUm(usableArea.lengthMm), kerfUm) &&
        fitsAlongAxis(toPositiveUm(widthMm), toPositiveUm(usableArea.widthMm), kerfUm)
      )
    })
    if (orientations.length === 0) {
      unplacedBeforeStart.push({ partId: part.id, firstCopyIndex: 0, count: part.quantity, reason: { kind: 'remainderNarrowerThanKerf' } })
      continue
    }
    groups.push({ part, orientations, nextCopyIndex: 0 })
  }

  let nextSequence = 0
  const newSlot = (region: Rect): Slot => ({ region, sequence: nextSequence++, content: null })
  const root = newSlot(usableArea)

  /** Oriented part size in µm, or `null` if it cannot be cut from `slot`. */
  function sizeIn(slot: Slot, part: CuttingTreePartSpec, orientation: Orientation): { lengthUm: number; widthUm: number } | null {
    const oriented = getOrientedDimensions(part, orientation)
    const lengthUm = toPositiveUm(oriented.lengthMm)
    const widthUm = toPositiveUm(oriented.widthMm)
    const fits =
      fitsAlongAxis(lengthUm, toPositiveUm(slot.region.lengthMm), kerfUm) &&
      fitsAlongAxis(widthUm, toPositiveUm(slot.region.widthMm), kerfUm)
    return fits ? { lengthUm, widthUm } : null
  }

  /**
   * Cuts the next copy of `group` out of `slot`'s start corner.
   * Returns the new free slots in push order: the larger remainder, then the strip beside the part,
   * so a stack fills the strip first.
   */
  function place(slot: Slot, group: PartGroup, orientation: Orientation): Slot[] {
    const size = sizeIn(slot, group.part, orientation)
    if (size === null) {
      throw new Error('Optimizer invariant violated: placing a part that does not fit')
    }
    const created: Slot[] = []
    const cutOff = (target: Slot, axis: CutAxis, sizeUm: number): Slot => {
      const extentUm = toPositiveUm(axis === 'length' ? target.region.lengthMm : target.region.widthMm)
      if (sizeUm === extentUm) {
        return target
      }
      const cut = { axis, offsetMm: toMm(sizeUm) }
      const { first, second } = splitRect(target.region, cut, settings)
      if (second === null) {
        throw new Error('Optimizer invariant violated: cut without remainder')
      }
      const piece = newSlot(first)
      const rest = newSlot(second)
      target.content = { cut, first: piece, second: rest }
      created.push(rest)
      return piece
    }

    // Largest leftover rectangle for each cut order; 0 where no cut is needed on that axis.
    const regionLengthUm = toPositiveUm(slot.region.lengthMm)
    const regionWidthUm = toPositiveUm(slot.region.widthMm)
    const restLengthUm = regionLengthUm - size.lengthUm - kerfUm
    const restWidthUm = regionWidthUm - size.widthUm - kerfUm
    const cutsLength = size.lengthUm < regionLengthUm
    const cutsWidth = size.widthUm < regionWidthUm
    const lengthFirst =
      Math.max(cutsLength ? restLengthUm * regionWidthUm : 0, cutsWidth ? size.lengthUm * restWidthUm : 0) >=
      Math.max(cutsWidth ? restWidthUm * regionLengthUm : 0, cutsLength ? restLengthUm * size.widthUm : 0)

    const piece = lengthFirst
      ? cutOff(cutOff(slot, 'length', size.lengthUm), 'width', size.widthUm)
      : cutOff(cutOff(slot, 'width', size.widthUm), 'length', size.lengthUm)
    piece.content = { kind: 'part', region: piece.region, partId: group.part.id, copyIndex: group.nextCopyIndex, orientation }
    group.nextCopyIndex += 1
    return created
  }

  const remaining = (group: PartGroup): boolean => group.nextCopyIndex < group.part.quantity

  if (strategy === 'bestShortSideFit') {
    let free: Slot[] = [root]
    for (const group of groups) {
      while (remaining(group)) {
        let best: { slot: Slot; orientation: Orientation; shortUm: number; longUm: number } | null = null
        for (const slot of free) {
          for (const orientation of group.orientations) {
            const size = sizeIn(slot, group.part, orientation)
            if (size === null) {
              continue
            }
            const leftoverLengthUm = toPositiveUm(slot.region.lengthMm) - size.lengthUm
            const leftoverWidthUm = toPositiveUm(slot.region.widthMm) - size.widthUm
            const shortUm = Math.min(leftoverLengthUm, leftoverWidthUm)
            const longUm = Math.max(leftoverLengthUm, leftoverWidthUm)
            // Strict comparison keeps the earlier slot and orientation on ties.
            if (best === null || shortUm < best.shortUm || (shortUm === best.shortUm && longUm < best.longUm)) {
              best = { slot, orientation, shortUm, longUm }
            }
          }
        }
        if (best === null) {
          break
        }
        const chosen = best.slot
        free = [...free.filter((slot) => slot !== chosen), ...place(chosen, group, best.orientation)].sort(
          (a, b) => a.sequence - b.sequence,
        )
      }
    }
  } else {
    const stack: Slot[] = [root]
    for (let slot = stack.pop(); slot !== undefined; slot = stack.pop()) {
      const current = slot
      const choice = groups
        .filter(remaining)
        .flatMap((group) => group.orientations.map((orientation) => ({ group, orientation })))
        .find(({ group, orientation }) => sizeIn(current, group.part, orientation) !== null)
      if (choice !== undefined) {
        stack.push(...place(current, choice.group, choice.orientation))
      }
    }
  }

  const tree = toTree(root)

  const validation = validateCuttingTree(tree, { panel, parts, settings })
  if (!validation.valid) {
    return { ok: false, error: { kind: 'invalidTree', issues: validation.issues } }
  }

  const placements: PlacedPart[] = []
  collectPlacements(tree, partsById, placements)

  const unplaced = [
    ...unplacedBeforeStart,
    ...groups.filter(remaining).map((group) => ({
      partId: group.part.id,
      firstCopyIndex: group.nextCopyIndex,
      count: group.part.quantity - group.nextCopyIndex,
      reason: { kind: 'noSpaceLeft' } as const,
    })),
  ]

  return { ok: true, plan: { tree, placements, unplaced, metrics: computeAreaMetrics(panel, placements) } }
}
