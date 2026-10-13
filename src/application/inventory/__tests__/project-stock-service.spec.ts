import { applyPlanEdit, createPlanEditingSession, currentEditingPlan } from '../../optimization/plan-editing-session'
import { projectPdfRequest } from '../../export/__tests__/pdf-fixtures'
import { stockPanel } from '../../../domain/optimizer/panel-source'
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { createLocalPersistence, DATABASE_V5_STORES } from '../../../infrastructure/persistence/local-database'
import type { PersistenceResult } from '../../persistence/repositories'
import { createProjectStockService } from '../project-stock-service'
import { createCurrentResultService } from '../../plans/current-result-service'
import { createStockRepository } from '../stock-repository'
import { cuttingProjectSchema } from '../../../domain/model/cutting-project'
import { stockItemSchema } from '../../../domain/model/stock-item'
import { supplierProductSchema } from '../../../domain/model/supplier-product'
import { partSchema } from '../../../domain/model/part'
import { panelSnapshotSchema } from '../../../domain/model/saved-cutting-plan'
import { optimizeProject } from '../../../domain/optimizer/optimize-project'
import { validMaterialInput, validStockItemInput, validSupplierProductInput, validPartInput } from '../../../domain/model/__tests__/fixtures'

const connections: { close(): void }[] = []
afterEach(() => { connections.forEach(connection => { connection.close() }); connections.length = 0; vi.restoreAllMocks() })
function value<T>(result: PersistenceResult<T>): T { if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.value }
const project = cuttingProjectSchema.parse({ id: 'offcut-project', name: 'Offcut project', partIds: [], materialIds: [], supplierProductIds: [] })
const product = supplierProductSchema.parse({ ...validSupplierProductInput, lengthMm: 200, widthMm: 100, grainDirection: 'length' })
const source = panelSnapshotSchema.parse(productSchemaFields())
function productSchemaFields() { const { id, name, materialId, lengthMm, widthMm, thicknessMm, grainDirection } = product; return { id, name, materialId, lengthMm, widthMm, thicknessMm, grainDirection } }
const stock = stockItemSchema.parse({ ...validStockItemInput, lengthMm: 200, widthMm: 100, quantity: 3, grainDirection: 'length' })
async function setup() {
  const indexedDB = new IDBFactory()
  const persistence = createLocalPersistence('project-stock-test', { indexedDB, IDBKeyRange }); connections.push(persistence)
  value(await persistence.projects.create(project)); value(await persistence.materials.create(validMaterialInput)); value(await persistence.stockItems.create(stock)); value(await persistence.supplierProducts.create(product))
  const current = createCurrentResultService(persistence).forProject(project.id)
  async function optimize(lengthMm = 100) {
    const parts = [partSchema.parse({ ...validPartInput, lengthMm, widthMm: 100, quantity: 2, grainDirection: 'length' })]
    const settings = { kerfMm: 3, edgeMarginMm: 0 }
    const result = optimizeProject({ parts, panels: [{ product, quantity: 2 }], settings })
    if (!result.ok) throw new Error(result.error.message)
    return value(await current.replace({ plan: result.plan, parts, settings, sources: [{ product: source, quantity: 2, materialName: 'Birch', supplierName: 'Supplier' }], editedPanelIndices: [] }))
  }
  await optimize()
  const service = createProjectStockService(persistence).forProject(project.id)
  async function select(index = 0) { const preview = value(await service.preview()); const row = preview.rows[index]; if (!row) throw new Error('Missing offcut'); value(await service.setKeep(row.key, true)); return row }
  async function apply() { return service.sync() }
  return { indexedDB, persistence, service, optimize, select, apply }
}

