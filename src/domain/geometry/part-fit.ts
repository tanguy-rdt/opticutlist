import { getCompatibilityIssues, type CompatibilityIssue } from '../compatibility'
import type { CuttingSettings } from '../model/cutting-settings'
import type { GrainDirection, RotationPolicy } from '../model/orientation'
import type { Part } from '../model/part'
import type { StockItem } from '../model/stock-item'
import type { SupplierProduct } from '../model/supplier-product'
import { getAllowedOrientations, getOrientedDimensions, type Orientation } from './part-orientation'
import { fitsWithin, getUsableArea, type Rect } from './rect'

type PanelFields = 'materialId' | 'lengthMm' | 'widthMm' | 'thicknessMm' | 'grainDirection'

/** Anything a part can be cut from: a catalog product or owned stock. */
export type PanelSpec = Pick<SupplierProduct, PanelFields> | Pick<StockItem, PanelFields>

export type PartFitSpec = Pick<
  Part,
  'materialId' | 'lengthMm' | 'widthMm' | 'thicknessMm' | 'grainDirection' | 'rotation'
>

export type PartFitIssue =
  | CompatibilityIssue
  | { readonly kind: 'noUsableArea'; readonly edgeMarginMm: number }
  | {
    readonly kind: 'grainRequiresRotation'
    readonly partGrain: GrainDirection
    readonly panelGrain: GrainDirection
    readonly rotation: RotationPolicy
  }
  | {
    readonly kind: 'exceedsUsableArea'
    readonly usableArea: Rect
    readonly triedOrientations: readonly Orientation[]
  }

export type PartFitResult =
  | { readonly fits: true; readonly usableArea: Rect; readonly orientations: readonly [Orientation, ...Orientation[]] }
  | { readonly fits: false; readonly issues: readonly [PartFitIssue, ...PartFitIssue[]] }

/**
 * Checks whether one copy of `part` can be cut from an otherwise empty `panel`.
 * Requires exact material and thickness compatibility, a positive usable area after edge margins,
 * at least one orientation permitted by rotation policy and grain, and an inclusive size fit.
 * All applicable issues are reported, in this order. Kerf does not apply: it only separates pieces.
 */
export function checkPartFit(
  part: PartFitSpec,
  panel: PanelSpec,
  settings: Pick<CuttingSettings, 'edgeMarginMm'>,
): PartFitResult {
  const issues: PartFitIssue[] = [...getCompatibilityIssues(part, panel)]

  const usableArea = getUsableArea(panel, settings)
  if (usableArea === null) {
    issues.push({ kind: 'noUsableArea', edgeMarginMm: settings.edgeMarginMm })
  }

  const allowed = getAllowedOrientations(part, panel.grainDirection)
  if (allowed.length === 0) {
    issues.push({
      kind: 'grainRequiresRotation',
      partGrain: part.grainDirection,
      panelGrain: panel.grainDirection,
      rotation: part.rotation,
    })
  }

  const fitting =
    usableArea === null
      ? []
      : allowed.filter((orientation) => fitsWithin(getOrientedDimensions(part, orientation), usableArea))
  if (usableArea !== null && allowed.length > 0 && fitting.length === 0) {
    issues.push({ kind: 'exceedsUsableArea', usableArea, triedOrientations: allowed })
  }

  const [firstIssue, ...otherIssues] = issues
  if (firstIssue !== undefined) {
    return { fits: false, issues: [firstIssue, ...otherIssues] }
  }

  const [firstOrientation, ...otherOrientations] = fitting
  if (usableArea === null || firstOrientation === undefined) {
    // Unreachable: without issues there is a usable area and at least one fitting orientation.
    throw new Error('Inconsistent part fit evaluation')
  }
  return { fits: true, usableArea, orientations: [firstOrientation, ...otherOrientations] }
}
