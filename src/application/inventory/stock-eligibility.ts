import type { CuttingProjectId } from '../../domain/model/ids'
import type { StockItem } from '../../domain/model/stock-item'

/** A project cannot use physical stock produced by its own cutting plans. */
export function isStockEligibleForProject(stock: StockItem, projectId: CuttingProjectId): boolean {
  return stock.provenance.source !== 'cutting' || stock.provenance.projectId !== projectId
}
