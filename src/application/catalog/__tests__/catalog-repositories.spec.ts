import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validMaterialInput, validPartInput, validStockItemInput, validSupplierInput, validSupplierProductInput } from '../../../domain/model/__tests__/fixtures'
import { materialSchema } from '../../../domain/model/material'
import { supplierSchema } from '../../../domain/model/supplier'
import { supplierProductSchema } from '../../../domain/model/supplier-product'
import { stockItemSchema } from '../../../domain/model/stock-item'
import { createLocalPersistence } from '../../../infrastructure/persistence/local-database'
import { createCatalogRepositories } from '../catalog-repositories'

const supplier = supplierSchema.parse(validSupplierInput)
const material = materialSchema.parse(validMaterialInput)
const product = supplierProductSchema.parse(validSupplierProductInput)
let persistence: ReturnType<typeof createLocalPersistence>
let catalog: ReturnType<typeof createCatalogRepositories>
beforeEach(async () => {
  persistence = createLocalPersistence('catalog-tests', { indexedDB: new IDBFactory(), IDBKeyRange })
  catalog = createCatalogRepositories(persistence)
  expect((await persistence.materials.create(material)).ok).toBe(true)
  expect((await catalog.suppliers.create(supplier)).ok).toBe(true)
})
afterEach(() => { persistence.close(); vi.restoreAllMocks() })

