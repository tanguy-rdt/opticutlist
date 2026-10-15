import { createCatalogRepositories } from '../catalog-repositories'
import { orderCatalogProducts } from '../catalog-order'
import { materialIdSchema, supplierIdSchema, supplierProductIdSchema } from '../../../domain/model/ids'
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { createLocalPersistence } from '../../../infrastructure/persistence/local-database'
import { projectJson } from '../../../infrastructure/projects/project-json'
import { createCatalogTransferService } from '../catalog-transfer-service'
import { catalogTransferSchema, validateCatalogTransfer } from '../catalog-transfer-format'
import { validMaterialInput, validSupplierInput, validSupplierProductInput, validStockItemInput, validPartInput } from '../../../domain/model/__tests__/fixtures'
const connections: ReturnType<typeof createLocalPersistence>[] = []
afterEach(() => { connections.forEach(connection => { connection.close() }); connections.length = 0; vi.restoreAllMocks() })
function database() {
  const indexedDB = new IDBFactory()
  const persistence = createLocalPersistence('catalog-transfer', { indexedDB, IDBKeyRange }); connections.push(persistence)
  return { indexedDB, persistence, service: createCatalogTransferService(persistence, projectJson) }
}
const file = catalogTransferSchema.parse({ format: 'opticutlist-catalog', schemaVersion: 1, catalog: { materials: [validMaterialInput], suppliers: [validSupplierInput], products: [validSupplierProductInput] } })
async function snapshot(persistence: ReturnType<typeof createLocalPersistence>) {
  return { materials: await persistence.materials.list(), suppliers: await persistence.suppliers.list(), products: await persistence.supplierProducts.list(), projects: await persistence.projects.list(), parts: await persistence.parts.list(), stock: await persistence.stockItems.list(), plans: await persistence.savedPlanContents.list(), confirmations: await persistence.cuttingConfirmations.list() }
}
describe('portable catalog transfer', () => {
  it.each(['available', 'unavailable', 'unknown'] as const)('retains legacy product availability %s in catalog transfers and persisted reads', async availability => {
    const target = database()
    const legacy = { ...file, catalog: { ...file.catalog, products: file.catalog.products.map(product => ({ ...product, availability })) } }
    const preview = await target.service.preview(JSON.stringify(legacy))
    if (!preview.ok) throw new Error('Legacy preview failed')
    expect((await target.service.import(preview.value.file, true)).ok).toBe(true)
    expect(await target.persistence.supplierProducts.list()).toEqual({ ok: true, value: legacy.catalog.products })
    const exported = await target.service.export()
    if (!exported.ok) throw new Error('Export failed')
    expect(catalogTransferSchema.parse(JSON.parse(exported.value)).catalog.products).toEqual(legacy.catalog.products)
  })
  it('exports and imports all catalog attributes with relationships and readable UTF-8 JSON, retaining data after reopening', async () => {
    const source = database(); const target = database()
    await source.persistence.materials.create({ ...validMaterialInput, name: 'Étagère 木' }); await source.persistence.suppliers.create(validSupplierInput); await source.persistence.supplierProducts.create(validSupplierProductInput)
    await source.persistence.stockItems.create(validStockItemInput); await source.persistence.parts.create(validPartInput)
    await source.persistence.projects.create({ id: 'unrelated', name: 'Project', partIds: [], materialIds: [], supplierProductIds: [] })
    const before = await snapshot(source.persistence)
    const exported = await source.service.export(); if (!exported.ok) throw new Error('Export')
    expect(exported.value).toContain('Étagère 木'); expect(exported.value).toContain('\n  "schemaVersion": 1'); expect(exported.value.endsWith('\n')).toBe(true)
    const preview = await target.service.preview('\ufeff' + exported.value); if (!preview.ok) throw new Error('Preview')
    expect(preview.value).toMatchObject({ conflicts: 0, reused: 0 })
    expect(await target.persistence.materials.list()).toEqual({ ok: true, value: [] })
    const imported = await target.service.import(preview.value.file, true); expect(imported).toEqual({ ok: true, value: preview.value.file })
    expect(await target.persistence.supplierProducts.list()).toEqual({ ok: true, value: file.catalog.products })
    expect(await target.service.export()).toEqual(exported); expect(await snapshot(source.persistence)).toEqual(before)
    for (const key of ['stockItems', 'projects', 'parts', 'savedPlans', 'pdf', 'canvas', 'history']) expect(exported.value).not.toContain(`"${key}"`)
    expect(await target.persistence.projects.list()).toEqual({ ok: true, value: [] }); expect(await target.persistence.stockItems.list()).toEqual({ ok: true, value: [] })
    target.persistence.close(); const reopened = createLocalPersistence('catalog-transfer', { indexedDB: target.indexedDB, IDBKeyRange }); connections.push(reopened)
    expect(await reopened.supplierProducts.list()).toEqual({ ok: true, value: file.catalog.products })
  })
  it('round-trips renamed preset references without images and remaps thumbnail metadata conflicts', async () => {
    const source = database(); const target = database()
    await source.persistence.materials.create({ ...validMaterialInput, name: 'Pin Douglas', libraryPresetId: 'pin' })
    await source.persistence.suppliers.create(validSupplierInput); await source.persistence.supplierProducts.create(validSupplierProductInput)
    const exported = await source.service.export(); if (!exported.ok) throw new Error('Export')
    expect(exported.value).toContain('"libraryPresetId": "pin"')
    expect(exported.value).not.toMatch(/data:image|webp|thumbnail|textures/)
    const preview = await target.service.preview(exported.value); if (!preview.ok) throw new Error('Preview')
    expect((await target.service.import(preview.value.file, true)).ok).toBe(true)
    target.persistence.close()
    const reopened = createLocalPersistence('catalog-transfer', { indexedDB: target.indexedDB, IDBKeyRange }); connections.push(reopened)
    expect(await reopened.materials.list()).toMatchObject({ ok: true, value: [{ name: 'Pin Douglas', libraryPresetId: 'pin' }] })
    await reopened.materials.update(materialIdSchema.parse(validMaterialInput.id), { ...validMaterialInput, name: 'Pin Douglas', libraryPresetId: 'sapin' })
    const service = createCatalogTransferService(reopened, projectJson)
    const imported = await service.import(preview.value.file, true); if (!imported.ok) throw new Error('Import')
    expect(imported.value.catalog.materials[0]?.id).not.toBe(validMaterialInput.id)
    expect(imported.value.catalog.materials[0]?.libraryPresetId).toBe('pin')
    expect(imported.value.catalog.products[0]?.materialId).toBe(imported.value.catalog.materials[0]?.id)
    expect(await reopened.stockItems.list()).toEqual({ ok: true, value: [] })
  })
  it('round-trips an empty catalog', async () => {
    const { service } = database(); const exported = await service.export(); if (!exported.ok) throw new Error('Export')
    const preview = await service.preview(exported.value); if (!preview.ok) throw new Error('Preview')
    expect(preview.value.file.catalog).toEqual({ materials: [], suppliers: [], products: [] })
    expect(await service.import(preview.value.file, true)).toEqual({ ok: true, value: preview.value.file })
  })
  it('requires consent and reuses only identical same-ID records on repeat imports', async () => {
    const { service, persistence } = database()
    expect((await service.import(file, false)).ok).toBe(false); expect(await persistence.materials.list()).toEqual({ ok: true, value: [] })
    expect((await service.import(file, true)).ok).toBe(true)
    expect(await service.preview(JSON.stringify(file))).toMatchObject({ ok: true, value: { conflicts: 0, reused: 3 } })
    expect((await service.import(file, true)).ok).toBe(true)
    expect(await persistence.materials.list()).toEqual({ ok: true, value: file.catalog.materials })
  })
  it('remaps conflicting IDs and dependent products without modifying projects, inventory or original catalog records', async () => {
    const { service, persistence } = database(); await service.import(file, true)
    await persistence.materials.update(materialIdSchema.parse(validMaterialInput.id), { ...validMaterialInput, name: 'Different' })
    await persistence.suppliers.update(supplierIdSchema.parse(validSupplierInput.id), { ...validSupplierInput, name: 'Different supplier' })
    await persistence.stockItems.create(validStockItemInput)
    await persistence.projects.create({ id: 'existing', name: 'Existing', partIds: [], materialIds: [validMaterialInput.id], supplierProductIds: [validSupplierProductInput.id] })
    const before = await snapshot(persistence)
    expect(await service.preview(JSON.stringify(file))).toMatchObject({ ok: true, value: { conflicts: 3, reused: 0 } })
    const result = await service.import(file, true); if (!result.ok) throw new Error('Import')
    const material = result.value.catalog.materials[0]; const supplier = result.value.catalog.suppliers[0]; const product = result.value.catalog.products[0]
    expect(material?.id).not.toBe(validMaterialInput.id); expect(supplier?.id).not.toBe(validSupplierInput.id); expect(product?.id).not.toBe(validSupplierProductInput.id)
    expect(product?.materialId).toBe(material?.id); expect(product?.supplierId).toBe(supplier?.id)
    expect(await persistence.stockItems.list()).toEqual(before.stock); expect(await persistence.projects.list()).toEqual(before.projects)
    expect(await persistence.supplierProducts.get(supplierProductIdSchema.parse(validSupplierProductInput.id))).toEqual({ ok: true, value: file.catalog.products[0] })
  })
  it('rechecks conflicts after preview and does not merge records with different opaque IDs', async () => {
    const { service, persistence } = database()
    const preview = await service.preview(JSON.stringify(file)); if (!preview.ok) throw new Error('Preview')
    await persistence.materials.create({ ...validMaterialInput, name: 'Conflict created after preview' })
    await persistence.suppliers.create({ ...validSupplierInput, id: 'different-identity' })
    const result = await service.import(preview.value.file, true); if (!result.ok) throw new Error('Import')
    expect(result.value.catalog.materials[0]?.id).not.toBe(validMaterialInput.id)
    const suppliers = await persistence.suppliers.list(); if (!suppliers.ok) throw new Error('Suppliers')
    expect(suppliers.value.map(supplier => supplier.id).sort()).toEqual(['different-identity', validSupplierInput.id].sort())
  })
  it('serializes concurrent imports and reuses the first committed identical records', async () => {
    const { service, persistence } = database()
    const results = await Promise.all([service.import(file, true), service.import(file, true)])
    expect(results.every(result => result.ok)).toBe(true)
    expect(await persistence.materials.list()).toEqual({ ok: true, value: file.catalog.materials })
    expect(await persistence.supplierProducts.list()).toEqual({ ok: true, value: file.catalog.products })
  })
  it('reserves dangling references instead of attaching imported entities to unrelated data', async () => {
    const { service, persistence } = database()
    await persistence.stockItems.create(validStockItemInput)
    await persistence.projects.create({ id: 'dangling', name: 'Dangling', partIds: [], materialIds: [validMaterialInput.id], supplierProductIds: [validSupplierProductInput.id] })
    const result = await service.import(file, true); if (!result.ok) throw new Error('Import')
    expect(result.value.catalog.materials[0]?.id).not.toBe(validMaterialInput.id)
    expect(result.value.catalog.products[0]?.id).not.toBe(validSupplierProductInput.id)
  })
  it.each([
    { ...file, format: 'opticutlist-project' }, { ...file, schemaVersion: 2 }, { ...file, inventory: [] },
    { ...file, catalog: { ...file.catalog, materials: [] } }, { ...file, catalog: { ...file.catalog, suppliers: [] } },
    ...['materials', 'suppliers', 'products'].map(key => ({ ...file, catalog: { ...file.catalog, [key]: key === 'materials' ? [...file.catalog.materials, ...file.catalog.materials] : key === 'suppliers' ? [...file.catalog.suppliers, ...file.catalog.suppliers] : [...file.catalog.products, ...file.catalog.products] } })),
    ...['lengthMm', 'widthMm', 'thicknessMm', 'price'].map(key => ({ ...file, catalog: { ...file.catalog, products: [{ ...validSupplierProductInput, [key]: -1 }] } })),
    ...['lengthMm', 'widthMm', 'thicknessMm', 'price', 'currency', 'grainDirection'].map(key => ({ ...file, catalog: { ...file.catalog, products: [{ ...validSupplierProductInput, [key]: 'invalid' }] } })),
  ])('rejects invalid files before writing: %j', async input => {
    const { service, persistence } = database(); const before = await snapshot(persistence)
    expect(validateCatalogTransfer(input).ok).toBe(false); expect((await service.import(input, true)).ok).toBe(false)
    expect((await service.preview(JSON.stringify(input))).ok).toBe(false); expect(await snapshot(persistence)).toEqual(before)
  })
  it('rejects malformed JSON and incomplete catalog exports explicitly', async () => {
    const { service, persistence } = database()
    expect((await service.preview('{bad')).ok).toBe(false)
    await persistence.supplierProducts.create(validSupplierProductInput)
    expect((await service.export()).ok).toBe(false)
  })
  it('rolls back earlier inserts when a later write fails', async () => {
    const { service, persistence } = database(); const before = await snapshot(persistence)
    const transaction = persistence.transaction.bind(persistence)
    vi.spyOn(persistence, 'transaction').mockImplementation(work => transaction(repositories => work({ ...repositories, supplierProducts: { ...repositories.supplierProducts, create: () => Promise.resolve({ ok: false, error: { kind: 'storageFailure', message: 'Disk full' } }) } })))
    expect(await service.import(file, true)).toMatchObject({ ok: false, error: { kind: 'storageFailure' } })
    expect(await snapshot(persistence)).toEqual(before)
  })
})


