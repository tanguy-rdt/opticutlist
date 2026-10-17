import type { CuttingProjectId } from '../../domain/model/ids'
import type { StockItem } from '../../domain/model/stock-item'
import type { PersistenceResult, Repositories } from '../persistence/repositories'

/**
 * Read-only project supply: live stock plus only this project's active consumption.
 * Saved Materials IDs and historical movements do not establish an allocation.
 * Call inside the caller's transaction so availability and selection writes share a snapshot.
 * Eligibility remains the caller's responsibility (selection review retains invalid references).
 */
export async function readProjectStockAvailability(repositories: Repositories, projectId: CuttingProjectId): Promise<PersistenceResult<readonly StockItem[]>> {
  const records = await repositories.stockItems.list()
  if (!records.ok) {
    return records
  }
  const state = await repositories.projectStock.find(projectId)
  if (!state.ok) {
    return state
  }
  const items = new Map(records.value.map(item => [item.id, item]))
  for (const allocation of state.value?.consumed ?? []) {
    const current = items.get(allocation.stock.id)
    const quantity = (current?.quantity ?? 0) + allocation.quantity
    if (!Number.isSafeInteger(quantity)) {
      return { ok: false, error: { kind: 'referenceConflict', message: 'Project planning quantity exceeds the supported range.' } }
    }
    items.set(allocation.stock.id, { ...(current ?? allocation.stock), quantity })
  }
  return { ok: true, value: [...items.values()] }
}
