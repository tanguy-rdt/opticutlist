import { describe, expect, it } from 'vitest'

import type { Orientation } from '../../geometry/part-orientation'
import type { Rect } from '../../geometry/rect'
import { partIdSchema } from '../../model/ids'
import { partSchema } from '../../model/part'
import { stockItemSchema } from '../../model/stock-item'
import { supplierProductSchema } from '../../model/supplier-product'
import { validPartInput, validStockItemInput, validSupplierProductInput } from '../../model/__tests__/fixtures'
import type { CutNode, CuttingTreeNode, PartLeaf, WasteLeaf } from '../cutting-tree'
import { validateCuttingTree, type CuttingTreeContext, type CuttingTreeValidation } from '../validate-cutting-tree'

// Panel: 2500 × 1250 × 18 birch, grain along length. Usable area with 10 mm margins: (10, 10, 2480 × 1230).
const panel = supplierProductSchema.parse(validSupplierProductInput)
const settings = { kerfMm: 3.2, edgeMarginMm: 10 }

// 720 × 560 × 18, grain along length, rotation forbidden, quantity 2.
const side = partSchema.parse(validPartInput)
// 400 × 300 × 18, no grain, rotation allowed, quantity 1.
const shelf = partSchema.parse({
  ...validPartInput,
  id: 'part-shelf',
  name: 'Shelf',
  lengthMm: 400,
  widthMm: 300,
  quantity: 1,
  grainDirection: 'none',
  rotation: 'allowed',
})

const context: CuttingTreeContext = { panel, parts: [side, shelf], settings }

function r(xMm: number, yMm: number, lengthMm: number, widthMm: number): Rect {
  return { xMm, yMm, lengthMm, widthMm }
}

function waste(region: Rect): WasteLeaf {
  return { kind: 'waste', region }
}

function place(region: Rect, partId: string, copyIndex = 0, orientation: Orientation = 'normal'): PartLeaf {
  return { kind: 'part', region, partId: partIdSchema.parse(partId), copyIndex, orientation }
}

function cut(
  region: Rect,
  axis: 'length' | 'width',
  offsetMm: number,
  first: CuttingTreeNode,
  second: CuttingTreeNode,
): CutNode {
  return { kind: 'cut', region, cut: { axis, offsetMm }, first, second }
}

function kinds(result: CuttingTreeValidation): string[] {
  return result.valid ? [] : result.issues.map((issue) => issue.kind)
}

const usable = r(10, 10, 2480, 1230)

/** Two side panels and one rotated shelf, every remaining area explicitly waste. */
function validTree(): CutNode {
  return cut(
    usable,
    'length',
    720,
    cut(
      r(10, 10, 720, 1230),
      'width',
      560,
      place(r(10, 10, 720, 560), side.id, 0),
      cut(
        r(10, 573.2, 720, 666.8),
        'width',
        560,
        place(r(10, 573.2, 720, 560), side.id, 1),
        waste(r(10, 1136.4, 720, 103.6)),
      ),
    ),
    cut(
      r(733.2, 10, 1756.8, 1230),
      'length',
      300,
      cut(
        r(733.2, 10, 300, 1230),
        'width',
        400,
        place(r(733.2, 10, 300, 400), shelf.id, 0, 'rotated'),
        waste(r(733.2, 413.2, 300, 826.8)),
      ),
      waste(r(1036.4, 10, 1453.6, 1230)),
    ),
  )
}

