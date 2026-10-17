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

function readOptionalRecord<T>(result: PersistenceResult<T>): T | undefined {
  if (result.ok) {
    return result.value
  }
  if (result.error.kind === 'notFound') {
    return undefined
  }
  throw new Error('Could not read panel pricing. Check the catalog and stock data, then retry PDF generation.')
}

/** Current reference prices, joined by exact identity only; no inventory or historical writes. */
export async function resolveProjectPdfPricing(document: ProjectCuttingPdfDocument, repositories: PdfPricingRepositories): Promise<ProjectCuttingPdfDocument> {
  const productReads = new Map<SupplierProductId, Promise<SupplierProduct | undefined>>()
  const stockReads = new Map<StockItemId, Promise<StockItem | undefined>>()

  function getProduct(id: SupplierProductId): Promise<SupplierProduct | undefined> {
    let pending = productReads.get(id)
    if (!pending) {
      pending = repositories.supplierProducts.get(id).then(readOptionalRecord)
      productReads.set(id, pending)
    }
    return pending
  }

  function getStockItem(id: StockItemId): Promise<StockItem | undefined> {
    let pending = stockReads.get(id)
    if (!pending) {
      pending = repositories.stockItems.get(id).then(readOptionalRecord)
      stockReads.set(id, pending)
    }
    return pending
  }

  async function resolveStockProductId(id: StockItemId, visited = new Set<StockItemId>()): Promise<SupplierProductId | undefined> {
    if (visited.has(id)) {
      return undefined // Ambiguous/cyclic provenance cannot establish a price.
    }
    visited.add(id)
    const item = await getStockItem(id)
    if (!item || item.provenance.source === 'manual') {
      return undefined
    }
    if (item.provenance.source === 'purchase' || item.provenance.supplierProductId) {
      return item.provenance.supplierProductId
    }
    if (!item.provenance.sourceStockItemId) {
      return undefined
    }
    return resolveStockProductId(item.provenance.sourceStockItemId, visited)
  }

  const panels = await Promise.all(document.panels.map(async panel => {
    if (panel.pricing) {
      return panel // Preserve explicitly supplied, validated export metadata.
    }
    const productId = panel.panel.stockItemId
      ? await resolveStockProductId(panel.panel.stockItemId)
      : panel.panel.id
    if (!productId) {
      return panel
    }
    const reference = await getProduct(productId)
    const pricing: Price | undefined = reference?.price === undefined
      ? undefined
      : { price: reference.price, currency: reference.currency }
    return pricing ? { ...panel, pricing } : panel
  }))
  return { ...document, panels }
}
