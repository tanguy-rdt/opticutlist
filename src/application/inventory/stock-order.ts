import { z } from 'zod'
import { materialIdSchema, stockItemIdSchema } from '../../domain/model/ids'
import type { StockItem } from '../../domain/model/stock-item'

/** Presentation metadata, deliberately separate from physical stock/audit snapshots. */
export const stockOrderSchema = z.strictObject({
  id: materialIdSchema,
  stockItemIds: z.array(stockItemIdSchema).refine(ids => new Set(ids).size === ids.length, 'Stock order IDs must be unique'),
})
export type StockOrder = z.infer<typeof stockOrderSchema>

export function orderStockItems(items: readonly StockItem[], orders: readonly StockOrder[]): StockItem[] {
  const ranks = new Map(orders.map(order => [order.id, new Map(order.stockItemIds.map((id, index) => [id, index]))]))
  return [...items].sort((a, b) => {
    if (a.materialId !== b.materialId) return a.materialId < b.materialId ? -1 : 1
    const materialRanks = ranks.get(a.materialId)
    const rank = (materialRanks?.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (materialRanks?.get(b.id) ?? Number.MAX_SAFE_INTEGER)
    return rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  })
}
