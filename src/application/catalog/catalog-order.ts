import { z } from 'zod'
import { supplierIdSchema, supplierProductIdSchema } from '../../domain/model/ids'
import type { SupplierProduct } from '../../domain/model/supplier-product'

/** Presentation ranks only; supplier products and project references remain unchanged. */
export const catalogOrderSchema = z.strictObject({
  id: supplierIdSchema,
  productIds: z.array(supplierProductIdSchema).refine(ids => new Set(ids).size === ids.length, 'Product order IDs must be unique'),
})
export type CatalogOrder = z.infer<typeof catalogOrderSchema>
export function orderCatalogProducts(products: readonly SupplierProduct[], orders: readonly CatalogOrder[]): SupplierProduct[] {
  const ranks = new Map(orders.map(order => [order.id, new Map(order.productIds.map((id, index) => [id, index]))]))
  return [...products].sort((a, b) => {
    if (a.supplierId !== b.supplierId) return a.supplierId < b.supplierId ? -1 : 1
    const supplierRanks = ranks.get(a.supplierId)
    return ((supplierRanks?.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (supplierRanks?.get(b.id) ?? Number.MAX_SAFE_INTEGER))
      || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  })
}