describe('catalog order exchange', () => {
  const ordered = catalogTransferSchema.parse({ ...file, catalog: { ...file.catalog, products: [{ ...validSupplierProductInput, id: 'a-product' }, { ...validSupplierProductInput, id: 'b-product' }] }, catalogOrders: [{ id: validSupplierInput.id, productIds: ['b-product', 'a-product'] }] })
  it('round-trips manual ordering and keeps existing local ranks when importing again', async () => {
    const source = database(); const target = database()
    expect((await source.service.import(ordered, true)).ok).toBe(true)
    const exported = await source.service.export(); if (!exported.ok) throw new Error('Export failed')
    const preview = await target.service.preview(exported.value); if (!preview.ok) throw new Error('Preview failed')
    expect((await target.service.import(preview.value.file, true)).ok).toBe(true)
    const products = await target.persistence.supplierProducts.list(); const orders = await target.persistence.catalogOrders.list()
    if (!products.ok || !orders.ok) throw new Error('Read failed')
    expect(orderCatalogProducts(products.value, orders.value).map(product => product.id)).toEqual(['b-product', 'a-product'])
    const first = products.value[0]; const second = products.value[1]; if (!first || !second) throw new Error('Fixture')
    await createCatalogRepositories(target.persistence).supplierProducts.move(first.id, second.id, 'before')
    const local = await target.persistence.catalogOrders.list()
    expect((await target.service.import(ordered, true)).ok).toBe(true)
    expect(await target.persistence.catalogOrders.list()).toEqual(local)
    expect(await target.persistence.stockItems.list()).toEqual({ ok: true, value: [] })
  })
  it('remaps supplier and product order IDs with conflicting catalog entities', async () => {
    const { service, persistence } = database()
    await persistence.materials.create(validMaterialInput)
    await persistence.suppliers.create({ ...validSupplierInput, name: 'Existing supplier' })
    await persistence.supplierProducts.create({ ...validSupplierProductInput, id: 'a-product', name: 'Existing panel' })
    const imported = await service.import(ordered, true); if (!imported.ok) throw new Error('Import failed')
    const order = imported.value.catalogOrders?.[0]
    expect(order?.id).not.toBe(validSupplierInput.id)
    expect(order?.productIds[1]).not.toBe('a-product')
    expect(imported.value.catalog.products.every(product => product.supplierId === order?.id)).toBe(true)
    expect(new Set(order?.productIds)).toEqual(new Set(imported.value.catalog.products.map(product => product.id)))
    expect(await persistence.catalogOrders.list()).toEqual({ ok: true, value: imported.value.catalogOrders })
  })
  it('accepts old catalogs without order metadata and rejects missing or wrong-supplier references', async () => {
    expect(validateCatalogTransfer(file).ok).toBe(true)
    expect(validateCatalogTransfer({ ...ordered, catalogOrders: [{ id: validSupplierInput.id, productIds: ['missing'] }] }).ok).toBe(false)
    expect(validateCatalogTransfer({ ...ordered, catalogOrders: [{ id: 'another-supplier', productIds: ['a-product'] }] }).ok).toBe(false)
    const target = database()
    await target.service.import(ordered, true)
    const before = await target.persistence.catalogOrders.list()
    await target.service.import(file, true)
    expect(await target.persistence.catalogOrders.list()).toEqual(before)
  })
  it('rolls back imported entities when order persistence fails', async () => {
    const { persistence, service } = database()
    const transaction = persistence.transaction.bind(persistence)
    vi.spyOn(persistence, 'transaction').mockImplementation(work => transaction(repositories => work({ ...repositories, catalogOrders: { ...repositories.catalogOrders, create: () => Promise.resolve({ ok: false, error: { kind: 'storageFailure', message: 'Disk full' } }) } })))
    expect(await service.import(ordered, true)).toMatchObject({ ok: false })
    expect(await persistence.materials.list()).toEqual({ ok: true, value: [] })
    expect(await persistence.suppliers.list()).toEqual({ ok: true, value: [] })
    expect(await persistence.supplierProducts.list()).toEqual({ ok: true, value: [] })
    expect(await persistence.catalogOrders.list()).toEqual({ ok: true, value: [] })
  })
})