describe('automatic project stock reconciliation', () => {
  it('treats catalogue panels as external sources and automatically adds/removes checked offcuts', async () => {
    const { persistence, service, select } = await setup()
    expect(value(await persistence.stockItems.get(stock.id))).toEqual(stock)
    await select()
    const before = value(await service.preview())
    expect(before.rows[0]?.status).toBe('Available')
    const item = before.rows[0]?.entry?.stock
    if (!item) throw new Error('Missing kept offcut')
    expect(item.provenance).toMatchObject({ source: 'cutting', supplierProductId: product.id, projectId: project.id })
    expect(item.provenance).not.toHaveProperty('sourceStockItemId')
    value(await service.setKeep(before.rows[0]?.key ?? '', false))
    expect(await persistence.stockItems.get(item.id)).toMatchObject({ ok: false })
    expect(value(await persistence.stockItems.get(stock.id))).toEqual(stock)
    expect(value(await persistence.cuttingConfirmations.list())).toEqual([])
  })
  it('restores selections after reload and does not duplicate movements on repeated synchronization', async () => {
    const { persistence, indexedDB, service, select } = await setup()
    await select()
    const records = value(await persistence.stockItems.list())
    const movements = value(await service.preview()).movements
    value(await service.sync()); value(await service.sync())
    expect(value(await persistence.stockItems.list())).toEqual(records)
    expect(value(await service.preview()).movements).toEqual(movements)
    persistence.close()
    const reopened = createLocalPersistence('project-stock-test', { indexedDB, IDBKeyRange }); connections.push(reopened)
    const restored = value(await createProjectStockService(reopened).forProject(project.id).preview())
    expect(restored.rows.map(row => row.keep)).toEqual([true, false]); expect(restored.rows[0]?.status).toBe('Available')
  })
  it('matches unchanged offcuts across optimization while assigning fresh IDs to changed geometry', async () => {
    const { persistence, service, select, optimize } = await setup()
    await select()
    const previous = value(await service.preview()).rows[0]?.entry?.stock
    const movements = value(await service.preview()).movements
    await optimize()
    expect(value(await service.preview()).rows[0]?.entry?.stock).toEqual(previous)
    expect(value(await service.preview()).movements).toEqual(movements)
    await optimize(80)
    expect(previous && await persistence.stockItems.get(previous.id)).toMatchObject({ ok: false })
    expect(value(await service.preview()).rows.some(row => row.status === 'Outdated')).toBe(true)
    await select()
    expect(value(await service.preview()).rows[0]?.entry?.stock?.id).not.toBe(previous?.id)
  })
  it('preserves externally modified or consumed offcuts and exposes a conflict on geometry changes', async () => {
    const { persistence, service, select, optimize } = await setup()
    await select()
    const item = value(await service.preview()).rows[0]?.entry?.stock
    if (!item) throw new Error('Missing offcut')
    value(await persistence.stockItems.update(item.id, { ...item, quantity: 2 }))
    await optimize(80)
    expect(value(await service.preview()).conflict).toContain('consumed or modified')
    expect(value(await persistence.stockItems.get(item.id)).quantity).toBe(2)
    value(await persistence.stockItems.delete(item.id))
    value(await service.sync())
    expect(await persistence.stockItems.get(item.id)).toMatchObject({ ok: false })
    expect(value(await service.preview()).conflict).toContain('consumed or modified')
  })
  it('automatically consumes exact stock identities once and restores units on safe source replacement', async () => {
    const { persistence, service, optimize } = await setup()
    async function ownedPlan(quantity = 2) {
      const parts = [partSchema.parse({ ...validPartInput, lengthMm: 100, widthMm: 100, quantity, grainDirection: 'length' })]
      const owned = { ...source, id: panelSnapshotSchema.shape.id.parse(`stock:${stock.id}`), stockItemId: stock.id }
      const settings = { kerfMm: 3, edgeMarginMm: 0 }
      const result = optimizeProject({ parts, panels: [{ product: stockPanel(stock), quantity: 3 }], settings })
      if (!result.ok) throw new Error('Invalid fixture')
      return createCurrentResultService(persistence).forProject(project.id).replace({ plan: result.plan, parts, settings, sources: [{ product: owned, quantity: 3, materialName: 'Birch', supplierName: 'Stock' }], editedPanelIndices: [] })
    }
    value(await ownedPlan())
    expect(value(await persistence.stockItems.get(stock.id)).quantity).toBe(1)
    const history = value(await service.preview()).movements
    value(await ownedPlan())
    expect(value(await service.preview()).movements).toEqual(history)
    expect(value(await createStockRepository(persistence).planningStock(project.id)).find(item => item.id === stock.id)?.quantity).toBe(3)
    value(await ownedPlan(1))
    expect(value(await persistence.stockItems.get(stock.id)).quantity).toBe(2)
    await optimize()
    expect(value(await persistence.stockItems.get(stock.id)).quantity).toBe(3)
  })
  it('rejects unsafe restoration when stock was changed by another project', async () => {
    const { persistence, service } = await setup()
    const parts = [partSchema.parse({ ...validPartInput, lengthMm: 100, widthMm: 100, quantity: 1, grainDirection: 'length' })]
    const owned = panelSnapshotSchema.parse({ ...source, id: `stock:${stock.id}`, stockItemId: stock.id })
    const settings = { kerfMm: 3, edgeMarginMm: 0 }
    const result = optimizeProject({ parts, panels: [{ product: stockPanel(stock), quantity: 3 }], settings })
    if (!result.ok) throw new Error('Fixture')
    const current = createCurrentResultService(persistence).forProject(project.id)
    value(await current.replace({ plan: result.plan, parts, settings, sources: [{ product: owned, quantity: 3, materialName: 'Birch', supplierName: 'Stock' }], editedPanelIndices: [] }))
    value(await persistence.stockItems.update(stock.id, { ...stock, quantity: 1 }))
    const empty = optimizeProject({ parts, panels: [], settings })
    if (!empty.ok) throw new Error('Missing empty plan')
    value(await current.replace({ plan: empty.plan, parts, settings, sources: [], editedPanelIndices: [] }))
    expect(value(await service.preview()).conflict).toContain('modified elsewhere')
    expect(value(await persistence.stockItems.get(stock.id)).quantity).toBe(1)
  })
  it('rolls back physical stock and decisions if persistence fails', async () => {
    const { persistence, service } = await setup()
    const before = value(await persistence.stockItems.list())
    const row = value(await service.preview()).rows[0]
    if (!row) throw new Error('Missing offcut')
    const transaction = persistence.transaction.bind(persistence)
    vi.spyOn(persistence, 'transaction').mockImplementation(work => transaction(repositories => work({ ...repositories, projectStock: { ...repositories.projectStock, update: () => Promise.resolve({ ok: false, error: { kind: 'storageFailure', message: 'Disk full' } }) } })))
    expect(await service.setKeep(row.key, true)).toMatchObject({ ok: false })
    vi.restoreAllMocks()
    expect(value(await persistence.stockItems.list())).toEqual(before)
    expect(value(await service.preview()).rows[0]?.keep).toBe(false)
  })
  it('handles mixed owned and catalogue panels using their distinct provenance', async () => {
    const { persistence, service } = await setup()
    const owned = stockPanel(stock)
    const ownedSnapshot = panelSnapshotSchema.parse({ id: owned.id, name: owned.name, materialId: owned.materialId, lengthMm: owned.lengthMm, widthMm: owned.widthMm, thicknessMm: owned.thicknessMm, grainDirection: owned.grainDirection, stockItemId: stock.id })
    const parts = [partSchema.parse({ ...validPartInput, lengthMm: 100, widthMm: 100, quantity: 2, grainDirection: 'length' })]
    const settings = { kerfMm: 3, edgeMarginMm: 0 }
    const plan = optimizeProject({ parts, panels: [{ product: owned, quantity: 1 }, { product, quantity: 1 }], settings })
    if (!plan.ok) throw new Error('Mixed fixture failed')
    value(await createCurrentResultService(persistence).forProject(project.id).replace({ plan: plan.plan, parts, settings, sources: [{ product: ownedSnapshot, quantity: 1, materialName: 'Birch', supplierName: 'Stock' }, { product: source, quantity: 1, materialName: 'Birch', supplierName: 'Supplier' }], editedPanelIndices: [] }))
    expect(value(await persistence.stockItems.get(stock.id)).quantity).toBe(2)
    for (const row of value(await service.preview()).rows) value(await service.setKeep(row.key, true))
    const retained = value(await persistence.stockItems.list()).filter(item => item.id !== stock.id)
    expect(retained).toHaveLength(2)
    expect(retained.some(item => item.provenance.source === 'cutting' && item.provenance.sourceStockItemId === stock.id)).toBe(true)
    expect(retained.some(item => item.provenance.source === 'cutting' && item.provenance.supplierProductId === product.id)).toBe(true)
  })
  it('reconciles accepted manual rotations against the validated edited waste geometry', async () => {
    const { persistence, service } = await setup()
    const request = projectPdfRequest()
    const raw = request.sources[0]?.product
    if (!raw) throw new Error('Missing source')
    const { id, name, materialId, lengthMm, widthMm, thicknessMm, grainDirection } = raw
    const snapshot = panelSnapshotSchema.parse({ id, name, materialId, lengthMm, widthMm, thicknessMm, grainDirection })
    const input = { ...request, sources: [{ product: snapshot, quantity: 1, materialName: 'Birch', supplierName: 'Supplier' }] }
    const current = createCurrentResultService(persistence).forProject(project.id)
    value(await current.replace(input))
    const first = value(await service.preview()).rows[0]
    if (!first) throw new Error('Missing waste')
    value(await service.setKeep(first.key, true))
    const kept = value(await service.preview()).rows[0]?.entry?.stock
    const allocated = request.plan.panels[0]
    const part = request.parts[0]
    if (!allocated || !part) throw new Error('Missing panel or part')
    const session = createPlanEditingSession(allocated.plan, { panel: snapshot, parts: request.parts, settings: request.settings })
    if (!session.ok) throw new Error('Invalid session')
    const edited = applyPlanEdit(session.session, { kind: 'rotate', copy: { partId: part.id, copyIndex: 0 } })
    if (!edited.ok) throw new Error('Invalid edit')
    value(await current.replace({ ...input, plan: { ...request.plan, panels: [{ ...allocated, plan: currentEditingPlan(edited.session) }] }, editedPanelIndices: [0] }))
    expect(kept && await persistence.stockItems.get(kept.id)).toMatchObject({ ok: false })
    expect(value(await service.preview()).conflict).toBeNull()
    expect(value(await service.preview()).rows.some(row => row.status === 'Outdated')).toBe(true)
  })
  it('rolls back automatic source consumption and current-result replacement on a ledger failure', async () => {
    const { persistence } = await setup()
    const before = value(await persistence.currentCuttingResults.find(project.id))
    const owned = stockPanel(stock)
    const snapshot = panelSnapshotSchema.parse({ id: owned.id, name: owned.name, materialId: owned.materialId, lengthMm: owned.lengthMm, widthMm: owned.widthMm, thicknessMm: owned.thicknessMm, grainDirection: owned.grainDirection, stockItemId: stock.id })
    const parts = [partSchema.parse({ ...validPartInput, lengthMm: 100, widthMm: 100, quantity: 1, grainDirection: 'length' })]
    const settings = { kerfMm: 3, edgeMarginMm: 0 }
    const plan = optimizeProject({ parts, panels: [{ product: owned, quantity: 3 }], settings })
    if (!plan.ok) throw new Error('Missing plan')
    const transaction = persistence.transaction.bind(persistence)
    vi.spyOn(persistence, 'transaction').mockImplementation(work => transaction(repositories => work({ ...repositories, projectStock: { ...repositories.projectStock, update: () => Promise.resolve({ ok: false, error: { kind: 'storageFailure', message: 'Disk full' } }) } })))
    expect(await createCurrentResultService(persistence).forProject(project.id).replace({ plan: plan.plan, parts, settings, sources: [{ product: snapshot, quantity: 3, materialName: 'Birch', supplierName: 'Stock' }], editedPanelIndices: [] })).toMatchObject({ ok: false })
    vi.restoreAllMocks()
    expect(value(await persistence.stockItems.get(stock.id))).toEqual(stock)
    expect(value(await persistence.currentCuttingResults.find(project.id))).toEqual(before)
  })
  it('never recreates an offcut automatically consumed by another project and preserves both histories', async () => {
    const { persistence, service, select, optimize } = await setup()
    await select()
    const item = value(await service.preview()).rows[0]?.entry?.stock
    if (!item) throw new Error('Missing retained offcut')
    const other = cuttingProjectSchema.parse({ ...project, id: 'second-auto-project' })
    value(await persistence.projects.create(other))
    const panel = stockPanel(item)
    const snapshot = panelSnapshotSchema.parse({ id: panel.id, name: panel.name, materialId: panel.materialId, lengthMm: panel.lengthMm, widthMm: panel.widthMm, thicknessMm: panel.thicknessMm, grainDirection: panel.grainDirection, stockItemId: item.id })
    const parts = [partSchema.parse({ ...validPartInput, lengthMm: 30, widthMm: 30, quantity: 1, grainDirection: 'length' })]
    const settings = { kerfMm: 3, edgeMarginMm: 0 }
    const plan = optimizeProject({ parts, panels: [{ product: panel, quantity: 1 }], settings })
    if (!plan.ok) throw new Error('Missing consuming plan')
    value(await createCurrentResultService(persistence).forProject(other.id).replace({ plan: plan.plan, parts, settings, sources: [{ product: snapshot, quantity: 1, materialName: 'Birch', supplierName: 'Stock' }], editedPanelIndices: [] }))
    const history = value(await persistence.projectStock.get(other.id)).movements
    expect(value(await service.preview()).rows[0]?.status).toBe('Consumed')
    await optimize(80)
    expect(value(await service.preview()).conflict).toContain('consumed or modified')
    value(await service.sync())
    expect(await persistence.stockItems.get(item.id)).toMatchObject({ ok: false })
    expect(value(await persistence.projectStock.get(other.id)).movements).toEqual(history)
  })
  it('upgrades v5 additively without rewriting inventory or project data', async () => {
    const indexedDB = new IDBFactory()
    const raw = new Dexie('upgrade-auto-stock', { indexedDB, IDBKeyRange }); connections.push(raw)
    raw.version(5).stores(DATABASE_V5_STORES)
    await raw.table('stockItems').add(stock); await raw.table('projects').add(project); raw.close()
    const db = createLocalPersistence('upgrade-auto-stock', { indexedDB, IDBKeyRange }); connections.push(db)
    expect(value(await db.stockItems.get(stock.id))).toEqual(stock); expect(value(await db.projects.get(project.id))).toEqual(project)
  })
})
