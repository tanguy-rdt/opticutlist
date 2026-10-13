import { isStockEligibleForProject } from './stock-eligibility'
import type { CuttingProjectId } from '../../domain/model/ids'
import { stockItemSchema, type StockItem } from '../../domain/model/stock-item'
import type { CuttingConfirmation } from '../../domain/model/cutting-confirmation'
import type { LocalPersistence, PersistenceResult, Repository } from '../persistence/repositories'
import { resolvePresetMaterial } from '../catalog/resolve-preset-material'

export interface StockRepository extends Repository<StockItem> {
  saveWithPreset(record: unknown, presetId: string, previous?: StockItem): Promise<PersistenceResult<StockItem>>
  update(id: StockItem['id'], record: unknown, previous?: StockItem): Promise<PersistenceResult<StockItem>>
  delete(id: StockItem['id'], previous?: StockItem): Promise<PersistenceResult<void>>
  planningStock(projectId: CuttingProjectId): Promise<PersistenceResult<readonly StockItem[]>>
  history(id: StockItem['id']): Promise<PersistenceResult<readonly CuttingConfirmation[]>>
}
function conflict(message: string): Extract<PersistenceResult<never>, { ok: false }> { return { ok: false, error: { kind: 'referenceConflict', message } } }
function sameRecord(a: StockItem, b: StockItem): boolean { return JSON.stringify(a) === JSON.stringify(b) }

/** Manual corrections use existing stores/transactions; cutting receipts are immutable snapshots. */
export function createStockRepository(persistence: LocalPersistence): StockRepository {
  async function save(record: unknown, id?: StockItem['id'], previous?: StockItem, presetId?: string): Promise<PersistenceResult<StockItem>> {
    const parsed = stockItemSchema.safeParse(record)
    if (!parsed.success) return { ok: false, error: { kind: 'invalidRecord', issues: parsed.error.issues } }
    return persistence.transaction(async repositories => {
      let stock = parsed.data
      if (id !== undefined) {
        const current = await repositories.stockItems.get(id)
        if (!current.ok) return current
        if (stock.id !== id) return conflict('The stock item ID cannot change.')
        if (previous && !sameRecord(current.value, previous)) return conflict('Stock changed since this form opened. Refresh before editing; no changes were saved.')
        if (JSON.stringify(stock.provenance) !== JSON.stringify(current.value.provenance)) return conflict('The original stock provenance cannot be changed.')
      } else {
        if (stock.provenance.source !== 'manual') return conflict('New manual stock must use manual provenance; cutting offcuts are created only through finalization.')
        const receipts = await repositories.cuttingConfirmations.list()
        if (!receipts.ok) return receipts
        const projectStock = await repositories.projectStock.list()
        if (!projectStock.ok) return projectStock
        if (projectStock.value.some(state => state.entries.some(entry => entry.stock?.id === stock.id) || state.movements.some(movement => [...movement.added, ...movement.removed, ...movement.consumed.map(item => item.stock), ...movement.restored.map(item => item.stock)].some(item => item.id === stock.id)))) return conflict('This stock ID belongs to project inventory history. Create a new stock reference instead.')
        if (receipts.value.some(receipt => receipt.consumed.some(movement => movement.stock.id === stock.id) || receipt.offcuts.some(offcut => offcut.id === stock.id))) return conflict('This stock ID belongs to historical inventory. Create a new stock reference instead.')
      }
      if (presetId !== undefined) {
        const material = await resolvePresetMaterial(repositories, presetId)
        if (!material.ok) return material
        stock = { ...stock, materialId: material.value.id }
      } else {
        const material = await repositories.materials.get(stock.materialId)
        if (!material.ok) return material
      }
      return id === undefined ? repositories.stockItems.create(stock) : repositories.stockItems.update(id, stock)
    })
  }
  return {
    planningStock: projectId => persistence.transaction(async repositories => {
      const records = await repositories.stockItems.list()
      if (!records.ok) return records
      const state = await repositories.projectStock.find(projectId)
      if (!state.ok) return state
      const project = await repositories.projects.get(projectId)
      if (!project.ok) return project
      const items = new Map(records.value.map(item => [item.id, item]))
      for (const movement of state.value?.consumed ?? []) {
        const current = items.get(movement.stock.id)
        const quantity = (current?.quantity ?? 0) + movement.quantity
        if (!Number.isSafeInteger(quantity)) return conflict('Project planning quantity exceeds the supported range.')
        items.set(movement.stock.id, { ...(current ?? movement.stock), quantity })
      }
      if ([...items.values()].some(item => project.value.stockItemIds?.includes(item.id) && !isStockEligibleForProject(item, projectId))) return conflict('This project selects an offcut generated by its own cutting plan. Remove that stock selection in Materials before optimizing.')
      return { ok: true, value: [...items.values()].filter(item => isStockEligibleForProject(item, projectId)) }
    }),
    get: id => persistence.stockItems.get(id), list: () => persistence.stockItems.list(),
    create: record => save(record),
    update: (id, record, previous) => save(record, id, previous),
    saveWithPreset: (record, presetId, previous) => save(record, previous?.id, previous, presetId),
    delete: (id, previous) => persistence.transaction(async repositories => {
      const current = await repositories.stockItems.get(id)
      if (!current.ok) return current
      if (previous && !sameRecord(current.value, previous)) return conflict('Stock changed since it was displayed. Refresh before deleting; nothing was removed.')
      // Receipts keep the complete pre-cut snapshot; never alter or cascade history.
      return repositories.stockItems.delete(id)
    }),
    history: async id => {
      const receipts = await persistence.cuttingConfirmations.list()
      return receipts.ok ? { ok: true, value: receipts.value.filter(receipt => receipt.consumed.some(movement => movement.stock.id === id) || receipt.offcuts.some(offcut => offcut.id === id)).sort((a, b) => a.confirmedAt.localeCompare(b.confirmedAt) || a.id.localeCompare(b.id)) } : receipts
    },
  }
}
