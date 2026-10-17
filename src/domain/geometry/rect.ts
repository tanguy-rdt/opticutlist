import type { CuttingSettings } from '../model/cutting-settings'
import type { Dimensions3D } from '../model/dimensions'
import { toMm, toNonNegativeUm, toPositiveUm } from './units'

/**
 * Axis-aligned 2D region on a panel face, in millimeters.
 * `xMm`/`lengthMm` run along the panel's length axis, `yMm`/`widthMm` along its width axis;
 * the origin is a panel corner. The panel's thickness applies to every region on it.
 */
export interface Rect {
  readonly xMm: number
  readonly yMm: number
  readonly lengthMm: number
  readonly widthMm: number
}

export type Size2D = Pick<Dimensions3D, 'lengthMm' | 'widthMm'>

/** `length`: the cut line is perpendicular to the length axis, at `offsetMm` along it. `width`: likewise for width. */
export type CutAxis = 'length' | 'width'

export interface GuillotineCut {
  readonly axis: CutAxis
  /** Distance from the rect's start edge to the start of the kerf. */
  readonly offsetMm: number
}

export interface SplitResult {
  readonly first: Rect
  /** `null` when the kerf consumes everything beyond the cut. */
  readonly second: Rect | null
}


/**
 * Area left after trimming `edgeMarginMm` from all four edges.
 * Returns `null` when the margins leave no strictly positive area.
 */
export function getUsableArea(panel: Size2D, settings: Pick<CuttingSettings, 'edgeMarginMm'>): Rect | null {
  const marginUm = toNonNegativeUm(settings.edgeMarginMm)
  const lengthUm = toPositiveUm(panel.lengthMm) - 2 * marginUm
  const widthUm = toPositiveUm(panel.widthMm) - 2 * marginUm

  if (lengthUm <= 0 || widthUm <= 0) {
    return null
  }
  return { xMm: toMm(marginUm), yMm: toMm(marginUm), lengthMm: toMm(lengthUm), widthMm: toMm(widthUm) }
}

/** Inclusive fit: a size exactly equal to the area fits. */
export function fitsWithin(size: Size2D, area: Size2D): boolean {
  return (
    toPositiveUm(size.lengthMm) <= toPositiveUm(area.lengthMm) &&
    toPositiveUm(size.widthMm) <= toPositiveUm(area.widthMm)
  )
}

/**
 * Splits `rect` with one edge-to-edge (guillotine) cut.
 * `first` spans [start, offset); the kerf spans [offset, offset + kerf); `second` covers the rest.
 * Throws a `RangeError` unless 0 < offset < extent along the cut axis.
 */
export function splitRect(rect: Rect, cut: GuillotineCut, settings: Pick<CuttingSettings, 'kerfMm'>): SplitResult {
  const kerfUm = toNonNegativeUm(settings.kerfMm)
  const offsetUm = toNonNegativeUm(cut.offsetMm)
  const startUm = toNonNegativeUm(cut.axis === 'length' ? rect.xMm : rect.yMm)
  const extentUm = toPositiveUm(cut.axis === 'length' ? rect.lengthMm : rect.widthMm)

  if (offsetUm <= 0 || offsetUm >= extentUm) {
    throw new RangeError(`Cut offset ${String(cut.offsetMm)} mm must lie strictly inside the rect`)
  }

  const remainderUm = extentUm - offsetUm - kerfUm
  const secondStartMm = toMm(startUm + offsetUm + kerfUm)

  if (cut.axis === 'length') {
    return {
      first: { ...rect, lengthMm: toMm(offsetUm) },
      second: remainderUm > 0 ? { ...rect, xMm: secondStartMm, lengthMm: toMm(remainderUm) } : null,
    }
  }
  return {
    first: { ...rect, widthMm: toMm(offsetUm) },
    second: remainderUm > 0 ? { ...rect, yMm: secondStartMm, widthMm: toMm(remainderUm) } : null,
  }
}
