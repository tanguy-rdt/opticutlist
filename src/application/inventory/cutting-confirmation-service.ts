import { isCompatible } from '../../domain/compatibility'
import { toPositiveUm } from '../../domain/geometry/units'
import type { Rect } from '../../domain/geometry/rect'
import type { CuttingProjectId, SavedCuttingPlanId } from '../../domain/model/ids'
import { stockItemIdSchema } from '../../domain/model/ids'
import type { PanelSnapshot } from '../../domain/model/saved-cutting-plan'
import type { StockItem } from '../../domain/model/stock-item'
import { stockItemSchema } from '../../domain/model/stock-item'
import { confirmCuttingInputSchema, cuttingConfirmationSchema, type CuttingConfirmation } from '../../domain/model/cutting-confirmation'
import type { LocalPersistence, PersistenceResult, Repositories } from '../persistence/repositories'
import { readSavedPlan, type OpenedSavedPlan } from '../plans/saved-plan-service'
import { createCuttingPlanScene } from '../optimization/cutting-plan-scene'

export interface OffcutCandidate { readonly panelIndex: number; readonly wasteIndex: number; readonly region: Rect; readonly panel: PanelSnapshot; readonly materialName: string }
export interface CuttingPreview { readonly saved: OpenedSavedPlan; readonly stock: readonly StockItem[]; readonly offcuts: readonly OffcutCandidate[]; readonly confirmation: CuttingConfirmation | null }
export function stockMatchesPanel(stock: StockItem, panel: PanelSnapshot): boolean {
  return isCompatible(stock, panel) && stock.grainDirection === panel.grainDirection &&
    toPositiveUm(stock.lengthMm) === toPositiveUm(panel.lengthMm) && toPositiveUm(stock.widthMm) === toPositiveUm(panel.widthMm)
}
function conflict(message: string): Extract<PersistenceResult<never>, { ok: false }> { return { ok: false, error: { kind: 'referenceConflict', message } } }
function invalid(message: string): Extract<PersistenceResult<never>, { ok: false }> { return { ok: false, error: { kind: 'invalidRecord', issues: [{ path: ['plan'], message }] } } }
export function cuttingOffcutCandidates(saved: OpenedSavedPlan): readonly OffcutCandidate[] {
  return saved.plan.panels.flatMap((allocation, panelIndex) => {
    const source = saved.contents.sources.find(source => source.product.id === allocation.supplierProductId)
    if (!source) throw new Error('The historical source panel is missing.')
    const scene = createCuttingPlanScene(allocation.plan, { panel: source.product, parts: saved.contents.parts, settings: saved.contents.settings })
    if (scene.status !== 'valid') throw new Error('The cutting tree is invalid.')
    return scene.scene.waste.map((region, wasteIndex) => ({ panelIndex, wasteIndex, region, panel: source.product, materialName: source.materialName }))
  })
}
/** Explicit physical execution only. All stock changes and the idempotency record share one commit. */
export function createCuttingConfirmationService(persistence: LocalPersistence) {
  return { forProject(projectId: CuttingProjectId) {
    return {
      list(): Promise<PersistenceResult<readonly CuttingConfirmation[]>> {
        return persistence.transaction(async repositories => {
          const project = await repositories.projects.get(projectId)
          return project.ok ? repositories.cuttingConfirmations.listForProject(projectId) : project
        })
      },
      preview(id: SavedCuttingPlanId): Promise<PersistenceResult<CuttingPreview>> {
        return persistence.transaction(async repositories => {
          const project = await repositories.projects.get(projectId)
          if (!project.ok) return project
          const saved = await readSavedPlan(repositories, projectId, id)
          if (!saved.ok) return saved
          const confirmation = await repositories.cuttingConfirmations.find(id)
          if (!confirmation.ok) return confirmation
          if (confirmation.value !== null && confirmation.value.projectId !== projectId) return invalid('The confirmation owner does not match the plan.')
          const stock = await repositories.stockItems.list()
          if (!stock.ok) return stock
          try { return { ok: true, value: { saved: saved.value, stock: stock.value, offcuts: cuttingOffcutCandidates(saved.value), confirmation: confirmation.value } } }
          catch (cause) { return invalid(cause instanceof Error ? cause.message : 'Invalid cutting plan.') }
        })
      },
      confirm(id: SavedCuttingPlanId, input: unknown): Promise<PersistenceResult<CuttingConfirmation>> {
        const parsed = confirmCuttingInputSchema.safeParse(input)
        if (!parsed.success) return Promise.resolve({ ok: false, error: { kind: 'invalidRecord', issues: parsed.error.issues } })
        return persistence.transaction(repositories => confirmCuttingInTransaction(repositories, projectId, id, input))
      },
    }
  } }
}
export type CuttingConfirmationService = ReturnType<typeof createCuttingConfirmationService>