describe('validateCuttingTree', () => {
  describe('valid trees', () => {
    it('accepts a complete tree with parts, rotation and waste', () => {
      expect(validateCuttingTree(validTree(), context)).toEqual({ valid: true })
    })

    it('accepts an empty panel as a single waste leaf', () => {
      expect(validateCuttingTree(waste(usable), context)).toEqual({ valid: true })
    })

    it('accepts a part filling the usable area exactly', () => {
      const full = partSchema.parse({ ...validPartInput, lengthMm: 2480, widthMm: 1230, quantity: 1 })

      expect(validateCuttingTree(place(usable, full.id), { ...context, parts: [full] })).toEqual({ valid: true })
    })

    it('uses the whole panel without margins', () => {
      const tree = cut(r(0, 0, 2500, 1250), 'length', 720, waste(r(0, 0, 720, 1250)), waste(r(723.2, 0, 1776.8, 1250)))

      expect(validateCuttingTree(tree, { ...context, settings: { kerfMm: 3.2, edgeMarginMm: 0 } })).toEqual({ valid: true })
    })

    it('accepts zero kerf with touching children', () => {
      const tree = cut(usable, 'width', 615, waste(r(10, 10, 2480, 615)), waste(r(10, 625, 2480, 615)))

      expect(validateCuttingTree(tree, { ...context, settings: { kerfMm: 0, edgeMarginMm: 10 } })).toEqual({ valid: true })
    })

    it('keeps decimal kerf arithmetic exact', () => {
      // 2480 − 100.1 − 3.2 = 2376.7 exactly; plain floating point drifts.
      const tree = cut(usable, 'length', 100.1, waste(r(10, 10, 100.1, 1230)), waste(r(113.3, 10, 2376.7, 1230)))

      expect(validateCuttingTree(tree, context)).toEqual({ valid: true })
    })

    it('accepts a remainder of 0.001 mm after the kerf', () => {
      const tree = cut(usable, 'length', 2476.799, waste(r(10, 10, 2476.799, 1230)), waste(r(2489.999, 10, 0.001, 1230)))

      expect(validateCuttingTree(tree, context)).toEqual({ valid: true })
    })

    it('allows rotating a grained part on a grainless panel', () => {
      const mdf = supplierProductSchema.parse({ ...validSupplierProductInput, grainDirection: 'none' })
      const long = partSchema.parse({ ...validPartInput, lengthMm: 1230, rotation: 'allowed', quantity: 1 })
      const tree = cut(usable, 'length', 560, place(r(10, 10, 560, 1230), long.id, 0, 'rotated'), waste(r(573.2, 10, 1916.8, 1230)))

      expect(validateCuttingTree(tree, { panel: mdf, parts: [long], settings })).toEqual({ valid: true })
      // The same rotation on the length-grained panel would put the grain across the panel grain.
      expect(kinds(validateCuttingTree(tree, { ...context, parts: [long] }))).toEqual(['orientationNotAllowed'])
    })

    it('validates trees on owned stock', () => {
      const offcut = stockItemSchema.parse(validStockItemInput) // 800 × 400.5, grain along length
      const tree = cut(
        r(0, 0, 800, 400.5),
        'length',
        720,
        cut(r(0, 0, 720, 400.5), 'width', 300, waste(r(0, 0, 720, 300)), waste(r(0, 303.2, 720, 97.3))),
        waste(r(723.2, 0, 76.8, 400.5)),
      )

      expect(validateCuttingTree(tree, { panel: offcut, parts: [], settings: { kerfMm: 3.2, edgeMarginMm: 0 } })).toEqual({
        valid: true,
      })
    })

    it('is deterministic', () => {
      const broken = cut(usable, 'length', 0, waste(usable), place(usable, 'missing'))

      expect(validateCuttingTree(broken, context)).toEqual(validateCuttingTree(broken, context))
    })
  })

  describe('margins and root region', () => {
    it('rejects a root region reaching into the margins', () => {
      const result = validateCuttingTree(waste(r(0, 0, 2500, 1250)), context)

      expect(result).toEqual({ valid: false, issues: [{ kind: 'regionOutOfBounds', bounds: usable, path: [] }] })
    })

    it('rejects a root region smaller than the usable area', () => {
      const result = validateCuttingTree(waste(r(10, 10, 2479.999, 1230)), context)

      expect(result).toEqual({ valid: false, issues: [{ kind: 'missingRegion', expected: usable, path: [] }] })
    })

    it('reports both problems for a shifted root region', () => {
      expect(kinds(validateCuttingTree(waste(r(11, 10, 2480, 1230)), context))).toEqual(['regionOutOfBounds', 'missingRegion'])
    })

    it('reports a panel whose margins leave no usable area', () => {
      const result = validateCuttingTree(waste(r(625, 625, 1250, 1)), { ...context, settings: { kerfMm: 3, edgeMarginMm: 625 } })

      expect(result).toEqual({ valid: false, issues: [{ kind: 'noUsableArea', edgeMarginMm: 625, path: [] }] })
    })
  })

  describe('invalid dimensions', () => {
    it.each([
      ['zero length', r(10, 10, 0, 1230)],
      ['negative width', r(10, 10, 2480, -1)],
      ['NaN coordinate', r(Number.NaN, 10, 2480, 1230)],
      ['negative coordinate', r(-10, 10, 2480, 1230)],
      ['infinite length', r(10, 10, Number.POSITIVE_INFINITY, 1230)],
      ['sub-micrometre width', r(10, 10, 2480, 0.0004)],
    ])('reports %s', (_label, region) => {
      expect(validateCuttingTree(waste(region), context)).toEqual({
        valid: false,
        issues: [{ kind: 'invalidRegion', region, path: [] }],
      })
    })

    it('keeps validating children of a node with an invalid region', () => {
      const tree = cut(r(10, 10, Number.NaN, 1230), 'length', 720, waste(r(10, 10, 720, 1230)), place(usable, 'unknown'))

      expect(validateCuttingTree(tree, context)).toMatchObject({
        valid: false,
        issues: [
          { kind: 'invalidRegion', path: [] },
          { kind: 'unknownPart', path: ['second'] },
        ],
      })
    })
  })

  describe('cuts', () => {
    it.each([0, -5, 2480, 2500])('rejects offset %d outside the region', (offsetMm) => {
      const result = validateCuttingTree(cut(usable, 'length', offsetMm, waste(usable), waste(usable)), context)

      expect(result).toEqual({
        valid: false,
        issues: [{ kind: 'cutOutOfBounds', offsetMm, extentMm: 2480, path: [] }],
      })
    })

    it('checks offsets against the width for width cuts', () => {
      const result = validateCuttingTree(cut(usable, 'width', 1230, waste(usable), waste(usable)), context)

      expect(result).toMatchObject({ valid: false, issues: [{ kind: 'cutOutOfBounds', extentMm: 1230 }] })
    })

    it.each([Number.NaN, Number.POSITIVE_INFINITY])('rejects non-finite offset %d', (offsetMm) => {
      expect(kinds(validateCuttingTree(cut(usable, 'length', offsetMm, waste(usable), waste(usable)), context))).toEqual([
        'invalidCutOffset',
      ])
    })

    it.each([2476.8, 2478])('rejects a cut at %d mm whose kerf consumes the rest', (offsetMm) => {
      const result = validateCuttingTree(cut(usable, 'length', offsetMm, waste(r(10, 10, offsetMm, 1230)), waste(usable)), context)

      expect(result).toEqual({
        valid: false,
        issues: [{ kind: 'cutLeavesNoRemainder', offsetMm, kerfMm: 3.2, extentMm: 2480, path: [] }],
      })
    })
  })

  describe('child regions', () => {
    const first = r(10, 10, 720, 1230)
    const second = r(733.2, 10, 1756.8, 1230)

    it('rejects a second child overlapping the kerf', () => {
      const result = validateCuttingTree(cut(usable, 'length', 720, waste(first), waste(r(730, 10, 1760, 1230))), context)

      expect(result).toEqual({ valid: false, issues: [{ kind: 'regionOverlap', expected: second, path: ['second'] }] })
    })

    it('rejects a first child overlapping its sibling', () => {
      const result = validateCuttingTree(cut(usable, 'length', 720, waste(r(10, 10, 800, 1230)), waste(second)), context)

      expect(result).toEqual({ valid: false, issues: [{ kind: 'regionOverlap', expected: first, path: ['first'] }] })
    })

    it('rejects a child reaching outside its parent', () => {
      const result = validateCuttingTree(cut(usable, 'length', 720, waste(r(10, 10, 720, 1240)), waste(second)), context)

      expect(result).toEqual({ valid: false, issues: [{ kind: 'regionOutOfBounds', bounds: usable, path: ['first'] }] })
    })

    it('reports a gap left between the kerf and the second child', () => {
      const result = validateCuttingTree(cut(usable, 'length', 720, waste(first), waste(r(740, 10, 1750, 1230))), context)

      expect(result).toEqual({ valid: false, issues: [{ kind: 'missingRegion', expected: second, path: ['second'] }] })
    })

    it('reports a child that does not cover its slot', () => {
      const result = validateCuttingTree(cut(usable, 'length', 720, waste(r(10, 10, 720, 1229.999)), waste(second)), context)

      expect(result).toMatchObject({ valid: false, issues: [{ kind: 'missingRegion', path: ['first'] }] })
    })

    it('rejects swapped children', () => {
      const result = validateCuttingTree(cut(usable, 'length', 720, waste(second), waste(first)), context)

      expect(kinds(result)).toEqual(['regionOverlap', 'missingRegion', 'regionOverlap', 'missingRegion'])
    })

    it('validates nested regions against their own parent', () => {
      const tree = validTree()
      const broken = { ...tree, first: { ...tree.first, first: waste(r(10, 10, 720, 563.2)) } } as CutNode

      expect(validateCuttingTree(broken, context)).toMatchObject({
        valid: false,
        issues: [{ kind: 'regionOverlap', path: ['first', 'first'] }],
      })
    })

    it('reports a node object used twice instead of revisiting it', () => {
      const shared = waste(first)

      expect(validateCuttingTree(cut(usable, 'length', 720, shared, shared), context)).toMatchObject({
        valid: false,
        issues: [{ kind: 'reusedNode', path: ['second'] }],
      })
    })

    it('terminates on cyclic trees', () => {
      type MutableCut = { -readonly [K in keyof CutNode]: CutNode[K] }
      const loop: MutableCut = { kind: 'cut', region: usable, cut: { axis: 'length', offsetMm: 720 }, first: waste(first), second: waste(second) }
      loop.second = loop

      expect(kinds(validateCuttingTree(loop, context))).toEqual(['reusedNode'])
    })
  })

  describe('part placements', () => {
    /** Places `leaf` as the first child of a 720 mm length cut on the usable area. */
    function withLeaf(leaf: PartLeaf): CutNode {
      return cut(usable, 'length', leaf.region.lengthMm, leaf, waste(r(10 + leaf.region.lengthMm + 3.2, 10, 2480 - leaf.region.lengthMm - 3.2, 1230)))
    }

    it('rejects a duplicate placement of the same copy', () => {
      const tree = cut(
        r(10, 10, 720, 1230),
        'width',
        560,
        place(r(10, 10, 720, 560), side.id, 1),
        cut(r(10, 573.2, 720, 666.8), 'width', 560, place(r(10, 573.2, 720, 560), side.id, 1), waste(r(10, 1136.4, 720, 103.6))),
      )
      const result = validateCuttingTree(cut(usable, 'length', 720, tree, waste(r(733.2, 10, 1756.8, 1230))), context)

      expect(result).toEqual({
        valid: false,
        issues: [
          {
            kind: 'duplicatePlacement',
            partId: side.id,
            copyIndex: 1,
            firstPath: ['first', 'first'],
            path: ['first', 'second', 'first'],
          },
        ],
      })
    })

    it.each([2, -1, 0.5, Number.NaN])('rejects copy index %d for quantity 2', (copyIndex) => {
      const tall = partSchema.parse({ ...validPartInput, widthMm: 1230 })
      const result = validateCuttingTree(withLeaf(place(r(10, 10, 720, 1230), tall.id, copyIndex)), { ...context, parts: [tall] })

      expect(result).toMatchObject({ valid: false, issues: [{ kind: 'invalidCopyIndex', copyIndex, quantity: 2 }] })
    })

    it('rejects an unknown part', () => {
      const result = validateCuttingTree(withLeaf(place(r(10, 10, 720, 1230), 'part-ghost')), context)

      expect(result).toMatchObject({ valid: false, issues: [{ kind: 'unknownPart', partId: 'part-ghost', path: ['first'] }] })
    })

    it('rejects a part region larger than the part', () => {
      const result = validateCuttingTree(withLeaf(place(r(10, 10, 720, 1230), side.id)), context)

      expect(result).toEqual({
        valid: false,
        issues: [
          {
            kind: 'partSizeMismatch',
            expected: { lengthMm: 720, widthMm: 560 },
            actual: { lengthMm: 720, widthMm: 1230 },
            path: ['first'],
          },
        ],
      })
    })

    it('rejects a part region 0.001 mm too small', () => {
      const tight = partSchema.parse({ ...validPartInput, widthMm: 1230.001 })

      expect(kinds(validateCuttingTree(withLeaf(place(r(10, 10, 720, 1230), tight.id)), { ...context, parts: [tight] }))).toEqual([
        'partSizeMismatch',
      ])
    })

    it('preserves thickness: rejects a part 0.001 mm thicker than the panel', () => {
      const thick = partSchema.parse({ ...validPartInput, widthMm: 1230, thicknessMm: 18.001 })
      const result = validateCuttingTree(withLeaf(place(r(10, 10, 720, 1230), thick.id)), { ...context, parts: [thick] })

      expect(result).toEqual({
        valid: false,
        issues: [{ kind: 'thicknessMismatch', expectedMm: 18.001, actualMm: 18, path: ['first'] }],
      })
    })

    it('rejects a part of another material', () => {
      const oak = partSchema.parse({ ...validPartInput, widthMm: 1230, materialId: 'mat-oak' })

      expect(kinds(validateCuttingTree(withLeaf(place(r(10, 10, 720, 1230), oak.id)), { ...context, parts: [oak] }))).toEqual([
        'materialMismatch',
      ])
    })

    it('rejects rotation when the part forbids it', () => {
      const square = partSchema.parse({ ...validPartInput, lengthMm: 1230, widthMm: 1230, grainDirection: 'none' })
      const result = validateCuttingTree(withLeaf(place(r(10, 10, 1230, 1230), square.id, 0, 'rotated')), { ...context, parts: [square] })

      // The square region matches either way; only the orientation is wrong.
      expect(result).toEqual({
        valid: false,
        issues: [{ kind: 'orientationNotAllowed', orientation: 'rotated', allowed: ['normal'], path: ['first'] }],
      })
    })

    it('rejects rotation against the panel grain even when rotation is allowed', () => {
      const square = partSchema.parse({ ...validPartInput, lengthMm: 1230, widthMm: 1230, rotation: 'allowed' })
      const result = validateCuttingTree(withLeaf(place(r(10, 10, 1230, 1230), square.id, 0, 'rotated')), { ...context, parts: [square] })

      expect(result).toMatchObject({ valid: false, issues: [{ kind: 'orientationNotAllowed', allowed: ['normal'] }] })
    })

    it('reports a part whose grain requires a forbidden rotation', () => {
      const crossGrain = partSchema.parse({ ...validPartInput, widthMm: 1230, grainDirection: 'width' })
      const result = validateCuttingTree(withLeaf(place(r(10, 10, 720, 1230), crossGrain.id)), { ...context, parts: [crossGrain] })

      expect(result).toMatchObject({ valid: false, issues: [{ kind: 'orientationNotAllowed', orientation: 'normal', allowed: [] }] })
    })

    it('reports a rotated part whose region was not rotated', () => {
      const tree = cut(
        usable,
        'length',
        400,
        cut(r(10, 10, 400, 1230), 'width', 300, place(r(10, 10, 400, 300), shelf.id, 0, 'rotated'), waste(r(10, 313.2, 400, 926.8))),
        waste(r(413.2, 10, 2076.8, 1230)),
      )

      expect(validateCuttingTree(tree, context)).toMatchObject({
        valid: false,
        issues: [{ kind: 'partSizeMismatch', expected: { lengthMm: 300, widthMm: 400 }, path: ['first', 'first'] }],
      })
    })
  })

  describe('reporting', () => {
    it('reports every issue in depth-first order with paths', () => {
      const tree = cut(
        usable,
        'length',
        720,
        cut(r(10, 10, 720, 1230), 'width', 0, waste(r(10, 10, 720, 1)), waste(r(10, 10, 720, 1))),
        place(r(733.2, 10, 1756.8, 1230), 'part-ghost'),
      )

      const result = validateCuttingTree(tree, context)

      expect(result.valid).toBe(false)
      expect(result.valid ? [] : result.issues.map(({ kind, path }) => ({ kind, path }))).toEqual([
        { kind: 'cutOutOfBounds', path: ['first'] },
        { kind: 'unknownPart', path: ['second'] },
      ])
    })

    it('throws for duplicate part IDs in the context', () => {
      expect(() => validateCuttingTree(waste(usable), { ...context, parts: [side, side] })).toThrow(/Duplicate part ID/)
    })
  })
})
