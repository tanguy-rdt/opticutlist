import type { CuttingTreeNode, PartLeaf } from './cutting-tree'
import { validateCuttingTree, type CuttingTreeContext, type CuttingTreeIssue } from './validate-cutting-tree'
import { getAllowedOrientations, getOrientedDimensions, type Orientation } from '../geometry/part-orientation'
import { splitRect, type Rect, type Size2D } from '../geometry/rect'
import { toNonNegativeUm, toPositiveUm } from '../geometry/units'

export type PlacedCopy = Pick<PartLeaf, 'partId' | 'copyIndex'>
export type CuttingTreeEdit =
  | { readonly kind: 'rotate'; readonly copy: PlacedCopy }
  | { readonly kind: 'swap'; readonly first: PlacedCopy; readonly second: PlacedCopy }
export interface CuttingTreeEditError {
  readonly message: string
  readonly issues: readonly CuttingTreeIssue[]
}
export type CuttingTreeEditResult =
  | { readonly ok: true; readonly tree: CuttingTreeNode }
  | { readonly ok: false; readonly error: CuttingTreeEditError }
const reject = (message: string, issues: readonly CuttingTreeIssue[] = []): CuttingTreeEditResult => ({ ok: false, error: { message, issues } })
const sameCopy = (a: PlacedCopy, b: PlacedCopy): boolean => a.partId === b.partId && a.copyIndex === b.copyIndex

function findLeaf(node: CuttingTreeNode, copy: PlacedCopy): PartLeaf | null {
  if (node.kind === 'part') {
    return sameCopy(node, copy) ? node : null
  }
  return node.kind === 'cut' ? findLeaf(node.first, copy) ?? findLeaf(node.second, copy) : null
}

function replace(node: CuttingTreeNode, target: CuttingTreeNode, replacement: CuttingTreeNode): CuttingTreeNode {
  if (node === target) {
    return replacement
  }
  if (node.kind !== 'cut') {
    return node
  }
  const first = replace(node.first, target, replacement)
  const second = replace(node.second, target, replacement)
  return first === node.first && second === node.second ? node : { ...node, first, second }
}

function sameSize(size: Size2D, region: Rect): boolean {
  return toPositiveUm(size.lengthMm) === toPositiveUm(region.lengthMm) && toPositiveUm(size.widthMm) === toPositiveUm(region.widthMm)
}

function canTrim(size: Size2D, region: Rect, kerfMm: number): boolean {
  const kerf = toNonNegativeUm(kerfMm)
  const fits = (sizeUm: number, extentUm: number) => sizeUm === extentUm || sizeUm + kerf < extentUm
  return fits(toPositiveUm(size.lengthMm), toPositiveUm(region.lengthMm)) && fits(toPositiveUm(size.widthMm), toPositiveUm(region.widthMm))
}

/** One selected copy and waste only, with the same anchor. No neighboring placement is reclaimed. */
function rotationRegions(node: CuttingTreeNode, leaf: PartLeaf): { count: number; regions: CuttingTreeNode[] } {
  if (node.kind === 'waste') {
    return { count: 0, regions: [] }
  }
  if (node.kind === 'part') {
    return { count: 1, regions: node === leaf ? [node] : [] }
  }
  const first = rotationRegions(node.first, leaf)
  const second = rotationRegions(node.second, leaf)
  const count = first.count + second.count
  const regions = [...first.regions, ...second.regions]
  if (
    count === 1
    && regions.length > 0
    && toNonNegativeUm(node.region.xMm) === toNonNegativeUm(leaf.region.xMm)
    && toNonNegativeUm(node.region.yMm) === toNonNegativeUm(leaf.region.yMm)
  ) {
    regions.push(node)
  }
  return { count, regions }
}

