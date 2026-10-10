import type { Dimensions3D } from '../model/dimensions'
import type { GrainDirection } from '../model/orientation'
import type { Part } from '../model/part'

/**
 * How a part lies on a panel.
 * - `normal`: part length along panel length.
 * - `rotated`: turned 90° in the panel plane; part length along panel width.
 */
export type Orientation = 'normal' | 'rotated'

export type PartOrientationSpec = Pick<Part, 'grainDirection' | 'rotation'>

/** Deterministic candidate order: `normal` is always tried first. */
const ALL_ORIENTATIONS: readonly Orientation[] = ['normal', 'rotated']

/** Grain axis of the placed part, expressed in panel axes. */
export function grainInPanelAxes(partGrain: GrainDirection, orientation: Orientation): GrainDirection {
  if (partGrain === 'none' || orientation === 'normal') {
    return partGrain
  }
  return partGrain === 'length' ? 'width' : 'length'
}

/**
 * Orientations permitted by the part's rotation policy and grain.
 * Grain constrains orientation only when both the part and the panel have a grain direction;
 * then the part's grain must run parallel to the panel's grain.
 * An empty result means rotation is forbidden but the grain would require it.
 */
export function getAllowedOrientations(part: PartOrientationSpec, panelGrain: GrainDirection): Orientation[] {
  const permitted = part.rotation === 'allowed' ? ALL_ORIENTATIONS : (['normal'] as const)
  const partGrain = part.grainDirection

  if (partGrain === 'none' || panelGrain === 'none') {
    return [...permitted]
  }
  return permitted.filter((orientation) => grainInPanelAxes(partGrain, orientation) === panelGrain)
}

/** Part dimensions expressed in panel axes. Thickness is preserved unchanged. */
export function getOrientedDimensions(part: Dimensions3D, orientation: Orientation): Dimensions3D {
  if (orientation === 'normal') {
    return { lengthMm: part.lengthMm, widthMm: part.widthMm, thicknessMm: part.thicknessMm }
  }
  return { lengthMm: part.widthMm, widthMm: part.lengthMm, thicknessMm: part.thicknessMm }
}
