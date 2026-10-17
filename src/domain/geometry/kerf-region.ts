import { splitRect, type GuillotineCut, type Rect } from './rect'
import { toMm, toNonNegativeUm, toPositiveUm } from './units'
import type { CuttingSettings } from '../model/cutting-settings'

/** The gap between the two regions of an executable cut. Zero kerf remains a zero-width line. */
export function getKerfRegion(region: Rect, cut: GuillotineCut, settings: Pick<CuttingSettings, 'kerfMm'>): Rect {
  const { first, second } = splitRect(region, cut, settings)
  if (second === null) {
    throw new RangeError('An executable cut must leave a second region')
  }
  if (cut.axis === 'length') {
    const start = toNonNegativeUm(first.xMm) + toPositiveUm(first.lengthMm)
    return { xMm: toMm(start), yMm: region.yMm, lengthMm: toMm(toNonNegativeUm(second.xMm) - start), widthMm: region.widthMm }
  }
  const start = toNonNegativeUm(first.yMm) + toPositiveUm(first.widthMm)
  return { xMm: region.xMm, yMm: toMm(start), lengthMm: region.lengthMm, widthMm: toMm(toNonNegativeUm(second.yMm) - start) }
}
