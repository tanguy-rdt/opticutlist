// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { createLocalPersistence, DATABASE_VERSION, DATABASE_STORES, DATABASE_V3_STORES } from '../../../infrastructure/persistence/local-database'
import { createSavedPlanService } from '../../plans/saved-plan-service'
import { createCuttingConfirmationService } from '../cutting-confirmation-service'
import { optimizeProject } from '../../../domain/optimizer/optimize-project'
import { cuttingProjectSchema } from '../../../domain/model/cutting-project'
import { savedPlanSummarySchema, panelSnapshotSchema } from '../../../domain/model/saved-cutting-plan'
import { stockItemSchema } from '../../../domain/model/stock-item'
import { supplierProductSchema } from '../../../domain/model/supplier-product'
import { partSchema } from '../../../domain/model/part'
import { validPartInput, validSupplierProductInput, validMaterialInput, validStockItemInput } from '../../../domain/model/__tests__/fixtures'

const connections: { close(): void }[] = []
afterEach(() => { connections.forEach(connection => { connection.close() }); connections.length = 0; vi.restoreAllMocks() })
const project = cuttingProjectSchema.parse({ id: 'cut-project', name: 'Cut project', partIds: [], materialIds: [], supplierProductIds: [] })
const metadata = savedPlanSummarySchema.parse({ id: 'cut-plan', projectId: project.id, name: 'Cuts', createdAt: '2026-10-11T12:00:00.000Z' })
const product = supplierProductSchema.parse({ ...validSupplierProductInput, lengthMm: 200, widthMm: 100, grainDirection: 'length' })
const part = partSchema.parse({ ...validPartInput, lengthMm: 100, widthMm: 100, quantity: 2, grainDirection: 'length' })
const stock = stockItemSchema.parse({ ...validStockItemInput, lengthMm: 200, widthMm: 100, grainDirection: 'length', quantity: 3 })
const request = { confirmed: true, assignments: [{ panelIndex: 0, stockItemId: stock.id }, { panelIndex: 1, stockItemId: stock.id }], offcuts: [] }
async function setup() {
  const indexedDB = new IDBFactory()
  const persistence = createLocalPersistence('cut-confirmation-test', { indexedDB, IDBKeyRange }); connections.push(persistence)
  await persistence.projects.create(project); await persistence.materials.create(validMaterialInput)
  await persistence.supplierProducts.create(product); await persistence.stockItems.create(stock)
  const settings = { kerfMm: 3, edgeMarginMm: 0 }
  const optimized = optimizeProject({ parts: [part], panels: [{ product, quantity: 2 }], settings })
  if (!optimized.ok) throw new Error('Fixture')
  const snapshot = panelSnapshotSchema.parse({ id: product.id, name: product.name, materialId: product.materialId, lengthMm: product.lengthMm, widthMm: product.widthMm, thicknessMm: product.thicknessMm, grainDirection: product.grainDirection })
  const plans = createSavedPlanService(persistence).forProject(project.id)
  expect((await plans.save(metadata, { plan: optimized.plan, parts: [part], settings, sources: [{ product: snapshot, quantity: 2, materialName: 'Birch', supplierName: 'Supplier' }], editedPanelIndices: [] })).ok).toBe(true)
  return { indexedDB, persistence, plans, service: createCuttingConfirmationService(persistence).forProject(project.id) }
}
describe('explicit cutting confirmation', () => {
  it('consumes exactly confirmed stock with no offcuts and retains immutable movement history after reload', async () => {
    const { persistence, service, indexedDB } = await setup()
    const catalog = await persistence.supplierProducts.list()
    const preview = await service.preview(metadata.id)
    expect(preview.ok && preview.value.offcuts.map(item => item.region)).toEqual([{ xMm: 103, yMm: 0, lengthMm: 97, widthMm: 100 }, { xMm: 103, yMm: 0, lengthMm: 97, widthMm: 100 }])
    expect((await persistence.stockItems.get(stock.id))).toEqual({ ok: true, value: stock })
    const confirmed = await service.confirm(metadata.id, request)
    expect(confirmed).toMatchObject({ ok: true, value: { id: metadata.id, projectId: project.id, consumed: [{ stock, quantity: 2, panelIndices: [0, 1] }], offcuts: [] } })
    expect(await persistence.stockItems.list()).toEqual({ ok: true, value: [{ ...stock, quantity: 1 }] })
    expect(await persistence.supplierProducts.list()).toEqual(catalog)
    persistence.close()
    const reopened = createLocalPersistence('cut-confirmation-test', { indexedDB, IDBKeyRange }); connections.push(reopened)
    expect(await createCuttingConfirmationService(reopened).forProject(project.id).list()).toEqual({ ok: true, value: confirmed.ok ? [confirmed.value] : [] })
    expect(confirmed.ok && Number.isFinite(Date.parse(confirmed.value.confirmedAt))).toBe(true)
  })
  it('creates only selected offcuts, preserving physical dimensions, material, grain and source provenance', async () => {
    const { persistence, service } = await setup()
    const result = await service.confirm(metadata.id, { ...request, offcuts: [{ panelIndex: 1, wasteIndex: 0 }] })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected confirmation')
    expect(result.value.offcuts).toHaveLength(1)
    expect(result.value.offcuts[0]).toMatchObject({ kind: 'offcut', lengthMm: 97, widthMm: 100, thicknessMm: stock.thicknessMm, materialId: stock.materialId, grainDirection: 'length', quantity: 1, provenance: { source: 'cutting', projectId: project.id, savedPlanId: metadata.id, sourceStockItemId: stock.id, panelIndex: 1, wasteIndex: 0 } })
    expect((await persistence.stockItems.list()).ok).toBe(true)
    const stored = await persistence.stockItems.list()
    expect(stored.ok && stored.value).toHaveLength(2)
  })
  it('serializes concurrent duplicate confirmations across database connections and protects confirmed plan history', async () => {
    const { indexedDB, persistence, service, plans } = await setup()
    const second = createLocalPersistence('cut-confirmation-test', { indexedDB, IDBKeyRange }); connections.push(second)
    const duplicate = createCuttingConfirmationService(second).forProject(project.id)
    const selected = { ...request, offcuts: [{ panelIndex: 0, wasteIndex: 0 }] }
    const outcomes = await Promise.all([service.confirm(metadata.id, selected), duplicate.confirm(metadata.id, selected)])
    expect(outcomes[0]).toEqual(outcomes[1]); expect(outcomes[0].ok).toBe(true)
    expect(await duplicate.confirm(metadata.id, request)).toEqual(outcomes[0])
    const records = await persistence.stockItems.list()
    expect(records.ok && records.value).toHaveLength(2)
    expect(await service.list()).toMatchObject({ ok: true, value: [{ id: metadata.id }] })
    expect(await plans.delete(metadata.id)).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
  })
  it.each([{ materialId: 'other-material' }, { thicknessMm: 18.00001 }, { lengthMm: 201 }, { widthMm: 101 }, { grainDirection: 'width' }])('rejects incompatible stock %j without any writes', async mismatch => {
    const { persistence, service } = await setup()
    const record = stockItemSchema.parse({ ...stock, ...mismatch })
    await persistence.stockItems.update(stock.id, record)
    expect(await service.confirm(metadata.id, request)).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    expect(await persistence.stockItems.list()).toEqual({ ok: true, value: [record] })
    expect(await service.list()).toEqual({ ok: true, value: [] })
  })
  it('rechecks missing/insufficient stock after preview and leaves every record unchanged', async () => {
    const { persistence, service } = await setup()
    await service.preview(metadata.id)
    await persistence.stockItems.update(stock.id, { ...stock, quantity: 1 })
    expect(await service.confirm(metadata.id, request)).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    expect(await persistence.stockItems.get(stock.id)).toMatchObject({ ok: true, value: { quantity: 1 } })
    await persistence.stockItems.delete(stock.id)
    expect(await service.confirm(metadata.id, request)).toMatchObject({ ok: false, error: { kind: 'notFound' } })
    expect(await service.list()).toEqual({ ok: true, value: [] })
  })
  it('rejects duplicate/off-plan offcuts, duplicate/missing panel assignments and absent consent', async () => {
    const { persistence, service } = await setup()
    for (const invalid of [ { ...request, confirmed: false }, { ...request, assignments: [request.assignments[0]] }, { ...request, assignments: [request.assignments[0], request.assignments[0]] }, { ...request, offcuts: [{ panelIndex: 0, wasteIndex: 99 }] }, { ...request, offcuts: [{ panelIndex: 0, wasteIndex: 0 }, { panelIndex: 0, wasteIndex: 0 }] } ]) expect((await service.confirm(metadata.id, invalid)).ok).toBe(false)
    expect(await persistence.stockItems.list()).toEqual({ ok: true, value: [stock] })
    expect(await service.list()).toEqual({ ok: true, value: [] })
  })
  it('rolls back deductions and offcut inserts when movement recording fails', async () => {
    const { persistence, service } = await setup()
    const transaction = persistence.transaction.bind(persistence)
    vi.spyOn(persistence, 'transaction').mockImplementation(work => transaction(repositories => work({ ...repositories, cuttingConfirmations: { ...repositories.cuttingConfirmations, create: () => Promise.resolve({ ok: false, error: { kind: 'storageFailure', message: 'Disk full' } }) } })))
    expect(await service.confirm(metadata.id, { ...request, offcuts: [{ panelIndex: 0, wasteIndex: 0 }] })).toMatchObject({ ok: false, error: { kind: 'storageFailure' } })
    expect(await persistence.stockItems.list()).toEqual({ ok: true, value: [stock] })
    expect(await persistence.cuttingConfirmations.list()).toEqual({ ok: true, value: [] })
  })
  it('rejects corrupt and cross-project plans without affecting inventory', async () => {
    const { indexedDB, persistence, service } = await setup()
    const other = cuttingProjectSchema.parse({ ...project, id: 'other-project' }); await persistence.projects.create(other)
    expect((await createCuttingConfirmationService(persistence).forProject(other.id).confirm(metadata.id, request)).ok).toBe(false)
    const raw = new Dexie('cut-confirmation-test', { indexedDB, IDBKeyRange }); raw.version(DATABASE_VERSION).stores(DATABASE_STORES); connections.push(raw)
    const body = await persistence.savedPlanContents.get(metadata.id)
    if (!body.ok) throw new Error('Fixture')
    await raw.table('savedPlanContents').put({ ...body.value, metrics: { ...body.value.metrics, placedCount: 1000 } })
    expect(await service.preview(metadata.id)).toMatchObject({ ok: false, error: { kind: 'invalidRecord' } })
    expect(await service.confirm(metadata.id, request)).toMatchObject({ ok: false, error: { kind: 'invalidRecord' } })
    expect(await persistence.stockItems.list()).toEqual({ ok: true, value: [stock] })
  })
  it('consumes a previously saved offcut as normal stock and retains its provenance in the movement', async () => {
    const { persistence, service, plans } = await setup()
    const first = await service.confirm(metadata.id, { ...request, offcuts: [{ panelIndex: 0, wasteIndex: 0 }] })
    if (!first.ok || !first.value.offcuts[0]) throw new Error('Fixture')
    const offcut = first.value.offcuts[0]
    const smallPart = partSchema.parse({ ...part, lengthMm: 97, quantity: 1 })
    const panel = supplierProductSchema.parse({ ...product, lengthMm: 97 })
    const settings = { kerfMm: 0, edgeMarginMm: 0 }
    const optimized = optimizeProject({ parts: [smallPart], panels: [{ product: panel, quantity: 1 }], settings })
    if (!optimized.ok) throw new Error('Fixture')
    const original = await plans.get(metadata.id); if (!original.ok || !original.value.contents.sources[0]) throw new Error('Fixture')
    const second = savedPlanSummarySchema.parse({ ...metadata, id: 'next-cut' })
    expect((await plans.save(second, { plan: optimized.plan, parts: [smallPart], settings, sources: [{ ...original.value.contents.sources[0], product: { ...original.value.contents.sources[0].product, lengthMm: 97 }, quantity: 1 }], editedPanelIndices: [] })).ok).toBe(true)
    const cut = await service.confirm(second.id, { confirmed: true, assignments: [{ panelIndex: 0, stockItemId: offcut.id }], offcuts: [] })
    expect(cut).toMatchObject({ ok: true, value: { consumed: [{ stock: offcut, quantity: 1 }], offcuts: [] } })
    expect(await persistence.stockItems.get(offcut.id)).toMatchObject({ ok: false, error: { kind: 'notFound' } })
  })
  it('upgrades version 3 without rewriting stock, projects or saved payloads', async () => {
    const indexedDB = new IDBFactory()
    const old = new Dexie('cut-upgrade', { indexedDB, IDBKeyRange }); old.version(3).stores(DATABASE_V3_STORES)
    await old.table('stockItems').add(stock); await old.table('projects').add(project); await old.table('savedPlanSummaries').add(metadata); old.close()
    const current = createLocalPersistence('cut-upgrade', { indexedDB, IDBKeyRange }); connections.push(current)
    expect(await current.stockItems.get(stock.id)).toEqual({ ok: true, value: stock })
    expect(await current.savedPlanSummaries.get(metadata.id)).toEqual({ ok: true, value: metadata })
    expect(await current.projects.get(project.id)).toEqual({ ok: true, value: project })
    expect(await current.cuttingConfirmations.list()).toEqual({ ok: true, value: [] })
  })
})