/** Recut only the reserved region, length then width, using the existing split geometry. */
function trimmedLeaf(region: Rect, size: Size2D, leaf: PartLeaf, orientation: Orientation, context: CuttingTreeContext): CuttingTreeNode {
  if (toPositiveUm(size.lengthMm) !== toPositiveUm(region.lengthMm)) {
    const cut = { axis: 'length' as const, offsetMm: size.lengthMm }
    const { first, second } = splitRect(region, cut, context.settings)
    if (second === null) {
      throw new RangeError('Cut must retain a waste region')
    }
    return {
      kind: 'cut',
      region,
      cut,
      first: trimmedLeaf(first, size, leaf, orientation, context),
      second: { kind: 'waste', region: second }
    }
  }
  if (toPositiveUm(size.widthMm) !== toPositiveUm(region.widthMm)) {
    const cut = { axis: 'width' as const, offsetMm: size.widthMm }
    const { first, second } = splitRect(region, cut, context.settings)
    if (second === null) {
      throw new RangeError('Cut must retain a waste region')
    }
    return {
      kind: 'cut',
      region,
      cut,
      first: trimmedLeaf(first, size, leaf, orientation, context),
      second: { kind: 'waste', region: second }
    }
  }
  return { ...leaf, region, orientation }
}

/** Immutable, constrained edits. Validate both the starting tree and every candidate before returning it. */
export function editCuttingTree(root: CuttingTreeNode, context: CuttingTreeContext, edit: CuttingTreeEdit): CuttingTreeEditResult {
  try {
    const before = validateCuttingTree(root, context)
    if (!before.valid) {
      return reject('The current cutting tree is invalid.', before.issues)
    }
    let candidate: CuttingTreeNode
    if (edit.kind === 'rotate') {
      const leaf = findLeaf(root, edit.copy)
      if (leaf === null) {
        return reject('The selected placed copy no longer exists.')
      }
      const part = context.parts.find(part => part.id === leaf.partId)
      if (part === undefined) {
        return reject('The part definition is missing.')
      }
      const orientation = leaf.orientation === 'normal' ? 'rotated' : 'normal'
      if (!getAllowedOrientations(part, context.panel.grainDirection).includes(orientation)) {
        return reject(part.grainDirection === 'none' || context.panel.grainDirection === 'none' ? 'This part forbids 90-degree rotation.' : 'The rotated grain would not match the panel grain.')
      }
      const size = getOrientedDimensions(part, orientation)
      const target = rotationRegions(root, leaf).regions.find(node => canTrim(size, node.region, context.settings.kerfMm))
      if (target === undefined) {
        return reject('Rotation cannot fit the reserved region with valid kerf cuts. Neighboring parts and margins cannot move.')
      }
      candidate = replace(root, target, trimmedLeaf(target.region, size, leaf, orientation, context))
    } else {
      if (sameCopy(edit.first, edit.second)) {
        return reject('Select two different placed copies to swap.')
      }
      const first = findLeaf(root, edit.first)
      const second = findLeaf(root, edit.second)
      if (first === null || second === null) {
        return reject('One of the selected placed copies no longer exists.')
      }
      const orientationIn = (leaf: PartLeaf, region: Rect): Orientation | undefined => {
        const part = context.parts.find(part => part.id === leaf.partId)
        if (part === undefined) {
          return undefined
        }
        const allowed = getAllowedOrientations(part, context.panel.grainDirection)
        const preferred = [leaf.orientation, leaf.orientation === 'normal' ? 'rotated' : 'normal'] as const
        return preferred.find(orientation => allowed.includes(orientation) && sameSize(getOrientedDimensions(part, orientation), region))
      }
      const firstOrientation = orientationIn(first, second.region)
      const secondOrientation = orientationIn(second, first.region)
      if (firstOrientation === undefined || secondOrientation === undefined) {
        return reject('Both copies must exactly fit the other cut region with permitted rotation and grain. Existing cuts cannot move during a swap.')
      }
      candidate = replace(replace(root, first, { ...second, region: first.region, orientation: secondOrientation }), second, { ...first, region: second.region, orientation: firstOrientation })
    }
    const after = validateCuttingTree(candidate, context)
    return after.valid ? { ok: true, tree: candidate } : reject('The proposed edit failed independent cutting-tree validation.', after.issues)
  } catch (cause) {
    return reject(cause instanceof Error ? cause.message : 'The cutting tree could not be validated.')
  }
}
