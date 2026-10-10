import { describe, expect, it } from 'vitest'
import { applyPlanEdit, createPlanEditingSession, currentEditingPlan, redoPlanEdit, resetPlanEdits, undoPlanEdit } from '../plan-editing-session'
import { rotationInput, rotationPlan, swapInput, swapPlan, swapFirst, swapSecond } from '../../../domain/cutting-tree/__tests__/editing-fixtures'
import { freezeDeep, viewerPart } from '../../../domain/cutting-tree/__tests__/viewer-fixtures'
import { validateCuttingTree } from '../../../domain/cutting-tree/validate-cutting-tree'
const edit = { kind: 'rotate' as const, copy: { partId: viewerPart.id, copyIndex: 0 } }
function setup() {
  const created = createPlanEditingSession(rotationPlan, rotationInput)
  if (!created.ok) throw new Error(created.error.message)
  return created.session
}
describe('Transient editing history', () => {
  it('owns snapshots and updates placements/metrics without mutating optimizer results or demand', () => {
    const original = structuredClone(rotationPlan)
    const session = setup()
    expect(session.optimizedPlan).not.toBe(rotationPlan)
    expect(session.input).not.toBe(rotationInput)
    freezeDeep(session)
    const next = applyPlanEdit(session, edit)
    if (!next.ok) throw new Error(next.error.message)
    const plan = currentEditingPlan(next.session)
    expect(plan.placements).toMatchObject([{ partId: viewerPart.id, copyIndex: 0, orientation: 'normal', dimensions: { lengthMm: 50, widthMm: 30, thicknessMm: 18 }, region: { xMm: 5, yMm: 5, lengthMm: 50, widthMm: 30 } }])
    expect(plan.metrics).toEqual(rotationPlan.metrics)
    expect(plan.unplaced).toEqual(rotationPlan.unplaced)
    expect(validateCuttingTree(plan.tree, session.input)).toEqual({ valid: true })
    expect(rotationPlan).toEqual(original)
    expect(session.cursor).toBe(0)
  })
  it('undoes and redoes exact accepted plans, and reset clears all history', () => {
    const session = setup()
    const next = applyPlanEdit(session, edit)
    if (!next.ok) throw new Error(next.error.message)
    const undone = undoPlanEdit(next.session)
    expect(currentEditingPlan(undone)).toEqual(rotationPlan)
    const redone = redoPlanEdit(undone)
    expect(currentEditingPlan(redone)).toEqual(currentEditingPlan(next.session))
    const reset = resetPlanEdits(redone)
    expect(currentEditingPlan(reset)).toEqual(rotationPlan)
    expect(reset.history).toHaveLength(1)
    expect(undoPlanEdit(reset)).toBe(reset)
    expect(redoPlanEdit(reset)).toBe(reset)
  })
  it('discards redo after a new accepted edit, but retains history on rejected edits', () => {
    const first = applyPlanEdit(setup(), edit)
    if (!first.ok) throw new Error(first.error.message)
    const undone = undoPlanEdit(first.session)
    const rejected = applyPlanEdit(undone, { ...edit, copy: { ...edit.copy, copyIndex: 99 } })
    expect(rejected.ok).toBe(false)
    expect(undone.history).toHaveLength(2)
    const branched = applyPlanEdit(undone, edit)
    if (!branched.ok) throw new Error(branched.error.message)
    expect(branched.session.history).toHaveLength(2)
    expect(branched.session.history[1]).not.toBe(first.session.history[1])
    expect(redoPlanEdit(branched.session)).toBe(branched.session)
  })
  it('tracks swaps without losing identities or quantities', () => {
    const created = createPlanEditingSession(swapPlan, swapInput)
    if (!created.ok) throw new Error(created.error.message)
    const next = applyPlanEdit(created.session, { kind: 'swap', first: { partId: swapFirst.id, copyIndex: 0 }, second: { partId: swapSecond.id, copyIndex: 0 } })
    if (!next.ok) throw new Error(next.error.message)
    expect(currentEditingPlan(next.session).placements.map(part => part.partId)).toEqual([swapSecond.id, swapFirst.id])
    expect(currentEditingPlan(next.session).metrics).toEqual(swapPlan.metrics)
    expect(currentEditingPlan(undoPlanEdit(next.session))).toEqual(swapPlan)
  })
  it('does not initialize invalid plans', () => {
    const invalid = { ...rotationPlan, tree: { ...rotationPlan.tree, region: { xMm: 6, yMm: 5, lengthMm: 90, widthMm: 70 } } }
    expect(createPlanEditingSession(invalid, rotationInput)).toMatchObject({ ok: false })
  })
  it('retains unplaced demand and reason through edits, undo and reset', () => {
    const input = { ...rotationInput, parts: rotationInput.parts.map(part => ({ ...part, quantity: 3 })) }
    const plan = { ...rotationPlan, unplaced: [{ partId: viewerPart.id, firstCopyIndex: 1, count: 2, reason: { kind: 'noSpaceLeft' as const } }] }
    const original = structuredClone(plan)
    freezeDeep(plan)
    const created = createPlanEditingSession(plan, input)
    if (!created.ok) throw new Error(created.error.message)
    const next = applyPlanEdit(created.session, edit)
    if (!next.ok) throw new Error(next.error.message)
    expect(currentEditingPlan(next.session).unplaced).toEqual(original.unplaced)
    expect(currentEditingPlan(undoPlanEdit(next.session)).unplaced).toEqual(original.unplaced)
    expect(currentEditingPlan(resetPlanEdits(next.session)).unplaced).toEqual(original.unplaced)
    expect(plan).toEqual(original)
  })
})
