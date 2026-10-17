import type { LocalPersistence, PersistenceResult } from '../persistence/repositories'
import type { ProjectJsonPort } from '../projects/project-transfer-format'
import { readCatalogTransferRecords } from './read-transfer-records'
import { mapped, remapCatalog } from './remap-catalog'
import { invalidCatalog, validateCatalogTransfer, type CatalogTransfer } from './catalog-transfer-format'

export interface CatalogImportPreview { file: CatalogTransfer; conflicts: number; reused: number }

export function createCatalogTransferService(persistence: LocalPersistence, json: ProjectJsonPort) {
  async function preview(file: CatalogTransfer): Promise<PersistenceResult<CatalogImportPreview>> {
    return persistence.transaction(async repositories => {
      const existing = await readCatalogTransferRecords(repositories);
      if (!existing.ok) {
        return existing
      }
      const mapped = remapCatalog(file.catalog, existing.value).catalog
      const original = [...file.catalog.materials, ...file.catalog.suppliers, ...file.catalog.products]
      const remapped = [...mapped.materials, ...mapped.suppliers, ...mapped.products]
      const reused = mapped.materials.filter(record => existing.value.materials.some(item => item.id === record.id)).length + mapped.suppliers.filter(record => existing.value.suppliers.some(item => item.id === record.id)).length + mapped.products.filter(record => existing.value.products.some(item => item.id === record.id)).length
      return { ok: true, value: { file, conflicts: original.filter((record, index) => remapped[index]?.id !== record.id).length, reused } }
    })
  }

  return {
    export(): Promise<PersistenceResult<string>> {
      return persistence.transaction(async repositories => {
        const materials = await repositories.materials.list();
        if (!materials.ok) {
          return materials
        }
        const suppliers = await repositories.suppliers.list();
        if (!suppliers.ok) {
          return suppliers
        }
        const products = await repositories.supplierProducts.list();
        if (!products.ok) {
          return products
        }
        const orders = await repositories.catalogOrders.list();
        if (!orders.ok) {
          return orders
        }
        const catalogOrders = orders.value.map(order => ({
          ...order,
          productIds: order.productIds.filter(id => products.value.some(product => product.id === id && product.supplierId === order.id))
        })).filter(order => order.productIds.length && suppliers.value.some(supplier => supplier.id === order.id))
        const file = validateCatalogTransfer({
          ...(catalogOrders.length ? { catalogOrders } : {}),
          format: 'opticutlist-catalog',
          schemaVersion: 1,
          catalog: { materials: materials.value, suppliers: suppliers.value, products: products.value }
        });
        if (!file.ok) {
          return file
        }
        return { ok: true, value: json.stringify(file.value) }
      })
    },
    preview(text: string): Promise<PersistenceResult<CatalogImportPreview>> {
      try {
        const file = validateCatalogTransfer(json.parse(text));
        return file.ok ? preview(file.value) : Promise.resolve(file)
      } catch (cause) {
        return Promise.resolve(invalidCatalog(cause instanceof Error ? cause.message : 'Could not read the catalog file.'))
      }
    },
    import(input: unknown, confirmed: boolean): Promise<PersistenceResult<CatalogTransfer>> {
      if (!confirmed) {
        return Promise.resolve(invalidCatalog('Explicit confirmation is required before importing a catalog.'))
      }
      const file = validateCatalogTransfer(input);
      if (!file.ok) {
        return Promise.resolve(file)
      }
      return persistence.transaction(async repositories => {
        const existing = await readCatalogTransferRecords(repositories);
        if (!existing.ok) {
          return existing
        }
        const remapped = remapCatalog(file.value.catalog, existing.value)
        const incoming = validateCatalogTransfer({
          ...file.value,
          catalog: remapped.catalog,
          ...(file.value.catalogOrders ? { catalogOrders: file.value.catalogOrders.map(order => ({ id: mapped(remapped.supplierIds, order.id), productIds: order.productIds.map(id => mapped(remapped.productIds, id)) })) } : {})
        });
        if (!incoming.ok) {
          return incoming
        }
        for (const material of incoming.value.catalog.materials) {
          if (!existing.value.materials.some(record => record.id === material.id)) {
            const result = await repositories.materials.create(material);
            if (!result.ok) {
              return result
            }
          }
        }
        for (const supplier of incoming.value.catalog.suppliers) {
          if (!existing.value.suppliers.some(record => record.id === supplier.id)) {
            const result = await repositories.suppliers.create(supplier);
            if (!result.ok) {
              return result
            }
          }
        }
        for (const product of incoming.value.catalog.products) {
          if (!existing.value.products.some(record => record.id === product.id)) {
            const result = await repositories.supplierProducts.create(product);
            if (!result.ok) {
              return result
            }
          }
        }
        if (incoming.value.catalogOrders?.length) {
          const orders = await repositories.catalogOrders.list();
          if (!orders.ok) {
            return orders
          }
          for (const imported of incoming.value.catalogOrders) {
            const previous = orders.value.find(order => order.id === imported.id)
            // Preserve local ranks; newly imported references retain their file order after them.
            const ids = previous?.productIds ?? []
            const order = { id: imported.id, productIds: [...ids, ...imported.productIds.filter(id => !ids.includes(id))] }
            const result = previous ? await repositories.catalogOrders.update(order.id, order) : await repositories.catalogOrders.create(order)
            if (!result.ok) {
              return result
            }
          }
        }
        return incoming
      })
    },
  }
}

export type CatalogTransferService = ReturnType<typeof createCatalogTransferService>
