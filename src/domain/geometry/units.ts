/**
 * Geometry is evaluated at a fixed 0.001 mm resolution: millimeter values are rounded to integer
 * micrometres before any arithmetic, so sums, differences and comparisons are exact and deterministic
 * (e.g. 500 − 100 − 3.2 equals 396.8 exactly).
 */
export const MICROMETRES_PER_MM = 1000

/**
 * Converts millimeters to integer micrometres.
 * Throws a `RangeError` for values that are not finite, exceed the safe integer range,
 * or fall below `minUm` after rounding (sub-resolution positive sizes are rejected, never silently zeroed).
 */
export function toMicrometres(mm: number, minUm: number): number {
  const um = Math.round(mm * MICROMETRES_PER_MM)

  if (!Number.isSafeInteger(um) || um < minUm) {
    throw new RangeError(`${String(mm)} mm is outside the supported geometry range`)
  }
  return um
}

/** Strictly positive extent (length or width): at least 1 µm. */
export function toPositiveUm(mm: number): number {
  return toMicrometres(mm, 1)
}

/** Non-negative offset, margin or kerf. */
export function toNonNegativeUm(mm: number): number {
  return toMicrometres(mm, 0)
}

export function toMm(um: number): number {
  return um / MICROMETRES_PER_MM
}
