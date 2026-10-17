import { orderStockItems, stockOrderSchema, type StockOrder } from './stock-order'
import { readProjectStockAvailability } from './project-stock-availability'
import { isStockEligibleForProject } from './stock-eligibility'
import { quantitySchema } from '../../domain/model/common'
import { supplierProductSchema, type SupplierProduct } from '../../domain/model/supplier-product'
import { stockItemIdSchema, type StockItemId } from '../../domain/model/ids'
import type { CuttingProjectId } from '../../domain/model/ids'
import { stockItemSchema, type StockItem } from '../../domain/model/stock-item'
import type { CuttingConfirmation } from '../../domain/model/cutting-confirmation'
import type { LocalPersistence, PersistenceResult, Repository, Repositories } from '../persistence/repositories'
import { resolvePresetMaterial } from '../catalog/resolve-preset-material'

export interface StockRepository extends Repository<StockItem> {
  addFromProduct(product: SupplierProduct, quantity: unknown): Promise<PersistenceResult<readonly StockItem[]>>
  ordering(): Promise<PersistenceResult<readonly StockOrder[]>>
  move(id: StockItem['id'], targetId: StockItem['id'], position: 'before' | 'after'): Promise<PersistenceResult<StockOrder>>
  saveWithPreset(record: unknown, presetId: string, previous?: StockItem): Promise<PersistenceResult<StockItem>>
  update(id: StockItem['id'], record: unknown, previous?: StockItem): Promise<PersistenceResult<StockItem>>
  delete(id: StockItem['id'], previous?: StockItem): Promise<PersistenceResult<void>>
  selectionStock(projectId: CuttingProjectId): Promise<PersistenceResult<readonly StockItem[]>>
  planningStock(projectId: CuttingProjectId): Promise<PersistenceResult<readonly StockItem[]>>
  history(id: StockItem['id']): Promise<PersistenceResult<readonly CuttingConfirmation[]>>
}

function conflict(message: string): Extract<PersistenceResult<never>, { ok: false }> {
  return { ok: false, error: { kind: 'referenceConflict', message } }
}

function sameRecord(a: StockItem, b: StockItem): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

async function checkNewStockIds(repositories: Repositories, ids: readonly StockItemId[]): Promise<PersistenceResult<void>> {
  const receipts = await repositories.cuttingConfirmations.list()
  if (!receipts.ok) {
    return receipts
  }
  const projectStock = await repositories.projectStock.list()
  if (!projectStock.ok) {
    return projectStock
  }
  const candidates = new Set(ids)
  if (
    projectStock.value.some(state => state.entries.some(entry => entry.stock && candidates.has(entry.stock.id))
      || state.movements.some(movement => [...movement.added, ...movement.removed, ...movement.consumed.map(item => item.stock), ...movement.restored.map(item => item.stock)].some(item => candidates.has(item.id))))
  ) {
    return conflict('This stock ID belongs to project inventory history. Create a new stock reference instead.')
  }
  if (receipts.value.some(receipt => receipt.consumed.some(movement => candidates.has(movement.stock.id)) || receipt.offcuts.some(offcut => candidates.has(offcut.id)))) {
    return conflict('This stock ID belongs to historical inventory. Create a new stock reference instead.')
  }
  return { ok: true, value: undefined }
}

