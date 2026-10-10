import type { MaterialId } from './model/ids'

/** The properties of any physical item that decide whether a part can be cut from it. */
export interface MaterialSpec {
  readonly materialId: MaterialId
  readonly thicknessMm: number
}

export type CompatibilityIssue =
  | { readonly kind: 'materialMismatch'; readonly expected: MaterialId; readonly actual: MaterialId }
  | { readonly kind: 'thicknessMismatch'; readonly expectedMm: number; readonly actualMm: number }

export function hasSameMaterial(a: MaterialSpec, b: MaterialSpec): boolean {
  return a.materialId === b.materialId
}

/** Exact equality: no tolerance, so 18 and 18.000001 are different thicknesses. */
export function hasSameThickness(a: MaterialSpec, b: MaterialSpec): boolean {
  return a.thicknessMm === b.thicknessMm
}

/**
 * Lists every reason why `part` cannot be cut from `source` (a supplier product or stock item).
 * An empty list means material and thickness are compatible; geometry, grain and rotation are checked elsewhere.
 */
export function getCompatibilityIssues(part: MaterialSpec, source: MaterialSpec): CompatibilityIssue[] {
  const issues: CompatibilityIssue[] = []

  if (!hasSameMaterial(part, source)) {
    issues.push({ kind: 'materialMismatch', expected: part.materialId, actual: source.materialId })
  }
  if (!hasSameThickness(part, source)) {
    issues.push({ kind: 'thicknessMismatch', expectedMm: part.thicknessMm, actualMm: source.thicknessMm })
  }

  return issues
}

export function isCompatible(part: MaterialSpec, source: MaterialSpec): boolean {
  return getCompatibilityIssues(part, source).length === 0
}
