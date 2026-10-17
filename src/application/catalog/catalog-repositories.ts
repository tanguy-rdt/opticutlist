import { orderCatalogProducts, catalogOrderSchema, type CatalogOrder } from './catalog-order'
import { type Material } from '../../domain/model/material'
import type { Supplier } from '../../domain/model/supplier'
import { supplierProductSchema, type SupplierProduct } from '../../domain/model/supplier-product'
import type { LocalPersistence, PersistenceResult, Repositories, Repository } from '../persistence/repositories'

import { resolvePresetMaterial } from './resolve-preset-material'

export interface CatalogProductRepository extends Repository<SupplierProduct> {
  ordering(): Promise<PersistenceResult<readonly CatalogOrder[]>>
  move(id: SupplierProduct['id'], targetId: SupplierProduct['id'], position: 'before' | 'after'): Promise<PersistenceResult<CatalogOrder>>
  saveWithPreset(record: unknown, presetId: string, updatingId?: SupplierProduct['id']): Promise<PersistenceResult<SupplierProduct>>
}

function conflict(message: string): PersistenceResult<never> {
  return { ok: false, error: { kind: 'referenceConflict', message } }
}

/** Application guards reuse repository ports and the existing atomic transaction boundary. */
export function createCatalogRepositories(persistence: LocalPersistence): Pick<Repositories, 'materials' | 'suppliers'> & { supplierProducts: CatalogProductRepository } {
  function saveProduct(record: unknown, id?: SupplierProduct['id'], presetId?: string): Promise<PersistenceResult<SupplierProduct>> {
    const parsed = supplierProductSchema.safeParse(record)
    if (!parsed.success) return Promise.resolve({ ok: false, error: { kind: 'invalidRecord', issues: parsed.error.issues } })
    return persistence.transaction(async (repositories) => {
      const supplier = await repositories.suppliers.get(parsed.data.supplierId)
      if (!supplier.ok) return supplier
      let product = parsed.data
      if (presetId !== undefined) {
        const material = await resolvePresetMaterial(repositories, presetId)
        if (!material.ok) return material
        product = { ...product, materialId: material.value.id }
      } else {
        const material = await repositories.materials.get(product.materialId)
        if (!material.ok) return material
      }
      return id === undefined ? repositories.supplierProducts.create(product) : repositories.supplierProducts.update(id, product)
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
      ordering: () => persistence.catalogOrders.list(),
      move: (id, targetId, position) => persistence.transaction(async repositories => {
        const products = await repositories.supplierProducts.list();
        if (!products.ok) return products
        const source = products.value.find(product => product.id === id)
        const target = products.value.find(product => product.id === targetId)
        if (!source || !target) return { ok: false, error: { kind: 'notFound', id: !source ? id : targetId } }
        if (source.supplierId !== target.supplierId || source.materialId !== target.materialId) return conflict('Products can only be reordered within the same supplier and material.')
        const orders = await repositories.catalogOrders.list();
        if (!orders.ok) return orders
        const previous = orders.value.find(order => order.id === source.supplierId)
        const productIds = orderCatalogProducts(products.value.filter(product => product.supplierId === source.supplierId), orders.value).map(product => product.id)
        if (id !== targetId) {
          productIds.splice(productIds.indexOf(id), 1)
          productIds.splice(productIds.indexOf(targetId) + (position === 'after' ? 1 : 0), 0, id)
        }
        const order = catalogOrderSchema.parse({ id: source.supplierId, productIds })
        if (previous && JSON.stringify(previous) === JSON.stringify(order)) return { ok: true, value: order }
        return previous ? repositories.catalogOrders.update(order.id, order) : repositories.catalogOrders.create(order)
      }),
      saveWithPreset: (record, presetId, updatingId) => saveProduct(record, updatingId, presetId),
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
