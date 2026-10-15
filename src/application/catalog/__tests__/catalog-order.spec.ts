// @vitest-environment node
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { createLocalPersistence, DATABASE_V7_STORES } from '../../../infrastructure/persistence/local-database'
import { createCatalogRepositories } from '../catalog-repositories'
import { catalogOrderSchema, orderCatalogProducts } from '../catalog-order'
import { supplierProductSchema } from '../../../domain/model/supplier-product'
import { validMaterialInput, validSupplierInput, validSupplierProductInput, validStockItemInput } from '../../../domain/model/__tests__/fixtures'
import type { PersistenceResult } from '../../persistence/repositories'

const connections: { close(): void }[] = []
afterEach(() => { connections.forEach(connection => { connection.close() }); connections.length = 0; vi.restoreAllMocks() })
function value<T>(result: PersistenceResult<T>): T { if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.value }
const a = supplierProductSchema.parse({ ...validSupplierProductInput, id: 'a-product' })
const b = supplierProductSchema.parse({ ...a, id: 'b-product', name: a.name })
const c = supplierProductSchema.parse({ ...a, id: 'c-product', name: a.name })
async function setup() {
  const indexedDB = new IDBFactory()
  const persistence = createLocalPersistence('catalog-order', { indexedDB, IDBKeyRange }); connections.push(persistence)
  value(await persistence.materials.create(validMaterialInput)); value(await persistence.suppliers.create(validSupplierInput))
  for (const product of [c, a, b]) value(await persistence.supplierProducts.create(product))
  value(await persistence.stockItems.create(validStockItemInput))
  return { indexedDB, persistence, products: createCatalogRepositories(persistence).supplierProducts }
}
describe('catalog presentation order', () => {
  it('has stable ID defaults, distinct duplicate names and no stale-reference recreation', () => {
    expect(orderCatalogProducts([c, a, b], []).map(product => product.id)).toEqual(['a-product', 'b-product', 'c-product'])
    const order = catalogOrderSchema.parse({ id: a.supplierId, productIds: ['removed', c.id, b.id] })
    expect(orderCatalogProducts([a, b, c], [order]).map(product => product.id)).toEqual(['c-product', 'b-product', 'a-product'])
    expect(catalogOrderSchema.safeParse({ id: a.supplierId, productIds: [a.id, a.id] }).success).toBe(false)
  })
  it('persists moves after reload without changing product data or inventory', async () => {
    const { indexedDB, persistence, products } = await setup()
    const before = await persistence.supplierProducts.list(); const stock = await persistence.stockItems.list()
    value(await products.move(c.id, a.id, 'before')); value(await products.move(a.id, b.id, 'after'))
    persistence.close()
    const reopened = createLocalPersistence('catalog-order', { indexedDB, IDBKeyRange }); connections.push(reopened)
    expect(await reopened.supplierProducts.list()).toEqual(before)
    const repository = createCatalogRepositories(reopened).supplierProducts
    expect(orderCatalogProducts(value(await repository.list()), value(await repository.ordering())).map(product => product.id)).toEqual(['c-product', 'b-product', 'a-product'])
    expect(await reopened.stockItems.list()).toEqual(stock)
    expect(value(await reopened.projectStock.list())).toEqual([])
    expect(value(await reopened.stockOrders.list())).toEqual([])
  })
  it('rechecks supplier/material membership and deleted targets before writing', async () => {
    const { persistence, products } = await setup()
    for (const other of [{ ...c, materialId: 'other-material' }, { ...c, supplierId: 'other-supplier' }]) {
      value(await persistence.supplierProducts.update(c.id, other))
      expect(await products.move(a.id, c.id, 'before')).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    }
    expect(value(await products.ordering())).toEqual([])
    value(await persistence.supplierProducts.delete(c.id))
    expect(await products.move(a.id, c.id, 'before')).toMatchObject({ ok: false, error: { kind: 'notFound' } })
  })
  it('leaves records and order unchanged on save failure', async () => {
    const { persistence, products } = await setup()
    const transaction = persistence.transaction.bind(persistence)
    vi.spyOn(persistence, 'transaction').mockImplementation(work => transaction(repositories => work({ ...repositories, catalogOrders: { ...repositories.catalogOrders, create: () => Promise.resolve({ ok: false, error: { kind: 'storageFailure', message: 'Disk full' } }) } })))
    expect(await products.move(c.id, a.id, 'before')).toMatchObject({ ok: false })
    expect(value(await products.ordering())).toEqual([])
    expect(value(await products.list())).toEqual([a, b, c])
  })
  it('upgrades v7 without modifying catalog, stock or stock ordering', async () => {
    const indexedDB = new IDBFactory()
    const old = new Dexie('catalog-upgrade', { indexedDB, IDBKeyRange }); old.version(7).stores(DATABASE_V7_STORES)
    await old.table('supplierProducts').add(a); await old.table('stockItems').add(validStockItemInput)
    await old.table('stockOrders').add({ id: validStockItemInput.materialId, stockItemIds: [validStockItemInput.id] }); old.close()
    const upgraded = createLocalPersistence('catalog-upgrade', { indexedDB, IDBKeyRange }); connections.push(upgraded)
    expect(value(await upgraded.supplierProducts.list())).toEqual([a])
    expect(value(await upgraded.stockItems.list())).toEqual([validStockItemInput])
    expect(value(await upgraded.stockOrders.list())).toEqual([{ id: validStockItemInput.materialId, stockItemIds: [validStockItemInput.id] }])
    expect(value(await upgraded.catalogOrders.list())).toEqual([])
  })
})
