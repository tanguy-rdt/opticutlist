import type { CuttingProject } from '../../domain/model/cutting-project'
import type { MaterialId } from '../../domain/model/ids'
import type { SupplierProduct } from '../../domain/model/supplier-product'
import type { StockItem } from '../../domain/model/stock-item'
import { isStockEligibleForProject } from '../inventory/stock-eligibility'

/** Saved material choices and selected eligible panel sources share stable Material IDs. */
export function projectPartMaterialIds(project: CuttingProject, products: readonly SupplierProduct[], stock: readonly StockItem[]): readonly MaterialId[] {
  return [...new Set([
    ...project.materialIds,
    ...products.filter(product => project.supplierProductIds.includes(product.id)).map(product => product.materialId),
    ...stock.filter(item => project.stockItemIds?.includes(item.id) && item.quantity > 0 && isStockEligibleForProject(item, project.id)).map(item => item.materialId),
  ])]
}
