import { getCompatibilityIssues, type CompatibilityIssue } from '../compatibility'
import type { PanelSpec, PartFitSpec } from '../geometry/part-fit'
import { getAllowedOrientations, getOrientedDimensions, type Orientation } from '../geometry/part-orientation'
import { getUsableArea, splitRect, type Rect, type Size2D } from '../geometry/rect'
import { toPositiveUm, tryToMicrometres } from '../geometry/units'
import type { CuttingSettings } from '../model/cutting-settings'
import type { PartId } from '../model/ids'
import type { Part } from '../model/part'
import type { CutNode, CuttingTreeNode, PartLeaf, TreePath } from './cutting-tree'

export type CuttingTreePartSpec = PartFitSpec & Pick<Part, 'id' | 'quantity'>

export interface CuttingTreeContext {
  readonly panel: PanelSpec
  /** Parts that may appear in the tree; IDs must be unique. */
  readonly parts: readonly CuttingTreePartSpec[]
  readonly settings: CuttingSettings
}

type IssueDetails =
  | { readonly kind: 'noUsableArea'; readonly edgeMarginMm: number }
  | { readonly kind: 'reusedNode' }
  | { readonly kind: 'invalidRegion'; readonly region: Rect }
  | { readonly kind: 'regionOutOfBounds'; readonly bounds: Rect }
  | { readonly kind: 'regionOverlap'; readonly expected: Rect }
  | { readonly kind: 'missingRegion'; readonly expected: Rect }
  | { readonly kind: 'invalidCutOffset'; readonly offsetMm: number }
  | { readonly kind: 'cutOutOfBounds'; readonly offsetMm: number; readonly extentMm: number }
  | { readonly kind: 'cutLeavesNoRemainder'; readonly offsetMm: number; readonly kerfMm: number; readonly extentMm: number }
  | { readonly kind: 'unknownPart'; readonly partId: PartId }
  | { readonly kind: 'invalidCopyIndex'; readonly partId: PartId; readonly copyIndex: number; readonly quantity: number }
  | { readonly kind: 'duplicatePlacement'; readonly partId: PartId; readonly copyIndex: number; readonly firstPath: TreePath }
  | CompatibilityIssue
  | { readonly kind: 'orientationNotAllowed'; readonly orientation: Orientation; readonly allowed: readonly Orientation[] }
  | { readonly kind: 'partSizeMismatch'; readonly expected: Size2D; readonly actual: Size2D }

export type CuttingTreeIssue = IssueDetails & { readonly path: TreePath }

export type CuttingTreeValidation =
  | { readonly valid: true }
  | { readonly valid: false; readonly issues: readonly [CuttingTreeIssue, ...CuttingTreeIssue[]] }

/** Rect in integer micrometres. */
interface UmRect {
  readonly x: number
  readonly y: number
  readonly length: number
  readonly width: number
}

/** Where a node must lie: exactly `slot`, inside `bounds` (the parent region, or the usable area for the root). */
interface Expectation {
  readonly slot: Rect
  readonly bounds: Rect
}


function toUmRect(rect: Rect): UmRect | null {
  const x = tryToMicrometres(rect.xMm, 0)
  const y = tryToMicrometres(rect.yMm, 0)
  const length = tryToMicrometres(rect.lengthMm, 1)
  const width = tryToMicrometres(rect.widthMm, 1)

  return x === null || y === null || length === null || width === null ? null : { x, y, length, width }
}

function exceeds(inner: UmRect, outer: UmRect): boolean {
  return inner.x < outer.x || inner.y < outer.y || inner.x + inner.length > outer.x + outer.length || inner.y + inner.width > outer.y + outer.width
}

function intersect(a: UmRect, b: UmRect): UmRect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const length = Math.min(a.x + a.length, b.x + b.length) - x
  const width = Math.min(a.y + a.width, b.y + b.width) - y

  return length > 0 && width > 0 ? { x, y, length, width } : null
}

/**
 * Validates a complete guillotine cutting tree for one panel, independently of how it was produced.
 *
 * Boundary rules (all compared exactly at 0.001 mm resolution):
 * - The root region equals the usable area (panel minus `edgeMarginMm` on every edge).
 * - A cut offset lies strictly inside its region (0 < offset < extent) and leaves a strictly positive
 *   second region after the kerf (offset + kerf < extent).
 * - Each child region equals the region `splitRect` derives from its parent and cut. A child that reaches
 *   outside the parent is out of bounds, one that reaches into the kerf or sibling overlaps,
 *   and one that leaves part of its slot uncovered leaves a missing region.
 * - A part leaf references a known part, a copy index in [0, quantity), at most once per tree;
 *   its material and thickness match the panel exactly, its orientation is permitted by rotation policy
 *   and grain, and its region equals the oriented part size exactly.
 *
 * Tree contents are untrusted and every problem is reported, in depth-first order (first before second).
 * `context` must contain schema-validated domain values; duplicate part IDs throw an `Error`.
 */
