/**
 * Geometry is evaluated at a fixed 0.001 mm resolution: millimeter values are rounded to integer
 * micrometres before any arithmetic, so sums, differences and comparisons are exact and deterministic
 * (e.g. 100.1 − 3.2 equals 96.9 exactly, not 96.89999999999999).
 */
export const MICROMETRES_PER_MM = 1000

/**
 * Converts millimeters to integer micrometres, or returns `null` for values that are not finite,
 * exceed the safe integer range, or fall below `minUm` after rounding.
 * Use this for untrusted data whose problems must be reported rather than thrown.
 */
export function tryToMicrometres(mm: number, minUm: number): number | null {
  const um = Math.round(mm * MICROMETRES_PER_MM)

  return Number.isSafeInteger(um) && um >= minUm ? um : null
}

/**
 * Converts millimeters to integer micrometres.
 * Throws a `RangeError` where `tryToMicrometres` returns `null`
 * (sub-resolution positive sizes are rejected, never silently zeroed).
 */
export function toMicrometres(mm: number, minUm: number): number {
  const um = tryToMicrometres(mm, minUm)

  if (um === null) {
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