export async function confirmCuttingInTransaction(repositories: Repositories, projectId: CuttingProjectId, id: SavedCuttingPlanId, input: unknown): Promise<PersistenceResult<CuttingConfirmation>> {
  const parsed = confirmCuttingInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: { kind: 'invalidRecord', issues: parsed.error.issues } }
  const request = parsed.data

  const project = await repositories.projects.get(projectId)
  if (!project.ok) return project
  const saved = await readSavedPlan(repositories, projectId, id)
  if (!saved.ok) return saved
  const previous = await repositories.cuttingConfirmations.find(id)
  if (!previous.ok) return previous
  if (previous.value !== null) return previous.value.projectId === projectId ? { ok: true, value: previous.value } : invalid('The confirmation owner does not match the plan.')
  const automatic = await repositories.projectStock.find(projectId)
  if (!automatic.ok) return automatic
  if (automatic.value?.consumed.some(movement => saved.value.contents.sources.some(source => source.product.stockItemId === movement.stock.id))) return conflict('This plan already consumes its exact source stock through automatic synchronization. It cannot be consumed again through legacy confirmation.')
  if (!saved.value.plan.panels.length) return conflict('This plan has no panels to cut.')
  if (request.assignments.length !== saved.value.plan.panels.length || new Set(request.assignments.map(item => item.panelIndex)).size !== request.assignments.length) return conflict('Identify exactly one owned StockItem for every panel.')
  const consumed = new Map<StockItem['id'], { stock: StockItem; quantity: number; panelIndices: number[] }>()
  for (const assignment of request.assignments) {
    const panel = saved.value.plan.panels[assignment.panelIndex]
    const source = saved.value.contents.sources.find(source => source.product.id === panel?.supplierProductId)
    if (!source) return conflict('An assigned panel does not exist in the saved plan.')
    const record = await repositories.stockItems.get(assignment.stockItemId)
    if (!record.ok) return record
    try { if (!stockMatchesPanel(record.value, source.product)) return conflict('Stock must match material, exact thickness, panel dimensions and grain direction.') }
    catch { return invalid('Stock dimensions are outside the supported geometry range.') }
    const existing = consumed.get(record.value.id)
    consumed.set(record.value.id, { stock: record.value, quantity: (existing?.quantity ?? 0) + 1, panelIndices: [...existing?.panelIndices ?? [], assignment.panelIndex] })
  }
  for (const movement of consumed.values()) if (movement.quantity > movement.stock.quantity) return conflict('Insufficient stock quantity. No inventory changes were made.')
  let available: readonly OffcutCandidate[]
  try { available = cuttingOffcutCandidates(saved.value) } catch { return invalid('The cutting tree is invalid.') }
  const keys = request.offcuts.map(item => `${String(item.panelIndex)}:${String(item.wasteIndex)}`)
  if (new Set(keys).size !== keys.length) return conflict('An offcut cannot be kept more than once.')
  const offcuts: StockItem[] = []
  for (const selection of request.offcuts) {
    const candidate = available.find(item => item.panelIndex === selection.panelIndex && item.wasteIndex === selection.wasteIndex)
    const stock = [...consumed.values()].find(item => item.panelIndices.includes(selection.panelIndex))?.stock
    if (!candidate || !stock) return conflict('The selected offcut is not part of this saved plan.')
    offcuts.push(stockItemSchema.parse({ id: stockItemIdSchema.parse(crypto.randomUUID()), kind: 'offcut', materialId: stock.materialId, lengthMm: candidate.region.lengthMm, widthMm: candidate.region.widthMm, thicknessMm: stock.thicknessMm, grainDirection: stock.grainDirection, quantity: 1,
      provenance: { source: 'cutting', projectId, savedPlanId: id, sourceStockItemId: stock.id, panelIndex: selection.panelIndex, wasteIndex: selection.wasteIndex } }))
  }
  const receipt = cuttingConfirmationSchema.parse({ id, projectId, confirmedAt: new Date().toISOString(), consumed: [...consumed.values()], offcuts })
  for (const movement of consumed.values()) {
    const quantity = movement.stock.quantity - movement.quantity
    // StockItem quantities stay strictly positive. Exhausted records are removed;
    // their full pre-cut identity/provenance remains in immutable movement history.
    const deducted = quantity === 0 ? await repositories.stockItems.delete(movement.stock.id) : await repositories.stockItems.update(movement.stock.id, { ...movement.stock, quantity })
    if (!deducted.ok) return deducted
  }
  for (const offcut of offcuts) { const created = await repositories.stockItems.create(offcut); if (!created.ok) return created }
  return repositories.cuttingConfirmations.create(receipt)
}