export function validateCuttingTree(root: CuttingTreeNode, context: CuttingTreeContext): CuttingTreeValidation {
  const partsById = new Map<PartId, CuttingTreePartSpec>()
  for (const part of context.parts) {
    if (partsById.has(part.id)) {
      throw new Error(`Duplicate part ID ${part.id} in cutting tree context`)
    }
    partsById.set(part.id, part)
  }

  const issues: CuttingTreeIssue[] = []
  const visited = new Set<CuttingTreeNode>()
  const placements = new Map<string, TreePath>()
  const report = (path: TreePath, details: IssueDetails): void => {
    issues.push({ ...details, path })
  }

  function checkExpectation(path: TreePath, region: UmRect, expectation: Expectation): void {
    const slot = toUmRect(expectation.slot)
    const bounds = toUmRect(expectation.bounds)
    if (slot === null || bounds === null) {
      return
    }
    if (exceeds(region, bounds)) {
      report(path, { kind: 'regionOutOfBounds', bounds: expectation.bounds })
    }
    const inside = intersect(region, bounds)
    if (inside !== null && exceeds(inside, slot)) {
      report(path, { kind: 'regionOverlap', expected: expectation.slot })
    }
    if (exceeds(slot, region)) {
      report(path, { kind: 'missingRegion', expected: expectation.slot })
    }
  }

  /** Expected child slots, or `null` if the cut itself is invalid. */
  function checkCut(path: TreePath, node: CutNode, region: UmRect): { first: Rect; second: Rect } | null {
    // Any finite offset is representable; negative ones are reported as out of bounds below.
    const offsetUm = tryToMicrometres(node.cut.offsetMm, -Number.MAX_SAFE_INTEGER)
    if (offsetUm === null) {
      report(path, { kind: 'invalidCutOffset', offsetMm: node.cut.offsetMm })
      return null
    }

    const extentUm = node.cut.axis === 'length' ? region.length : region.width
    const extentMm = node.cut.axis === 'length' ? node.region.lengthMm : node.region.widthMm
    if (offsetUm <= 0 || offsetUm >= extentUm) {
      report(path, { kind: 'cutOutOfBounds', offsetMm: node.cut.offsetMm, extentMm })
      return null
    }

    const { first, second } = splitRect(node.region, node.cut, context.settings)
    if (second === null) {
      report(path, { kind: 'cutLeavesNoRemainder', offsetMm: node.cut.offsetMm, kerfMm: context.settings.kerfMm, extentMm })
      return null
    }
    return { first, second }
  }

  function checkPartLeaf(path: TreePath, leaf: PartLeaf, region: UmRect | null): void {
    const part = partsById.get(leaf.partId)
    if (part === undefined) {
      report(path, { kind: 'unknownPart', partId: leaf.partId })
      return
    }

    if (!Number.isSafeInteger(leaf.copyIndex) || leaf.copyIndex < 0 || leaf.copyIndex >= part.quantity) {
      report(path, { kind: 'invalidCopyIndex', partId: part.id, copyIndex: leaf.copyIndex, quantity: part.quantity })
    } else {
      const key = `${part.id}#${String(leaf.copyIndex)}`
      const firstPath = placements.get(key)
      if (firstPath === undefined) {
        placements.set(key, path)
      } else {
        report(path, { kind: 'duplicatePlacement', partId: part.id, copyIndex: leaf.copyIndex, firstPath })
      }
    }

    for (const issue of getCompatibilityIssues(part, context.panel)) {
      report(path, issue)
    }

    const allowed = getAllowedOrientations(part, context.panel.grainDirection)
    if (!allowed.includes(leaf.orientation)) {
      report(path, { kind: 'orientationNotAllowed', orientation: leaf.orientation, allowed })
    }

    const oriented = getOrientedDimensions(part, leaf.orientation)
    if (region !== null && (toPositiveUm(oriented.lengthMm) !== region.length || toPositiveUm(oriented.widthMm) !== region.width)) {
      report(path, {
        kind: 'partSizeMismatch',
        expected: { lengthMm: oriented.lengthMm, widthMm: oriented.widthMm },
        actual: { lengthMm: leaf.region.lengthMm, widthMm: leaf.region.widthMm },
      })
    }
  }

  function visit(node: CuttingTreeNode, path: TreePath, expectation: Expectation | null): void {
    if (visited.has(node)) {
      report(path, { kind: 'reusedNode' })
      return
    }
    visited.add(node)

    const region = toUmRect(node.region)
    if (region === null) {
      report(path, { kind: 'invalidRegion', region: node.region })
    } else if (expectation !== null) {
      checkExpectation(path, region, expectation)
    }

    switch (node.kind) {
      case 'waste':
        return
      case 'part':
        checkPartLeaf(path, node, region)
        return
      case 'cut': {
        const slots = region === null ? null : checkCut(path, node, region)
        visit(node.first, [...path, 'first'], slots && { slot: slots.first, bounds: node.region })
        visit(node.second, [...path, 'second'], slots && { slot: slots.second, bounds: node.region })
      }
    }
  }

  const usableArea = getUsableArea(context.panel, context.settings)
  if (usableArea === null) {
    report([], { kind: 'noUsableArea', edgeMarginMm: context.settings.edgeMarginMm })
  }
  visit(root, [], usableArea && { slot: usableArea, bounds: usableArea })

  const [firstIssue, ...otherIssues] = issues
  return firstIssue === undefined ? { valid: true } : { valid: false, issues: [firstIssue, ...otherIssues] }
}
