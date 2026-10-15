import type { MaterialId, SupplierId, SupplierProductId } from '../../domain/model/ids'
import { materialIdSchema, supplierIdSchema, supplierProductIdSchema } from '../../domain/model/ids'
import type { CatalogRecords } from './catalog-transfer-format'
export interface ExistingCatalog {
  materialReferences: readonly string[]
  supplierReferences: readonly string[]
  productReferences: readonly string[]
  materials: readonly CatalogRecords['materials'][number][]
  suppliers: readonly CatalogRecords['suppliers'][number][]
  products: readonly CatalogRecords['products'][number][]
}
/** Preserve identities unless occupied. Never equate distinct opaque material IDs by a name alone. */
export function ids<T extends string>(incoming: readonly T[], existing: readonly string[], parseId: (id: string) => T): Map<T, T> {
  const used = new Set([...incoming, ...existing])
  return new Map([...new Set(incoming)].map(id => {
    if (!existing.includes(id)) return [id, id]
    for (let attempts = 0; attempts < 100; attempts += 1) {
      const fresh = parseId(crypto.randomUUID())
      if (!used.has(fresh)) { used.add(fresh); return [id, fresh] }
    }
    throw new Error('Could not allocate a unique imported entity ID.')
  }))
}
export function mapped<T extends string>(map: ReadonlyMap<T, T>, id: NoInfer<T>): T {
  const result = map.get(id)
  if (result === undefined) throw new Error('An imported relationship has no ID mapping.')
  return result
}
function identical<T extends { id: string }>(first: T, second: T): boolean {
  return JSON.stringify(Object.entries(first).filter(([, value]: [string, unknown]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b))) === JSON.stringify(Object.entries(second).filter(([, value]: [string, unknown]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)))
}
export function remapCatalog(catalog: CatalogRecords, existing: ExistingCatalog, historical: { materials: readonly MaterialId[]; products: readonly SupplierProductId[] } = { materials: [], products: [] }) {
  const materialIds = ids<MaterialId>([...catalog.materials.map(item => item.id), ...historical.materials], [...existing.materials.map(item => item.id), ...existing.materialReferences], value => materialIdSchema.parse(value))
  const supplierIds = ids<SupplierId>(catalog.suppliers.map(item => item.id), [...existing.suppliers.map(item => item.id), ...existing.supplierReferences], value => supplierIdSchema.parse(value))
  const productIds = ids<SupplierProductId>([...catalog.products.map(item => item.id), ...historical.products], [...existing.products.map(item => item.id), ...existing.productReferences], value => supplierProductIdSchema.parse(value))
  for (const item of catalog.materials) if (existing.materials.some(record => record.id === item.id && identical(item, record))) materialIds.set(item.id, item.id)
  for (const item of catalog.suppliers) if (existing.suppliers.some(record => record.id === item.id && identical(item, record))) supplierIds.set(item.id, item.id)
  const materials = catalog.materials.map(item => ({ ...item, id: mapped(materialIds, item.id) }))
  const suppliers = catalog.suppliers.map(item => ({ ...item, id: mapped(supplierIds, item.id) }))
  const products = catalog.products.map(item => {
    const updated = { ...item, materialId: mapped(materialIds, item.materialId), supplierId: mapped(supplierIds, item.supplierId) }
    if (existing.products.some(record => record.id === item.id && identical(updated, record))) productIds.set(item.id, item.id)
    return { ...updated, id: mapped(productIds, item.id) }
  })
  return { catalog: { materials, suppliers, products }, materialIds, supplierIds, productIds }
}