describe('catalog application repositories', () => {
  it('supports supplier and product CRUD without creating owned stock', async () => {
    expect(await catalog.suppliers.get(supplier.id)).toEqual({ ok: true, value: supplier })
    const updatedSupplier = supplierSchema.parse({ ...supplier, name: 'Updated store' })
    expect(await catalog.suppliers.update(supplier.id, updatedSupplier)).toEqual({ ok: true, value: updatedSupplier })
    expect(await catalog.suppliers.list()).toEqual({ ok: true, value: [updatedSupplier] })
    expect(await catalog.supplierProducts.create(product)).toEqual({ ok: true, value: product })
    const updatedProduct = supplierProductSchema.parse({ ...product, price: 0, thicknessMm: 19, availability: 'unavailable' })
    expect(await catalog.supplierProducts.update(product.id, updatedProduct)).toEqual({ ok: true, value: updatedProduct })
    expect(await catalog.supplierProducts.get(product.id)).toEqual({ ok: true, value: updatedProduct })
    expect(await catalog.supplierProducts.list()).toEqual({ ok: true, value: [updatedProduct] })
    expect(await persistence.stockItems.list()).toEqual({ ok: true, value: [] })
    expect((await catalog.supplierProducts.delete(product.id)).ok).toBe(true)
    expect((await catalog.suppliers.delete(supplier.id)).ok).toBe(true)
    expect(await catalog.suppliers.list()).toEqual({ ok: true, value: [] })
  })

  it.each(['supplierId', 'materialId'] as const)('rejects a missing %s on create and update without changing existing products', async (field) => {
    expect((await catalog.supplierProducts.create(product)).ok).toBe(true)
    const invalidReference = { ...product, [field]: 'missing-reference', name: 'Unsaved' }
    const created = await catalog.supplierProducts.create({ ...invalidReference, id: 'new-product' })
    const updated = await catalog.supplierProducts.update(product.id, invalidReference)
    expect(created).toEqual({ ok: false, error: { kind: 'notFound', id: 'missing-reference' } })
    expect(updated).toEqual(created)
    expect(await catalog.supplierProducts.list()).toEqual({ ok: true, value: [product] })
  })

  it.each([
    { lengthMm: 0 }, { widthMm: -1 }, { thicknessMm: undefined }, { price: -1 },
    { price: Infinity }, { price: NaN }, { currency: 'eur' }, { grainDirection: 'invalid' },
    { availability: 'invalid' }, { productUrl: 'javascript:alert(1)' }, { extra: 'unknown' },
  ])('rejects invalid products %j', async (changes) => {
    const result = await catalog.supplierProducts.create({ ...product, ...changes })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('invalidRecord')
    expect(await catalog.supplierProducts.list()).toEqual({ ok: true, value: [] })
  })

  it('rejects duplicate IDs, changed IDs, and missing records explicitly', async () => {
    await catalog.supplierProducts.create(product)
    expect(await catalog.supplierProducts.create({ ...product, price: 1 })).toEqual({ ok: false, error: { kind: 'duplicateId', id: product.id } })
    const changedId = await catalog.supplierProducts.update(product.id, { ...product, id: 'another-product' })
    expect(changedId.ok).toBe(false)
    const missingId = supplierProductSchema.shape.id.parse('missing-product')
    expect(await catalog.supplierProducts.update(missingId, { ...product, id: missingId })).toEqual({ ok: false, error: { kind: 'notFound', id: missingId } })
    expect(await catalog.supplierProducts.delete(missingId)).toEqual({ ok: false, error: { kind: 'notFound', id: missingId } })
    expect(await catalog.supplierProducts.get(product.id)).toEqual({ ok: true, value: product })
  })

  it('blocks referenced supplier deletion and allows it after product removal', async () => {
    await catalog.supplierProducts.create(product)
    const result = await catalog.suppliers.delete(supplier.id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('referenceConflict')
    expect(await catalog.suppliers.get(supplier.id)).toEqual({ ok: true, value: supplier })
    await catalog.supplierProducts.delete(product.id)
    expect((await catalog.suppliers.delete(supplier.id)).ok).toBe(true)
  })

  it('blocks deletion of products referenced by purchase provenance', async () => {
    await catalog.supplierProducts.create(product)
    const stock = stockItemSchema.parse({ ...validStockItemInput, provenance: { source: 'purchase', supplierProductId: product.id } })
    await persistence.stockItems.create(stock)
    const result = await catalog.supplierProducts.delete(product.id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('referenceConflict')
    expect(await catalog.supplierProducts.get(product.id)).toEqual({ ok: true, value: product })
    expect(await persistence.stockItems.get(stock.id)).toEqual({ ok: true, value: stock })
  })

  it.each(['parts', 'supplierProducts', 'stockItems'] as const)('blocks material deletion while referenced by %s', async (store) => {
    if (store === 'parts') await persistence.parts.create(validPartInput)
    if (store === 'supplierProducts') await catalog.supplierProducts.create(product)
    if (store === 'stockItems') await persistence.stockItems.create(validStockItemInput)
    const result = await catalog.materials.delete(material.id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('referenceConflict')
    expect(await catalog.materials.get(material.id)).toEqual({ ok: true, value: material })
  })

  it('allows deletion of unreferenced materials and rejects missing ones', async () => {
    expect((await catalog.materials.delete(material.id)).ok).toBe(true)
    expect(await catalog.materials.delete(material.id)).toEqual({ ok: false, error: { kind: 'notFound', id: material.id } })
  })

  it.each(['supplier', 'material'] as const)('serializes concurrent product creation and %s deletion safely', async (entity) => {
    const [created, deleted] = await Promise.all([
      catalog.supplierProducts.create(product),
      entity === 'supplier' ? catalog.suppliers.delete(supplier.id) : catalog.materials.delete(material.id),
    ])
    expect(created.ok && deleted.ok).toBe(false)
    const saved = await catalog.supplierProducts.list()
    if (saved.ok && saved.value.length > 0) {
      expect((await catalog.suppliers.get(supplier.id)).ok).toBe(true)
      expect((await catalog.materials.get(material.id)).ok).toBe(true)
    }
  })

  it('propagates transaction failures without claiming successful writes or deletes', async () => {
    const failure = { ok: false, error: { kind: 'storageFailure', message: 'Storage blocked' } } as const
    vi.spyOn(persistence, 'transaction').mockResolvedValue(failure)
    expect(await catalog.supplierProducts.create(product)).toEqual(failure)
    expect(await catalog.suppliers.delete(supplier.id)).toEqual(failure)
    expect(await catalog.materials.delete(material.id)).toEqual(failure)
    expect(await catalog.suppliers.get(supplier.id)).toEqual({ ok: true, value: supplier })
  })

  it('persists catalog records across database reopening', async () => {
    const indexedDB = new IDBFactory()
    const first = createLocalPersistence('catalog-reopen', { indexedDB, IDBKeyRange })
    const second = createLocalPersistence('catalog-reopen', { indexedDB, IDBKeyRange })
    try {
      const guarded = createCatalogRepositories(first)
      await guarded.materials.create(material)
      await guarded.suppliers.create(supplier)
      await guarded.supplierProducts.create(product)
      first.close()
      const reopened = createCatalogRepositories(second)
      expect(await reopened.suppliers.list()).toEqual({ ok: true, value: [supplier] })
      expect(await reopened.supplierProducts.list()).toEqual({ ok: true, value: [product] })
      expect(await second.stockItems.list()).toEqual({ ok: true, value: [] })
    } finally { first.close(); second.close() }
  })
})