/** Manual corrections use existing stores/transactions; cutting receipts are immutable snapshots. */
export function createStockRepository(persistence: LocalPersistence): StockRepository {
  async function save(record: unknown, id?: StockItem['id'], previous?: StockItem, presetId?: string): Promise<PersistenceResult<StockItem>> {
    const parsed = stockItemSchema.safeParse(record)
    if (!parsed.success) {
      return { ok: false, error: { kind: 'invalidRecord', issues: parsed.error.issues } }
    }
    return persistence.transaction(async repositories => {
      let stock = parsed.data
      if (id !== undefined) {
        const current = await repositories.stockItems.get(id)
        if (!current.ok) {
          return current
        }
        if (stock.id !== id) {
          return conflict('The stock item ID cannot change.')
        }
        if (previous && !sameRecord(current.value, previous)) {
          return conflict('Stock changed since this form opened. Refresh before editing; no changes were saved.')
        }
        if (JSON.stringify(stock.provenance) !== JSON.stringify(current.value.provenance)) {
          return conflict('The original stock provenance cannot be changed.')
        }
      } else {
        if (stock.provenance.source !== 'manual') {
          return conflict('New manual stock must use manual provenance; cutting offcuts are created only through finalization.')
        }
        const identities = await checkNewStockIds(repositories, [stock.id])
        if (!identities.ok) {
          return identities
        }
      }
      if (presetId !== undefined) {
        const material = await resolvePresetMaterial(repositories, presetId)
        if (!material.ok) {
          return material
        }
        stock = { ...stock, materialId: material.value.id }
      } else {
        const material = await repositories.materials.get(stock.materialId)
        if (!material.ok) {
          return material
        }
      }
      return id === undefined ? repositories.stockItems.create(stock) : repositories.stockItems.update(id, stock)
    })
  }

  return {
    async addFromProduct(product, quantity) {
      const parsedProduct = supplierProductSchema.safeParse(product)
      const parsedQuantity = quantitySchema.safeParse(quantity)
      if (!parsedProduct.success) {
        return { ok: false, error: { kind: 'invalidRecord', issues: parsedProduct.error.issues } }
      }
      if (!parsedQuantity.success) {
        return { ok: false, error: { kind: 'invalidRecord', issues: parsedQuantity.error.issues } }
      }
      return persistence.transaction(async repositories => {
        const current = await repositories.supplierProducts.get(parsedProduct.data.id)
        if (!current.ok) {
          return current
        }
        if (JSON.stringify(current.value) !== JSON.stringify(parsedProduct.data)) {
          return conflict('The product changed. Reopen the Catalog page to load its current characteristics, then try again.')
        }
        const material = await repositories.materials.get(current.value.materialId)
        if (!material.ok) {
          return material
        }
        const supplier = await repositories.suppliers.get(current.value.supplierId)
        if (!supplier.ok) {
          return supplier
        }
        const panels: StockItem[] = []
        for (let index = 0; index < parsedQuantity.data; index++) {
          const { materialId, lengthMm, widthMm, thicknessMm, grainDirection, id } = current.value
          panels.push(stockItemSchema.parse({
            id: stockItemIdSchema.parse(crypto.randomUUID()),
            kind: 'fullPanel',
            materialId,
            lengthMm,
            widthMm,
            thicknessMm,
            grainDirection,
            quantity: 1,
            provenance: { source: 'purchase', supplierProductId: id }
          }))
        }
        if (new Set(panels.map(panel => panel.id)).size !== panels.length) {
          return conflict('Could not generate distinct panel identities. Try again; nothing was added.')
        }
        const identities = await checkNewStockIds(repositories, panels.map(panel => panel.id))
        if (!identities.ok) {
          return identities
        }
        for (const panel of panels) {
          const created = await repositories.stockItems.create(panel)
          if (!created.ok) {
            return created
          }
        }
        return { ok: true, value: panels }
      })
    },
    ordering: () => persistence.stockOrders.list(),
    move: (id, targetId, position) => persistence.transaction(async repositories => {
      const items = await repositories.stockItems.list();
      if (!items.ok) {
        return items
      }
      const source = items.value.find(item => item.id === id)
      const target = items.value.find(item => item.id === targetId)
      if (!source || !target) {
        return { ok: false, error: { kind: 'notFound', id: !source ? id : targetId } }
      }
      if (source.materialId !== target.materialId) {
        return conflict('Stock can only be reordered within the same material.')
      }
      const orders = await repositories.stockOrders.list();
      if (!orders.ok) {
        return orders
      }
      const previous = orders.value.find(order => order.id === source.materialId)
      const ids = orderStockItems(items.value.filter(item => item.materialId === source.materialId), orders.value).map(item => item.id)
      if (id !== targetId) {
        ids.splice(ids.indexOf(id), 1)
        ids.splice(ids.indexOf(targetId) + (position === 'after' ? 1 : 0), 0, id)
      }
      const order = stockOrderSchema.parse({ id: source.materialId, stockItemIds: ids })
      if (previous && JSON.stringify(previous) === JSON.stringify(order)) {
        return { ok: true, value: order }
      }
      return previous ? repositories.stockOrders.update(order.id, order) : repositories.stockOrders.create(order)
    }),
    // Keep invalid saved own-offcut references available for the existing review/removal UI.
    selectionStock: projectId => persistence.transaction(repositories => readProjectStockAvailability(repositories, projectId)),
    planningStock: projectId => persistence.transaction(async repositories => {
      const stock = await readProjectStockAvailability(repositories, projectId)
      if (!stock.ok) {
        return stock
      }
      const project = await repositories.projects.get(projectId)
      if (!project.ok) {
        return project
      }
      if (stock.value.some(item => project.value.stockItemIds?.includes(item.id) && !isStockEligibleForProject(item, projectId))) {
        return conflict('This project selects an offcut generated by its own cutting plan. Remove that stock selection in Materials before optimizing.')
      }
      return { ok: true, value: stock.value.filter(item => isStockEligibleForProject(item, projectId)) }
    }),
    get: id => persistence.stockItems.get(id),
    list: () => persistence.stockItems.list(),
    create: record => save(record),
    update: (id, record, previous) => save(record, id, previous),
    saveWithPreset: (record, presetId, previous) => save(record, previous?.id, previous, presetId),
    delete: (id, previous) => persistence.transaction(async repositories => {
      const current = await repositories.stockItems.get(id)
      if (!current.ok) {
        return current
      }
      if (previous && !sameRecord(current.value, previous)) {
        return conflict('Stock changed since it was displayed. Refresh before deleting; nothing was removed.')
      }
      // Receipts keep the complete pre-cut snapshot; never alter or cascade history.
      return repositories.stockItems.delete(id)
    }),
    history: async id => {
      const receipts = await persistence.cuttingConfirmations.list()
      return receipts.ok ? {
        ok: true,
        value: receipts.value.filter(receipt => receipt.consumed.some(movement => movement.stock.id === id) || receipt.offcuts.some(offcut => offcut.id === id)).sort((a, b) => a.confirmedAt.localeCompare(b.confirmedAt) || a.id.localeCompare(b.id))
      } : receipts
    },
  }
}
