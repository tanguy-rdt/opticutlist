import type { CuttingTreeNode, PartLeaf } from '../cutting-tree/cutting-tree'
import {
  validateCuttingTree,
  type CuttingTreeIssue,
  type CuttingTreePartSpec,
} from '../cutting-tree/validate-cutting-tree'
import { checkPartFit, type PanelSpec, type PartFitIssue } from '../geometry/part-fit'
import { getOrientedDimensions, type Orientation } from '../geometry/part-orientation'
import { getUsableArea, splitRect, type CutAxis, type Rect } from '../geometry/rect'
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

/** Remaining copies of one part, expanded lazily in increasing `copyIndex` order. */
interface PartGroup {
  readonly part: CuttingTreePartSpec
  readonly orientations: readonly Orientation[]
  nextCopyIndex: number
}

/** A cut must leave a strictly positive remainder after the kerf, unless the size matches exactly. */
function fitsAlongAxis(sizeUm: number, extentUm: number, kerfUm: number): boolean {
  return sizeUm === extentUm || sizeUm + kerfUm < extentUm
}

function areaUm2(lengthMm: number, widthMm: number): number {
  return toPositiveUm(lengthMm) * toPositiveUm(widthMm)
}

/** Deterministic part order: larger area first, then longer side, then input order. */
function compareParts(a: CuttingTreePartSpec, b: CuttingTreePartSpec): number {
  return (
    areaUm2(b.lengthMm, b.widthMm) - areaUm2(a.lengthMm, a.widthMm) ||
    Math.max(toPositiveUm(b.lengthMm), toPositiveUm(b.widthMm)) -
      Math.max(toPositiveUm(a.lengthMm), toPositiveUm(a.widthMm))
  )
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
 * Builds a guillotine cutting plan for one panel with a single deterministic heuristic.
 *
 * Each free region receives the first part (in `compareParts` order, `normal` before `rotated`) that can be
 * cut from it. The part goes to the region's start corner; it is cut free with two guillotine cuts whose
 * order keeps the largest leftover rectangle (ties: length cut first). The strip beside the part is filled
 * before the larger remainder. Regions that take no part become waste.
 *
 * The resulting tree is always checked by `validateCuttingTree`; an invalid tree is reported as an error.
 */
export function optimizePanel({ panel, parts, settings }: OptimizePanelInput): OptimizePanelResult {
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

  for (const part of [...parts].sort(compareParts)) {
    const fit = checkPartFit(part, panel, settings)
    if (!fit.fits) {
      unplacedBeforeStart.push({ partId: part.id, firstCopyIndex: 0, count: part.quantity, reason: { kind: 'cannotFitPanel', issues: fit.issues } })
      continue
    }
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
    // Sub-regions are never larger than the usable area, so other orientations can never be used.
    groups.push({ part, orientations, nextCopyIndex: 0 })
  }

  /** Cuts `sizeUm` off the start of `region` along `axis` (unless it already matches) and fills the rest. */
  function cutOff(region: Rect, axis: CutAxis, sizeUm: number, inner: (piece: Rect) => CuttingTreeNode): CuttingTreeNode {
    const extentUm = toPositiveUm(axis === 'length' ? region.lengthMm : region.widthMm)
    if (sizeUm === extentUm) {
      return inner(region)
    }
    const cut = { axis, offsetMm: toMm(sizeUm) }
    const { first, second } = splitRect(region, cut, settings)
    if (second === null) {
      throw new Error('Optimizer invariant violated: cut without remainder')
    }
    const firstNode = inner(first)
    return { kind: 'cut', region, cut, first: firstNode, second: fill(second) }
  }

  function fill(region: Rect): CuttingTreeNode {
    const lengthUm = toPositiveUm(region.lengthMm)
    const widthUm = toPositiveUm(region.widthMm)

    for (const group of groups) {
      if (group.nextCopyIndex >= group.part.quantity) {
        continue
      }
      for (const orientation of group.orientations) {
        const oriented = getOrientedDimensions(group.part, orientation)
        const partLengthUm = toPositiveUm(oriented.lengthMm)
        const partWidthUm = toPositiveUm(oriented.widthMm)
        if (!fitsAlongAxis(partLengthUm, lengthUm, kerfUm) || !fitsAlongAxis(partWidthUm, widthUm, kerfUm)) {
          continue
        }

        const copyIndex = group.nextCopyIndex
        group.nextCopyIndex += 1
        const leaf = (piece: Rect): PartLeaf => ({ kind: 'part', region: piece, partId: group.part.id, copyIndex, orientation })

        // Largest leftover rectangle for each cut order; 0 where no cut is needed on that axis.
        const restLengthUm = lengthUm - partLengthUm - kerfUm
        const restWidthUm = widthUm - partWidthUm - kerfUm
        const lengthCutLeftover = partLengthUm < lengthUm ? restLengthUm * widthUm : 0
        const widthCutLeftover = partWidthUm < widthUm ? restWidthUm * lengthUm : 0
        const lengthFirst =
          Math.max(lengthCutLeftover, partWidthUm < widthUm ? partLengthUm * restWidthUm : 0) >=
          Math.max(widthCutLeftover, partLengthUm < lengthUm ? restLengthUm * partWidthUm : 0)

        return lengthFirst
          ? cutOff(region, 'length', partLengthUm, (column) => cutOff(column, 'width', partWidthUm, leaf))
          : cutOff(region, 'width', partWidthUm, (row) => cutOff(row, 'length', partLengthUm, leaf))
      }
    }
    return { kind: 'waste', region }
  }

  const tree = fill(usableArea)

  const validation = validateCuttingTree(tree, { panel, parts, settings })
  if (!validation.valid) {
    return { ok: false, error: { kind: 'invalidTree', issues: validation.issues } }
  }

  const placements: PlacedPart[] = []
  collectPlacements(tree, partsById, placements)

  const unplaced = [
    ...unplacedBeforeStart,
    ...groups
      .filter((group) => group.nextCopyIndex < group.part.quantity)
      .map((group) => ({
        partId: group.part.id,
        firstCopyIndex: group.nextCopyIndex,
        count: group.part.quantity - group.nextCopyIndex,
        reason: { kind: 'noSpaceLeft' } as const,
      })),
  ]

  return { ok: true, plan: { tree, placements, unplaced, metrics: computeAreaMetrics(panel, placements) } }
}
