// @vitest-environment node
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalPersistence } from '../../../infrastructure/persistence/local-database'
import { cuttingProjectSchema } from '../../../domain/model/cutting-project'
import { cuttingProjectIdSchema } from '../../../domain/model/ids'
import { materialSchema } from '../../../domain/model/material'
import { partSchema } from '../../../domain/model/part'
import { stockItemSchema } from '../../../domain/model/stock-item'
import { supplierProductSchema } from '../../../domain/model/supplier-product'
import { validMaterialInput, validPartInput, validSupplierInput, validSupplierProductInput, validStockItemInput } from '../../../domain/model/__tests__/fixtures'
import { createProjectService } from '../project-service'
import { createCatalogRepositories } from '../../catalog/catalog-repositories'
import type { PersistenceResult } from '../../persistence/repositories'

const first = cuttingProjectSchema.parse({ id: 'first', name: 'First cabinet', partIds: [], materialIds: [], supplierProductIds: [] })
const second = cuttingProjectSchema.parse({ ...first, id: 'second', name: 'Second cabinet' })
const part = partSchema.parse(validPartInput)
const material = materialSchema.parse(validMaterialInput)
const product = supplierProductSchema.parse(validSupplierProductInput)
let indexedDB: IDBFactory
let persistence: ReturnType<typeof createLocalPersistence>
let service: ReturnType<typeof createProjectService>
const connections: ReturnType<typeof createLocalPersistence>[] = []
function value<T>(result: PersistenceResult<T>): T {
  if (!result.ok) throw new Error(`Unexpected ${result.error.kind}`)
  return result.value
}
function connect() {
  const connection = createLocalPersistence('project-test', { indexedDB, IDBKeyRange })
  connections.push(connection)
  return connection
}
beforeEach(async () => {
  indexedDB = new IDBFactory()
  persistence = connect()
  service = createProjectService(persistence)
  value(await persistence.materials.create(material))
  value(await persistence.suppliers.create(validSupplierInput))
  value(await persistence.supplierProducts.create(product))
  value(await service.projects.create(first))
  value(await service.projects.create(second))
})
async function selectMaterial(projectId = first.id): Promise<void> {
  const project = value(await service.projects.get(projectId))
  value(await service.projects.update(projectId, { ...project, materialIds: [material.id] }))
}
afterEach(() => { for (const connection of connections) connection.close(); connections.length = 0; vi.restoreAllMocks() })

