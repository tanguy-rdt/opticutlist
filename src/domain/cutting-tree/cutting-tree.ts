import type { PartId } from '../model/ids'
import type { Orientation } from '../geometry/part-orientation'
import type { GuillotineCut, Rect } from '../geometry/rect'

/**
 * Guillotine cutting tree for one panel.
 *
 * The root region is the panel's usable area (inside the edge margins). Each cut node splits its
 * region with one edge-to-edge cut into exactly two child regions separated by the saw kerf
 * (see `splitRect`). Leaves are either one placed copy of a part or waste.
 *
 * Every node stores its region explicitly so the validator can check it against the region
 * implied by its ancestors' cuts instead of trusting it.
 * Cut axis `length` is a cut line across the panel length (x); `width` is a cut line across the width (y).
 */
export type CuttingTreeNode = CutNode | PartLeaf | WasteLeaf

export interface CutNode {
  readonly kind: 'cut'
  readonly region: Rect
  readonly cut: GuillotineCut
  /** Region before the kerf: [start, offset). */
  readonly first: CuttingTreeNode
  /** Region after the kerf: [offset + kerf, end). */
  readonly second: CuttingTreeNode
}

export interface PartLeaf {
  readonly kind: 'part'
  readonly region: Rect
  readonly partId: PartId
  /** Which copy of the part (0 ≤ copyIndex < quantity) this leaf produces. */
  readonly copyIndex: number
  readonly orientation: Orientation
}

export interface WasteLeaf {
  readonly kind: 'waste'
  readonly region: Rect
}

/** Location of a node: the child branches taken from the root. */
export type TreePath = readonly ('first' | 'second')[]
