// @vitest-environment node
import { createProjectService } from '../../projects/project-service'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { createLocalPersistence } from '../../../infrastructure/persistence/local-database'
import { projectJson } from '../../../infrastructure/projects/project-json'
import { createStockTransferService } from '../stock-transfer-service'
import { stockTransferSchema } from '../stock-transfer-format'
import { stockItemSchema } from '../../../domain/model/stock-item'
import { cuttingProjectSchema } from '../../../domain/model/cutting-project'
import { cuttingConfirmationSchema } from '../../../domain/model/cutting-confirmation'
import { partSchema } from '../../../domain/model/part'
import { supplierProductSchema } from '../../../domain/model/supplier-product'
import { panelSnapshotSchema } from '../../../domain/model/saved-cutting-plan'
import { optimizeProject } from '../../../domain/optimizer/optimize-project'
import { createCurrentResultService } from '../../plans/current-result-service'
import { createProjectStockService } from '../project-stock-service'
import type { PersistenceResult } from '../../persistence/repositories'
import { validMaterialInput, validStockItemInput, validSupplierInput, validSupplierProductInput, validPartInput } from '../../../domain/model/__tests__/fixtures'

const connections: { close(): void }[] = []
afterEach(() => { connections.forEach(connection => { connection.close() }); connections.length = 0; vi.restoreAllMocks() })
function value<T>(result: PersistenceResult<T>): T { if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.value }
const stock = stockItemSchema.parse({ ...validStockItemInput, quantity: 3 })
function file(items = [stock]) { return stockTransferSchema.parse({ format: 'opticutlist-stock', schemaVersion: 1, materials: items.length ? [validMaterialInput] : [], stockItems: items }) }
async function setup(material = true) {
  const indexedDB = new IDBFactory()
  const persistence = createLocalPersistence('stock-transfer', { indexedDB, IDBKeyRange }); connections.push(persistence)
  if (material) value(await persistence.materials.create(validMaterialInput))
  return { persistence, indexedDB, service: createStockTransferService(persistence, projectJson) }
}
describe('stock exchange', () => {
  it('exports empty stock and only required material identities', async () => {
    const { service } = await setup()
    expect(JSON.parse(value(await service.export()))).toEqual(file([]))
  })
  it('round-trips multiple stock records, retains IDs/grain/provenance and persists after reopening', async () => {
    const first = await setup()
    const secondItem = stockItemSchema.parse({ ...stock, id: 'second', kind: 'offcut', quantity: 1, grainDirection: 'width' })
    value(await first.persistence.stockItems.create(stock)); value(await first.persistence.stockItems.create(secondItem))
    const text = value(await first.service.export())
    expect(text).toContain('\n  "format"'); expect(text).not.toContain('movements')
    const target = await setup()
    const preview = value(await target.service.preview(text))
    expect(preview).toMatchObject({ added: 2, reused: 0 })
    value(await target.service.import(preview.file, true))
    expect(value(await target.persistence.stockItems.list())).toEqual([secondItem, stock])
    expect(value(await target.service.preview(text))).toMatchObject({ added: 0, reused: 2 })
    value(await target.service.import(preview.file, true))
    expect(value(await target.persistence.stockItems.list())).toHaveLength(2)
    const reopened = createLocalPersistence('stock-transfer', { indexedDB: target.indexedDB, IDBKeyRange }); connections.push(reopened)
    expect(value(await reopened.stockItems.list())).toEqual([secondItem, stock])
    expect(value(await reopened.projectStock.list())).toEqual([])
    expect(value(await reopened.cuttingConfirmations.list())).toEqual([])
  })
  it.each([
    '{', JSON.stringify({ ...file(), schemaVersion: 2 }), JSON.stringify({ ...file(), format: 'unknown' }),
    JSON.stringify({ ...file(), stockItems: [{ ...stock, lengthMm: 0 }] }),
    JSON.stringify({ ...file(), stockItems: [{ ...stock, widthMm: -1 }] }),
    JSON.stringify({ ...file(), stockItems: [{ ...stock, thicknessMm: undefined }] }),
    JSON.stringify({ ...file(), stockItems: [{ ...stock, quantity: 0 }] }),
    JSON.stringify({ ...file(), stockItems: [{ ...stock, quantity: 1.5 }] }),
    JSON.stringify({ ...file(), stockItems: [stock, stock] }),
    JSON.stringify({ ...file(), materials: [] }),
  ])('rejects invalid JSON/domain data before writing: %s', async text => {
    const { persistence, service } = await setup()
    expect(await service.preview(text)).toMatchObject({ ok: false, error: { kind: 'invalidRecord' } })
    expect(value(await persistence.stockItems.list())).toEqual([])
  })
  it('requires explicit consent and checks missing/conflicting material identities', async () => {
    const { service, persistence } = await setup(false)
    expect(await service.import(file(), false)).toMatchObject({ ok: false, error: { kind: 'invalidRecord' } })
    expect(await service.import(file(), true)).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    value(await persistence.materials.create({ ...validMaterialInput, name: 'Different material' }))
    expect(await service.import(file(), true)).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    expect(value(await persistence.stockItems.list())).toEqual([])
  })
  it('blocks conflicts and rechecks changed quantities after preview without inserting other rows', async () => {
    const { service, persistence } = await setup()
    value(await persistence.stockItems.create(stock))
    const input = file([stock, stockItemSchema.parse({ ...stock, id: 'new-item' })])
    value(await service.preview(JSON.stringify(input)))
    value(await persistence.stockItems.update(stock.id, { ...stock, quantity: 2 }))
    expect(await service.import(input, true)).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    expect(value(await persistence.stockItems.list())).toEqual([{ ...stock, quantity: 2 }])
  })
  it('preserves purchase identity and rejects missing or mismatched catalog dependencies', async () => {
    const { service, persistence } = await setup()
    const purchased = stockItemSchema.parse({ ...stock, provenance: { source: 'purchase', supplierProductId: validSupplierProductInput.id } })
    expect(await service.import(file([purchased]), true)).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    value(await persistence.suppliers.create(validSupplierInput)); value(await persistence.supplierProducts.create(validSupplierProductInput))
    value(await service.import(file([purchased]), true))
    expect(value(await persistence.stockItems.get(purchased.id))).toEqual(purchased)
    expect(value(await persistence.supplierProducts.list())).toEqual([validSupplierProductInput])
  })
  it('rejects identities reserved by another project or consumed inventory history', async () => {
    const { service, persistence } = await setup()
    const project = cuttingProjectSchema.parse({ id: 'other', name: 'Other', partIds: [], materialIds: [], supplierProductIds: [], stockItemIds: [stock.id] })
    value(await persistence.projects.create(project))
    expect(await service.import(file(), true)).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    value(await persistence.projects.delete(project.id))
    value(await persistence.cuttingConfirmations.create(cuttingConfirmationSchema.parse({ id: 'old-plan', projectId: project.id, confirmedAt: '2026-10-14T12:00:00.000Z', consumed: [{ stock, quantity: 3, panelIndices: [0] }], offcuts: [] })))
    expect(await service.import(file(), true)).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    expect(value(await persistence.stockItems.list())).toEqual([])
    expect(value(await persistence.cuttingConfirmations.list())).toHaveLength(1)
  })
  it('rolls back all inserts when the second database write fails', async () => {
    const { service, persistence } = await setup()
    const transaction = persistence.transaction.bind(persistence)
    vi.spyOn(persistence, 'transaction').mockImplementation(work => transaction(repositories => {
      let count = 0
      return work({ ...repositories, stockItems: { ...repositories.stockItems, create: record => ++count === 2 ? Promise.resolve({ ok: false, error: { kind: 'storageFailure', message: 'Disk full' } }) : repositories.stockItems.create(record) } })
    }))
    expect(await service.import(file([stock, stockItemSchema.parse({ ...stock, id: 'second' })]), true)).toMatchObject({ ok: false, error: { kind: 'storageFailure' } })
    expect(value(await persistence.stockItems.list())).toEqual([])
    expect(value(await persistence.materials.list())).toEqual([validMaterialInput])
  })
  it('reuses real project offcuts without movements but cannot recreate removed/consumed offcuts', async () => {
    const { service, persistence } = await setup()
    const project = cuttingProjectSchema.parse({ id: 'origin', name: 'Origin', partIds: [], materialIds: [], supplierProductIds: [] })
    value(await persistence.projects.create(project))
    const product = supplierProductSchema.parse({ ...validSupplierProductInput, lengthMm: 200, widthMm: 100 })
    value(await persistence.supplierProducts.create(product))
    const part = partSchema.parse({ ...validPartInput, lengthMm: 100, widthMm: 100, quantity: 1 })
    const settings = { kerfMm: 3, edgeMarginMm: 0 }
    const result = optimizeProject({ parts: [part], panels: [{ product, quantity: 1 }], settings })
    if (!result.ok) throw new Error(result.error.message)
    const { id, name, materialId, lengthMm, widthMm, thicknessMm, grainDirection } = product
    value(await createCurrentResultService(persistence).forProject(project.id).replace({ plan: result.plan, parts: [part], settings, sources: [{ product: panelSnapshotSchema.parse({ id, name, materialId, lengthMm, widthMm, thicknessMm, grainDirection }), quantity: 1, materialName: validMaterialInput.name, supplierName: 'Supplier' }], editedPanelIndices: [] }))
    const projectStock = createProjectStockService(persistence).forProject(project.id)
    const row = value(await projectStock.preview()).rows[0]
    if (!row) throw new Error('Missing offcut')
    value(await projectStock.setKeep(row.key, true))
    const exported = value(await service.export())
    const snapshot = value(await persistence.projectStock.list())
    const parsed = value(await service.preview(exported))
    expect(parsed).toMatchObject({ added: 0, reused: 1 })
    value(await service.import(parsed.file, true))
    expect(value(await persistence.projectStock.list())).toEqual(snapshot)
    value(await createProjectService(persistence).deleteProject(project.id, 'keep'))
    const archived = value(await persistence.projectStock.list())
    expect(value(await service.preview(exported))).toMatchObject({ added: 0, reused: 1 })
    value(await service.import(parsed.file, true))
    expect(value(await persistence.projectStock.list())).toEqual(archived)
    const item = parsed.file.stockItems[0]; if (!item) throw new Error('Missing kept stock')
    value(await persistence.stockItems.delete(item.id))
    expect(await service.import(parsed.file, true)).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    expect(value(await persistence.projectStock.list())).toEqual(archived)
    expect(value(await persistence.stockItems.list())).toEqual([])
  })
  it('blocks an existing orphaned cutting offcut instead of accepting missing project/history dependencies', async () => {
    const { service, persistence } = await setup()
    const orphan = stockItemSchema.parse({ ...stock, kind: 'offcut', provenance: { source: 'cutting', projectId: 'missing', savedPlanId: 'missing-plan', sourceStockItemId: 'source', panelIndex: 0, wasteIndex: 0 } })
    value(await persistence.stockItems.create(orphan))
    const result = await service.preview(value(await service.export()))
    expect(result.ok).toBe(false)
    if (!result.ok && result.error.kind === 'referenceConflict') expect(result.error.message).toContain('missing or inconsistent')
    expect(value(await persistence.stockItems.list())).toEqual([orphan])
  })
  it('rejects new cutting offcuts with missing history rather than forging provenance', async () => {
    const { service } = await setup()
    const offcut = stockItemSchema.parse({ ...stock, kind: 'offcut', provenance: { source: 'cutting', projectId: 'missing', savedPlanId: 'missing-plan', sourceStockItemId: 'source', panelIndex: 0, wasteIndex: 0 } })
    expect(await service.import(file([offcut]), true)).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
  })
})