describe('Project ownership and selections', () => {
  it('creates stable projects, validates names/IDs and never overwrites duplicate IDs', async () => {
    expect(value(await service.projects.get(first.id))).toEqual(first)
    expect(await service.projects.create({ ...first, name: 'Overwrite' })).toMatchObject({ ok: false, error: { kind: 'duplicateId' } })
    for (const invalid of [{ ...first, id: '' }, { ...first, name: ' ' }, { ...first, extra: true }, { ...first, materialIds: [material.id, material.id] }]) {
      expect(await service.projects.create(invalid)).toMatchObject({ ok: false, error: { kind: 'invalidRecord' } })
    }
    expect(value(await service.projects.get(first.id))).toEqual(first)
  })
  it('isolates Parts CRUD and preserves every physical invariant', async () => {
    await selectMaterial()
    await selectMaterial(second.id)
    const a = service.parts(first.id)
    const b = service.parts(second.id)
    expect(value(await a.create(part))).toEqual(part)
    expect(value(await a.list())).toEqual([part])
    expect(value(await b.list())).toEqual([])
    for (const result of [await b.get(part.id), await b.update(part.id, part), await b.delete(part.id)]) {
      expect(result).toMatchObject({ ok: false, error: { kind: 'notFound' } })
    }
    expect(await b.create(part)).toMatchObject({ ok: false, error: { kind: 'duplicateId' } })
    const edited = { ...part, name: 'Changed only in first', lengthMm: 812, widthMm: 650, thicknessMm: 18, quantity: 4, grainDirection: 'width', rotation: 'allowed' }
    value(await a.update(part.id, edited))
    expect(value(await a.get(part.id))).toEqual(edited)
    expect(value(await b.list())).toEqual([])
    for (const key of ['lengthMm', 'widthMm', 'thicknessMm', 'quantity']) {
      expect(await a.update(part.id, { ...part, [key]: 0 })).toMatchObject({ ok: false, error: { kind: 'invalidRecord' } })
    }
    value(await a.delete(part.id))
    expect(value(await service.projects.get(first.id)).partIds).toEqual([])
    expect(value(await persistence.parts.list())).toEqual([])
  })
  it('rejects unknown projects, unknown materials and ownership edits outside the scoped workflow', async () => {
    const absent = cuttingProjectIdSchema.parse('missing')
    for (const result of [await service.parts(absent).list(), await service.parts(absent).create(part), await service.adoptLegacyParts(absent, [part.id])]) {
      expect(result).toMatchObject({ ok: false, error: { kind: 'notFound', id: absent } })
    }
    expect(await service.parts(first.id).create({ ...part, materialId: 'missing' })).toMatchObject({ ok: false, error: { kind: 'notFound' } })
    expect(await service.projects.update(first.id, { ...first, partIds: [part.id] })).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    expect(await service.projects.create({ ...first, id: 'new', partIds: [part.id] })).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    expect(value(await persistence.parts.list())).toEqual([])
  })
  it('persists isolated selections and Parts on reopening without modifying the catalog or stock', async () => {
    await selectMaterial()
    value(await service.parts(first.id).create(part))
    const owner = value(await service.projects.get(first.id))
    value(await service.projects.update(first.id, { ...owner, materialIds: [material.id], supplierProductIds: [product.id] }))
    persistence.close()
    const reopened = connect()
    const next = createProjectService(reopened)
    expect(value(await next.projects.get(first.id))).toMatchObject({ partIds: [part.id], materialIds: [material.id], supplierProductIds: [product.id] })
    expect(value(await next.projects.get(second.id))).toEqual(second)
    expect(value(await next.parts(second.id).list())).toEqual([])
    expect(value(await next.parts(first.id).list())).toEqual([part])
    expect(value(await reopened.materials.list())).toEqual([material])
    expect(value(await reopened.supplierProducts.list())).toEqual([product])
    expect(value(await reopened.stockItems.list())).toEqual([])
  })
  it('persists isolated stock selections, rejects missing references and retains disappeared sources for explicit removal', async () => {
    const stock = value(await persistence.stockItems.create(validStockItemInput))
    expect(await service.projects.update(first.id, { ...first, stockItemIds: ['missing-stock'] })).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    value(await service.projects.update(first.id, { ...first, stockItemIds: [stock.id] }))
    expect(value(await service.projects.get(second.id))).toEqual(second)
    const reopened = connect()
    expect(value(await reopened.projects.get(first.id)).stockItemIds).toEqual([stock.id])
    expect(value(await reopened.stockItems.list())).toEqual([stock])
    value(await persistence.stockItems.delete(stock.id))
    const owner = value(await service.projects.get(first.id))
    expect(owner.stockItemIds).toEqual([stock.id])
    expect(await service.projects.update(first.id, { ...owner, name: 'Keep selections' })).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    expect(value(await service.projects.get(first.id))).toEqual(owner)
    value(await service.projects.update(first.id, { ...owner, stockItemIds: [] }))
    expect(value(await persistence.stockItems.list())).toEqual([])
  })

  it('rejects invalid catalog selections without changing either project', async () => {
    for (const selections of [{ materialIds: ['missing'] }, { supplierProductIds: ['missing'] }]) {
      expect(await service.projects.update(first.id, { ...first, ...selections })).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    }
    value(await persistence.supplierProducts.update(product.id, { ...product, availability: 'unavailable' }))
    expect(await service.projects.update(first.id, { ...first, supplierProductIds: [product.id] })).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    expect(value(await service.projects.get(first.id))).toEqual(first)
    expect(value(await service.projects.get(second.id))).toEqual(second)
  })
  it('blocks catalog deletion of selected records but permits independent catalog edits', async () => {
    value(await service.projects.update(first.id, { ...first, materialIds: [material.id], supplierProductIds: [product.id] }))
    const catalog = createCatalogRepositories(persistence)
    expect(await catalog.supplierProducts.delete(product.id)).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    expect(await catalog.materials.delete(material.id)).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    value(await catalog.supplierProducts.update(product.id, { ...product, price: 112, availability: 'unavailable' }))
    const saved = value(await service.projects.get(first.id))
    expect(saved.supplierProductIds).toEqual([product.id])
    value(await service.projects.update(first.id, { ...saved, name: 'Renamed project keeps unavailable selections' }))
    expect(value(await service.projects.get(first.id)).supplierProductIds).toEqual([product.id])
    value(await service.projects.update(first.id, first))
    value(await catalog.supplierProducts.delete(product.id))
    value(await catalog.materials.delete(material.id))
  })
  it('keeps legacy parts unassigned until explicit adoption and prevents duplicate ownership across connections', async () => {
    value(await persistence.parts.create(part))
    expect(value(await service.parts(first.id).list())).toEqual([])
    expect(value(await service.parts(second.id).list())).toEqual([])
    expect(value(await service.listLegacyParts())).toEqual([part])
    const other = createProjectService(connect())
    const results = await Promise.all([service.adoptLegacyParts(first.id, [part.id]), other.adoptLegacyParts(second.id, [part.id])])
    expect(results.filter(result => result.ok)).toHaveLength(1)
    expect(results.find(result => !result.ok)).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    expect(value(await persistence.parts.get(part.id))).toEqual(part)
    expect(value(await service.listLegacyParts())).toEqual([])
    expect([...value(await service.parts(first.id).list()), ...value(await service.parts(second.id).list())]).toEqual([part])
  })
  it('rolls back the entire legacy adoption if any requested part is missing', async () => {
    value(await persistence.parts.create(part))
    const missing = partSchema.parse({ ...part, id: 'missing' }).id
    expect(await service.adoptLegacyParts(first.id, [part.id, missing])).toMatchObject({ ok: false, error: { kind: 'notFound' } })
    expect(value(await service.projects.get(first.id))).toEqual(first)
    expect(value(await service.listLegacyParts())).toEqual([part])
  })
  it('rolls back a Part insert if the ownership write fails', async () => {
    await selectMaterial()
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError') })
    expect(await service.parts(first.id).create(part)).toMatchObject({ ok: false, error: { kind: 'storageFailure' } })
    put.mockRestore()
    expect(value(await persistence.parts.list())).toEqual([])
    expect(value(await service.projects.get(first.id))).toEqual({ ...first, materialIds: [material.id] })
  })
  it('rolls back a Part deletion if updating its owner fails', async () => {
    await selectMaterial()
    value(await service.parts(first.id).create(part))
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError') })
    expect(await service.parts(first.id).delete(part.id)).toMatchObject({ ok: false, error: { kind: 'storageFailure' } })
    put.mockRestore()
    expect(value(await service.parts(first.id).list())).toEqual([part])
    expect(value(await service.projects.get(first.id)).partIds).toEqual([part.id])
  })
  it('rejects conflicting stored ownership rather than exposing or changing another project’s Part', async () => {
    await selectMaterial()
    value(await service.parts(first.id).create(part))
    value(await persistence.projects.update(second.id, { ...second, partIds: [part.id] }))
    for (const result of [await service.parts(first.id).list(), await service.parts(second.id).get(part.id), await service.parts(second.id).delete(part.id)]) {
      expect(result).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    }
    expect(value(await persistence.parts.get(part.id))).toEqual(part)
  })
  it('reports dangling Part references instead of skipping them', async () => {
    value(await persistence.projects.update(first.id, { ...first, partIds: [part.id] }))
    expect(await service.parts(first.id).list()).toMatchObject({ ok: false, error: { kind: 'notFound', id: part.id } })
  })
  it('rejects creation without project selections even when the catalog material exists', async () => {
    const result = await service.parts(first.id).create(part)
    expect(result).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    if (!result.ok && result.error.kind === 'referenceConflict') expect(result.error.message).toContain('Materials tab')
    expect(value(await persistence.parts.list())).toEqual([])
    expect(value(await service.projects.get(first.id))).toEqual(first)
    expect(value(await persistence.materials.list())).toEqual([material])
    expect(value(await persistence.stockItems.list())).toEqual([])
  })
  it('creates a Part with a directly selected material and no supplier product requirement', async () => {
    await selectMaterial()
    value(await persistence.supplierProducts.delete(product.id))
    value(await persistence.suppliers.delete(product.supplierId))
    expect(value(await service.parts(first.id).create(part))).toEqual(part)
    expect(value(await service.projects.get(first.id)).supplierProductIds).toEqual([])
    expect(value(await persistence.materials.list())).toEqual([material])
  })
  it('preserves material availability through existing selected panel products', async () => {
    value(await service.projects.update(first.id, { ...first, supplierProductIds: [product.id] }))
    expect(value(await service.parts(first.id).create(part))).toEqual(part)
    expect(value(await service.projects.get(first.id)).materialIds).toEqual([])
    expect(value(await persistence.supplierProducts.get(product.id))).toEqual(product)
  })
  it('creates and edits Parts from stock-only material selections after reopening without changing inventory', async () => {
    const stock = stockItemSchema.parse({ ...validStockItemInput, provenance: { source: 'cutting', projectId: second.id, savedPlanId: 'other-origin', supplierProductId: product.id, panelIndex: 0, wasteIndex: 0 } })
    value(await persistence.stockItems.create(stock))
    value(await persistence.stockItems.create({ ...stock, id: 'another-stock-panel', thicknessMm: 30, provenance: { source: 'manual' } }))
    value(await service.projects.update(first.id, { ...first, stockItemIds: [stock.id, stockItemSchema.shape.id.parse('another-stock-panel')] }))
    const inventory = value(await persistence.stockItems.list())
    const reopened = createProjectService(connect())
    expect(value(await reopened.parts(first.id).create(part))).toEqual(part)
    expect(value(await reopened.parts(first.id).update(part.id, { ...part, name: 'Updated stock part' })).name).toBe('Updated stock part')
    expect(value(await reopened.projects.get(first.id))).toMatchObject({ materialIds: [], supplierProductIds: [], stockItemIds: [stock.id, 'another-stock-panel'], partIds: [part.id] })
    expect(value(await persistence.stockItems.list())).toEqual(inventory)
    // Saved choices are reread atomically, so a stale form cannot retain eligibility after deselection.
    const owner = value(await reopened.projects.get(first.id))
    value(await service.projects.update(first.id, { ...owner, stockItemIds: [] }))
    expect(await reopened.parts(first.id).create({ ...part, id: 'stale-stock-part' })).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    expect(value(await reopened.parts(first.id).list())).toHaveLength(1)
  })
  it('rejects own-project offcuts as Parts material sources while preserving existing circular selections', async () => {
    const stock = stockItemSchema.parse({ ...validStockItemInput, provenance: { source: 'cutting', projectId: first.id, savedPlanId: 'own-origin', supplierProductId: product.id, panelIndex: 0, wasteIndex: 0 } })
    value(await persistence.stockItems.create(stock))
    value(await persistence.projects.update(first.id, { ...first, stockItemIds: [stock.id] }))
    expect(await service.parts(first.id).create(part)).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    expect(value(await persistence.projects.get(first.id)).stockItemIds).toEqual([stock.id])
    expect(value(await persistence.stockItems.get(stock.id))).toEqual(stock)
    expect(value(await persistence.parts.list())).toEqual([])
  })

  it('rejects another project’s material choices and same-name material identities', async () => {
    await selectMaterial()
    expect(await service.parts(second.id).create({ ...part, id: 'second-part' })).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    const different = materialSchema.parse({ ...material, id: 'different-material' })
    value(await persistence.materials.create(different))
    expect(await service.parts(first.id).create({ ...part, materialId: different.id })).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    expect(value(await persistence.parts.list())).toEqual([])
    expect(value(await service.projects.get(second.id))).toEqual(second)
  })
  it('preserves existing Parts after deselection and rejects stale creates, updates and reassignment', async () => {
    await selectMaterial()
    const scoped = service.parts(first.id)
    value(await scoped.create(part))
    const owner = value(await service.projects.get(first.id))
    const other = createProjectService(connect())
    value(await other.projects.update(first.id, { ...owner, materialIds: [] }))
    expect(value(await scoped.list())).toEqual([part])
    expect(await scoped.create({ ...part, id: 'stale-new-part' })).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    expect(await scoped.update(part.id, { ...part, name: 'Stale edit' })).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    expect(value(await persistence.parts.get(part.id))).toEqual(part)
    const replacement = materialSchema.parse({ ...material, id: 'replacement-material', name: 'Replacement' })
    value(await persistence.materials.create(replacement))
    value(await service.projects.update(first.id, { ...owner, materialIds: [replacement.id] }))
    expect(await scoped.update(part.id, part)).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    expect(value(await scoped.update(part.id, { ...part, materialId: replacement.id }))).toEqual({ ...part, materialId: replacement.id })
    expect(value(await persistence.stockItems.list())).toEqual([])
  })
  it('rejects broken selected-product references without a partial Part or ownership write', async () => {
    value(await service.projects.update(first.id, { ...first, supplierProductIds: [product.id] }))
    value(await persistence.supplierProducts.delete(product.id))
    expect(await service.parts(first.id).create(part)).toMatchObject({ ok: false, error: { kind: 'notFound' } })
    expect(value(await persistence.parts.list())).toEqual([])
    expect(value(await service.projects.get(first.id)).partIds).toEqual([])
  })

})
