import { stockItemSchema, type StockItem } from '../../domain/model/stock-item'
import type { CuttingConfirmation } from '../../domain/model/cutting-confirmation'
import type { LocalPersistence, PersistenceResult, Repository } from '../persistence/repositories'
import { resolvePresetMaterial } from '../catalog/resolve-preset-material'

export interface StockRepository extends Repository<StockItem> {
  saveWithPreset(record: unknown, presetId: string, previous?: StockItem): Promise<PersistenceResult<StockItem>>
  update(id: StockItem['id'], record: unknown, previous?: StockItem): Promise<PersistenceResult<StockItem>>
  delete(id: StockItem['id'], previous?: StockItem): Promise<PersistenceResult<void>>
  history(id: StockItem['id']): Promise<PersistenceResult<readonly CuttingConfirmation[]>>
}
function conflict(message: string): PersistenceResult<never> { return { ok: false, error: { kind: 'referenceConflict', message } } }
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
