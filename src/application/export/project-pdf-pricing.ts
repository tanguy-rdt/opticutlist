import type { Repositories, PersistenceResult } from '../persistence/repositories'
import type { StockItem } from '../../domain/model/stock-item'
import type { StockItemId, SupplierProductId } from '../../domain/model/ids'
import type { SupplierProduct } from '../../domain/model/supplier-product'
import type { ProjectCuttingPdfDocument } from './cutting-plan-pdf-service'

export type PdfPricingRepositories = {
  readonly supplierProducts: Pick<Repositories['supplierProducts'], 'get'>
  readonly stockItems: Pick<Repositories['stockItems'], 'get'>
}
type Price = { readonly price: number; readonly currency: string }
function record<T>(result: PersistenceResult<T>): T | undefined {
  if (result.ok) return result.value
  if (result.error.kind === 'notFound') return undefined
  throw new Error('Could not read panel pricing. Check the catalog and stock data, then retry PDF generation.')
}

/** Current reference prices, joined by exact identity only; no inventory or historical writes. */
export async function resolveProjectPdfPricing(document: ProjectCuttingPdfDocument, repositories: PdfPricingRepositories): Promise<ProjectCuttingPdfDocument> {
  const products = new Map<SupplierProductId, Promise<SupplierProduct | undefined>>()
  const stock = new Map<StockItemId, Promise<StockItem | undefined>>()
  function product(id: SupplierProductId): Promise<SupplierProduct | undefined> {
    let pending = products.get(id)
    if (!pending) { pending = repositories.supplierProducts.get(id).then(record); products.set(id, pending) }
    return pending
  }
  function stockItem(id: StockItemId): Promise<StockItem | undefined> {
    let pending = stock.get(id)
    if (!pending) { pending = repositories.stockItems.get(id).then(record); stock.set(id, pending) }
    return pending
  }
  async function stockProduct(id: StockItemId, visited = new Set<StockItemId>()): Promise<SupplierProductId | undefined> {
    if (visited.has(id)) return undefined // Ambiguous/cyclic provenance cannot establish a price.
    visited.add(id)
    const item = await stockItem(id)
    if (!item || item.provenance.source === 'manual') return undefined
    if (item.provenance.source === 'purchase' || item.provenance.supplierProductId) return item.provenance.supplierProductId
    return item.provenance.sourceStockItemId ? stockProduct(item.provenance.sourceStockItemId, visited) : undefined
  }
  const panels = await Promise.all(document.panels.map(async panel => {
    if (panel.pricing) return panel // Preserve explicitly supplied, validated export metadata.
    const id = panel.panel.stockItemId ? await stockProduct(panel.panel.stockItemId) : panel.panel.id
    if (!id) return panel
    const reference = await product(id)
    const pricing: Price | undefined = reference?.price === undefined ? undefined : { price: reference.price, currency: reference.currency }
    return pricing ? { ...panel, pricing } : panel
  }))
  return { ...document, panels }
}
