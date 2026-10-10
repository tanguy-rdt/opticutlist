import { describe, expect, it } from 'vitest'
import { editCuttingTree } from '../edit-cutting-tree'
import { validateCuttingTree } from '../validate-cutting-tree'
import { materialIdSchema } from '../../model/ids'
import { viewerPart, freezeDeep, viewerPlan } from './viewer-fixtures'
import { rotationInput, rotationPlan, swapFirst, swapSecond, swapInput, swapTree } from './editing-fixtures'
const rotate = { kind: 'rotate' as const, copy: { partId: viewerPart.id, copyIndex: 0 } }
const swap = { kind: 'swap' as const, first: { partId: swapFirst.id, copyIndex: 0 }, second: { partId: swapSecond.id, copyIndex: 0 } }
describe('Constrained immutable tree edits', () => {
  it('rotates a rectangle within exclusive waste using valid guillotine cuts and the same anchor', () => {
    const root = structuredClone(rotationPlan.tree)
    const input = structuredClone(rotationInput)
    freezeDeep(root); freezeDeep(input)
    const result = editCuttingTree(root, input, rotate)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    expect(validateCuttingTree(result.tree, input)).toEqual({ valid: true })
    expect(result.tree).toEqual({
      kind: 'cut', region: { xMm: 5, yMm: 5, lengthMm: 90, widthMm: 70 }, cut: { axis: 'length', offsetMm: 50 },
      first: { kind: 'cut', region: { xMm: 5, yMm: 5, lengthMm: 50, widthMm: 70 }, cut: { axis: 'width', offsetMm: 30 },
        first: { kind: 'part', region: { xMm: 5, yMm: 5, lengthMm: 50, widthMm: 30 }, partId: viewerPart.id, copyIndex: 0, orientation: 'normal' },
        second: { kind: 'waste', region: { xMm: 5, yMm: 37, lengthMm: 50, widthMm: 38 } } },
      second: { kind: 'waste', region: { xMm: 57, yMm: 5, lengthMm: 38, widthMm: 70 } },
    })
    expect(root).toEqual(rotationPlan.tree)
  })
  it('rotates squares in place and preserves quantity and copy identity', () => {
    const input = { panel: { ...rotationInput.panel, lengthMm: 40, widthMm: 40 }, parts: [{ ...viewerPart, lengthMm: 30, widthMm: 30 }], settings: { kerfMm: 2, edgeMarginMm: 5 } }
    const root = { kind: 'part' as const, region: { xMm: 5, yMm: 5, lengthMm: 30, widthMm: 30 }, partId: viewerPart.id, copyIndex: 0, orientation: 'normal' as const }
    expect(editCuttingTree(root, input, rotate)).toEqual({ ok: true, tree: { ...root, orientation: 'rotated' } })
    const forbidden = { ...input, parts: [{ ...input.parts[0], ...viewerPart, lengthMm: 30, widthMm: 30, rotation: 'forbidden' as const }] }
    expect(editCuttingTree(root, forbidden, rotate)).toMatchObject({ ok: false, error: { message: 'This part forbids 90-degree rotation.' } })
  })
  it('rejects grain-incompatible rotation without modifying the tree', () => {
    const original = structuredClone(viewerPlan.tree)
    expect(editCuttingTree(original, { ...rotationInput, panel: { ...rotationInput.panel, grainDirection: 'width' } }, rotate)).toMatchObject({ ok: false, error: { message: 'The rotated grain would not match the panel grain.' } })
    expect(original).toEqual(viewerPlan.tree)
  })
  it('does not borrow a neighboring part’s region to permit rotation', () => {
    const before = structuredClone(swapTree)
    const result = editCuttingTree(swapTree, swapInput, { kind: 'rotate', copy: swap.first })
    if (result.ok) throw new Error('Unexpected accepted rotation')
    expect(result.error.message).toContain('reserved region')
    expect(swapTree).toEqual(before)
  })
  it('rejects a geometrically fitting rotation with an uncuttable kerf remainder', () => {
    const root = { kind: 'cut' as const, region: { xMm: 0, yMm: 0, lengthMm: 30, widthMm: 32 }, cut: { axis: 'width' as const, offsetMm: 28 },
      first: { kind: 'part' as const, region: { xMm: 0, yMm: 0, lengthMm: 30, widthMm: 28 }, partId: viewerPart.id, copyIndex: 0, orientation: 'normal' as const },
      second: { kind: 'waste' as const, region: { xMm: 0, yMm: 30, lengthMm: 30, widthMm: 2 } } }
    const input = { ...rotationInput, panel: { ...rotationInput.panel, lengthMm: 30, widthMm: 32 }, parts: [{ ...viewerPart, lengthMm: 30, widthMm: 28 }], settings: { edgeMarginMm: 0, kerfMm: 2 } }
    expect(validateCuttingTree(root, input)).toEqual({ valid: true })
    expect(editCuttingTree(root, input, rotate)).toMatchObject({ ok: false })
  })
  it('swaps compatible rectangles with allowed destination orientations and unchanged cuts', () => {
    const result = editCuttingTree(swapTree, swapInput, swap)
    if (!result.ok) throw new Error(result.error.message)
    expect(validateCuttingTree(result.tree, swapInput)).toEqual({ valid: true })
    expect(result.tree).toMatchObject({ kind: 'cut', region: { xMm: 5, yMm: 5, lengthMm: 80, widthMm: 50 }, cut: { axis: 'length', offsetMm: 30 },
      first: { kind: 'part', partId: swapSecond.id, copyIndex: 0, orientation: 'rotated', region: { xMm: 5, yMm: 5, lengthMm: 30, widthMm: 50 } },
      second: { kind: 'cut', cut: { axis: 'width', offsetMm: 30 }, first: { kind: 'part', partId: swapFirst.id, copyIndex: 0, orientation: 'rotated', region: { xMm: 35, yMm: 5, lengthMm: 50, widthMm: 30 } } } })
  })
  it('recuts only the selected copy’s private region while retaining neighboring cuts and copies', () => {
    const result = editCuttingTree(swapTree, swapInput, { kind: 'rotate', copy: swap.second })
    if (!result.ok || result.tree.kind !== 'cut' || swapTree.kind !== 'cut') throw new Error('Unexpected rejection')
    expect(validateCuttingTree(result.tree, swapInput)).toEqual({ valid: true })
    expect(result.tree.first).toBe(swapTree.first)
    expect(result.tree.cut).toBe(swapTree.cut)
    expect(result.tree.second).toMatchObject({ kind: 'cut', region: { xMm: 35, yMm: 5, lengthMm: 50, widthMm: 50 }, cut: { axis: 'length', offsetMm: 30 }, first: { kind: 'part', region: { xMm: 35, yMm: 5, lengthMm: 30, widthMm: 50 }, partId: swapSecond.id, copyIndex: 0, orientation: 'rotated' } })
  })
  it('swaps copies of the same part without duplicating or losing quantity identities', () => {
    if (swapTree.kind !== 'cut' || swapTree.second.kind !== 'cut') throw new Error('Unexpected fixture')
    const root = { ...swapTree, second: { ...swapTree.second, first: { ...swapTree.second.first, partId: swapFirst.id, copyIndex: 1, orientation: 'rotated' as const } } }
    const input = { ...swapInput, parts: [{ ...swapFirst, quantity: 2 }] }
    const result = editCuttingTree(root, input, { ...swap, second: { partId: swapFirst.id, copyIndex: 1 } })
    if (!result.ok) throw new Error(result.error.message)
    expect(validateCuttingTree(result.tree, input)).toEqual({ valid: true })
    expect(result.tree).toMatchObject({ first: { partId: swapFirst.id, copyIndex: 1, orientation: 'normal' }, second: { first: { partId: swapFirst.id, copyIndex: 0, orientation: 'rotated' } } })
  })
  it('rejects swaps requiring forbidden rotation or conflicting grain', () => {
    const forbidden = { ...swapInput, parts: swapInput.parts.map(part => ({ ...part, rotation: 'forbidden' as const })) }
    expect(validateCuttingTree(swapTree, forbidden)).toEqual({ valid: true })
    expect(editCuttingTree(swapTree, forbidden, swap)).toMatchObject({ ok: false })
    const grain = { ...swapInput, panel: { ...swapInput.panel, grainDirection: 'length' as const }, parts: swapInput.parts.map(part => ({ ...part, grainDirection: 'length' as const })) }
    expect(validateCuttingTree(swapTree, grain)).toEqual({ valid: true })
    expect(editCuttingTree(swapTree, grain, swap)).toMatchObject({ ok: false })
  })
  it('rejects incompatible sizes even when the second copy fits its own reserved region', () => {
    if (swapTree.kind !== 'cut' || swapTree.second.kind !== 'cut') throw new Error('Unexpected fixture')
    const root = { ...swapTree, second: { ...swapTree.second, cut: { axis: 'width' as const, offsetMm: 20 }, first: { ...swapTree.second.first, region: { xMm: 35, yMm: 5, lengthMm: 50, widthMm: 20 } }, second: { kind: 'waste' as const, region: { xMm: 35, yMm: 25, lengthMm: 50, widthMm: 30 } } } }
    const input = { ...swapInput, parts: [swapFirst, { ...swapSecond, widthMm: 20 }] }
    expect(validateCuttingTree(root, input)).toEqual({ valid: true })
    expect(editCuttingTree(root, input, swap)).toMatchObject({ ok: false })
  })
  it.each([
    { label: 'thickness', input: { ...swapInput, parts: [swapFirst, { ...swapSecond, thicknessMm: 18.000001 }] } },
    { label: 'material', input: { ...swapInput, parts: [swapFirst, { ...swapSecond, materialId: materialIdSchema.parse('other-material') }] } },
    { label: 'margins', input: { ...swapInput, settings: { ...swapInput.settings, edgeMarginMm: 6 } } },
    { label: 'kerf', input: { ...swapInput, settings: { ...swapInput.settings, kerfMm: 1 } } },
  ])('refuses editing a plan that violates $label', ({ input }) => {
    const original = structuredClone(swapTree)
    expect(editCuttingTree(original, input, swap)).toMatchObject({ ok: false, error: { message: 'The current cutting tree is invalid.' } })
    expect(original).toEqual(swapTree)
  })
  it('rejects missing copies, same-copy swaps and corrupt guillotine cuts', () => {
    expect(editCuttingTree(swapTree, swapInput, { ...swap, second: swap.first })).toMatchObject({ ok: false })
    expect(editCuttingTree(rotationPlan.tree, rotationInput, { ...rotate, copy: { ...rotate.copy, copyIndex: 1 } })).toMatchObject({ ok: false })
    if (swapTree.kind !== 'cut') throw new Error('Unexpected fixture')
    expect(editCuttingTree({ ...swapTree, cut: { axis: 'length', offsetMm: 90 } }, swapInput, swap)).toMatchObject({ ok: false })
  })
})
