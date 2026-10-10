import type { Material } from '../../domain/model/material'
import type { Supplier } from '../../domain/model/supplier'
import { supplierProductSchema, type SupplierProduct } from '../../domain/model/supplier-product'
import type { LocalPersistence, PersistenceResult, Repositories } from '../persistence/repositories'

function conflict(message: string): PersistenceResult<never> {
  return { ok: false, error: { kind: 'referenceConflict', message } }
}

/** Application guards reuse repository ports and the existing atomic transaction boundary. */
export function createCatalogRepositories(persistence: LocalPersistence): Pick<Repositories, 'materials' | 'suppliers' | 'supplierProducts'> {
  function saveProduct(record: unknown, id?: SupplierProduct['id']): Promise<PersistenceResult<SupplierProduct>> {
    const parsed = supplierProductSchema.safeParse(record)
    if (!parsed.success) return Promise.resolve({ ok: false, error: { kind: 'invalidRecord', issues: parsed.error.issues } })
    return persistence.transaction(async (repositories) => {
      const supplier = await repositories.suppliers.get(parsed.data.supplierId)
      if (!supplier.ok) return supplier
      const material = await repositories.materials.get(parsed.data.materialId)
      if (!material.ok) return material
      return id === undefined ? repositories.supplierProducts.create(parsed.data) : repositories.supplierProducts.update(id, parsed.data)
    })
  }
  return {
    suppliers: {
      ...persistence.suppliers,
      delete(id: Supplier['id']) {
        return persistence.transaction(async (repositories) => {
          const products = await repositories.supplierProducts.list()
          if (!products.ok) return products
          if (products.value.some((product) => product.supplierId === id)) return conflict('Cannot delete this supplier while it has catalog products. Remove or reassign them first.')
          return repositories.suppliers.delete(id)
        })
      },
    },
    supplierProducts: {
      ...persistence.supplierProducts,
      create: (record) => saveProduct(record),
      update: (id, record) => saveProduct(record, id),
      delete(id: SupplierProduct['id']) {
        return persistence.transaction(async (repositories) => {
          const projects = await repositories.projects.list()
          if (!projects.ok) return projects
          if (projects.value.some(project => project.supplierProductIds.includes(id))) return conflict('Cannot delete this product while a project selects it. Remove the project selection first.')
          const stock = await repositories.stockItems.list()
          if (!stock.ok) return stock
          if (stock.value.some((item) => item.provenance.source === 'purchase' && item.provenance.supplierProductId === id)) return conflict('Cannot delete this product because owned stock references it as its purchase source.')
          return repositories.supplierProducts.delete(id)
        })
      },
    },
    materials: {
      ...persistence.materials,
      delete(id: Material['id']) {
        return persistence.transaction(async (repositories) => {
          const projects = await repositories.projects.list()
          if (!projects.ok) return projects
          if (projects.value.some(project => project.materialIds.includes(id))) return conflict('Cannot delete this material while a project selects it. Remove the project selection first.')
          const parts = await repositories.parts.list()
          if (!parts.ok) return parts
          const products = await repositories.supplierProducts.list()
          if (!products.ok) return products
          const stock = await repositories.stockItems.list()
          if (!stock.ok) return stock
          if ([...parts.value, ...products.value, ...stock.value].some((item) => item.materialId === id)) return conflict('Cannot delete this material while parts, catalog products, or owned stock reference it.')
          return repositories.materials.delete(id)
        })
      },
    },
  }
}
