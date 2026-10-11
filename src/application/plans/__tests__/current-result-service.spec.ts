import { createCurrentResultService } from '../current-result-service'
import { createCuttingConfirmationService } from '../../inventory/cutting-confirmation-service'
import { createProjectTransferService } from '../../projects/project-transfer-service'
import { projectJson } from '../../../infrastructure/projects/project-json'
// @vitest-environment node
import Dexie from 'dexie'
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocalPersistence, DATABASE_V4_STORES } from '../../../infrastructure/persistence/local-database'
import { createSavedPlanService, type SavePlanInput } from '../saved-plan-service'
import { cuttingProjectSchema } from '../../../domain/model/cutting-project'
import { partSchema } from '../../../domain/model/part'
import { supplierProductSchema } from '../../../domain/model/supplier-product'
import { panelSnapshotSchema, savedPlanSummarySchema } from '../../../domain/model/saved-cutting-plan'
import { validPartInput, validSupplierProductInput, validMaterialInput, validSupplierInput, validStockItemInput } from '../../../domain/model/__tests__/fixtures'
import { optimizeProject } from '../../../domain/optimizer/optimize-project'
import { createPlanEditingSession, applyPlanEdit, currentEditingPlan } from '../../optimization/plan-editing-session'

const connections: { close(): void }[] = []
afterEach(() => { connections.forEach(connection => { connection.close() }); connections.length = 0; vi.restoreAllMocks() })
const project = cuttingProjectSchema.parse({ id: 'cabinet', name: 'Cabinet', partIds: [], materialIds: [], supplierProductIds: [] })
const metadata = savedPlanSummarySchema.parse({ id: 'plan-one', projectId: project.id, name: 'Cabinet cuts', createdAt: '2026-10-11T12:00:00.000Z' })
const product = supplierProductSchema.parse({ ...validSupplierProductInput, lengthMm: 200, widthMm: 100, grainDirection: 'none' })
const part = partSchema.parse({ ...validPartInput, lengthMm: 100, widthMm: 100, quantity: 4, grainDirection: 'none', rotation: 'allowed' })
const panelSnapshot = panelSnapshotSchema.parse({ id: product.id, name: product.name, materialId: product.materialId, lengthMm: product.lengthMm, widthMm: product.widthMm, thicknessMm: product.thicknessMm, grainDirection: product.grainDirection })
function input(): SavePlanInput {
  const settings = { kerfMm: 0, edgeMarginMm: 0 }
  const result = optimizeProject({ panels: [{ product, quantity: 2 }], parts: [part], settings })
  if (!result.ok) throw new Error(result.error.message)
  return { plan: result.plan, parts: [part], settings, sources: [{ product: panelSnapshot, quantity: 2, materialName: validMaterialInput.name, supplierName: validSupplierInput.name }], editedPanelIndices: [] }
}
async function setup() {
  const indexedDB = new IDBFactory()
  const persistence = createLocalPersistence('saved-plans-test', { indexedDB, IDBKeyRange })
  connections.push(persistence)
  await persistence.projects.create(project)
  await persistence.materials.create(validMaterialInput)
  await persistence.suppliers.create(validSupplierInput)
  await persistence.supplierProducts.create(product)
  await persistence.stockItems.create(validStockItemInput)
  const service = createSavedPlanService(persistence)
  return { indexedDB, persistence, service, plans: service.forProject(project.id) }
}
describe('automatic current cutting results', () => {
  it('persists complete results across connections, replacing ordinary results without history or inventory changes', async () => {
    const { indexedDB, persistence } = await setup()
    const current = createCurrentResultService(persistence).forProject(project.id)
    const value = input(); const original = structuredClone(value)
    const stock = await persistence.stockItems.list()
    const first = await current.replace(value)
    if (!first.ok) throw new Error('Fixture')
    persistence.close()
    const reopened = createLocalPersistence('saved-plans-test', { indexedDB, IDBKeyRange }); connections.push(reopened)
    const service = createCurrentResultService(reopened).forProject(project.id)
    expect(await service.load()).toMatchObject({ ok: true, value: { result: { plan: value.plan }, ambiguousLegacyCount: 0 } })
    const second = await service.replace(value)
    expect(second.ok && second.value.summary.id).not.toBe(first.value.summary.id)
    expect(await reopened.savedPlanContents.get(first.value.summary.id)).toMatchObject({ ok: false, error: { kind: 'notFound' } })
    expect(await reopened.savedPlanSummaries.listForProject(project.id)).toMatchObject({ ok: true, value: [expect.anything()] })
    expect(await reopened.currentCuttingResults.list()).toMatchObject({ ok: true, value: [{ id: project.id }] })
    expect(await reopened.stockItems.list()).toEqual(stock)
    expect(value).toEqual(original)
  })
  it('persists accepted manual edits with only compact reconstruction data', async () => {
    const { persistence } = await setup(); const value = input()
    const allocation = value.plan.panels[0]; if (!allocation) throw new Error('Fixture')
    const session = createPlanEditingSession(allocation.plan, { panel: product, parts: value.parts, settings: value.settings })
    if (!session.ok) throw new Error('Fixture')
    const edited = applyPlanEdit(session.session, { kind: 'swap', first: { partId: part.id, copyIndex: 0 }, second: { partId: part.id, copyIndex: 1 } })
    if (!edited.ok) throw new Error('Fixture')
    const current = createCurrentResultService(persistence).forProject(project.id)
    const editedInput = { ...value, plan: { ...value.plan, panels: [{ ...allocation, plan: currentEditingPlan(edited.session) }, ...value.plan.panels.slice(1)] }, editedPanelIndices: [0] }
    expect((await current.replace(editedInput)).ok).toBe(true)
    const restored = await current.load()
    expect(restored.ok && restored.value.result?.plan).toEqual(editedInput.plan)
    expect(restored.ok && restored.value.result?.contents.panels[0]?.edited).toBe(true)
    const serialized = JSON.stringify(restored.ok && restored.value.result?.contents)
    for (const field of ['history', 'cursor', 'optimizedPlan', 'placements', 'region', 'image', 'canvas', 'pdf']) expect(serialized).not.toContain(`"${field}"`)
  })
  it('isolates project results and rejects nonexistent owners', async () => {
    const { persistence } = await setup()
    const other = cuttingProjectSchema.parse({ ...project, id: 'other-project' }); await persistence.projects.create(other)
    const service = createCurrentResultService(persistence)
    await service.forProject(project.id).replace(input())
    expect(await service.forProject(other.id).load()).toEqual({ ok: true, value: { result: null, ambiguousLegacyCount: 0 } })
    const otherInput = input(); await service.forProject(other.id).replace(otherInput)
    await service.forProject(project.id).replace(input())
    expect(await service.forProject(other.id).load()).toMatchObject({ ok: true, value: { result: { plan: otherInput.plan } } })
    expect(await service.forProject(cuttingProjectSchema.shape.id.parse('missing')).replace(input())).toMatchObject({ ok: false, error: { kind: 'notFound' } })
  })
  it('preserves multiple legacy plans without choosing one and preserves them after a new run', async () => {
    const { persistence, plans } = await setup()
    await plans.save(metadata, input()); await plans.save({ ...metadata, id: 'plan-two' }, input())
    const before = await plans.list(); const bodies = await persistence.savedPlanContents.list()
    const current = createCurrentResultService(persistence).forProject(project.id)
    expect(await current.load()).toEqual({ ok: true, value: { result: null, ambiguousLegacyCount: 2 } })
    expect(await persistence.currentCuttingResults.list()).toEqual({ ok: true, value: [] })
    await current.replace(input()); await current.replace(input())
    const all = await plans.list()
    expect(all.ok && all.value).toHaveLength(3)
    for (const id of [metadata.id, savedPlanSummarySchema.shape.id.parse('plan-two')]) expect((await plans.get(id)).ok).toBe(true)
    expect(before.ok && before.value).toHaveLength(2)
    const now = await persistence.savedPlanContents.list()
    expect(now.ok && bodies.ok && now.value.filter(body => body.id !== (all.ok ? all.value.find(summary => !before.ok || !before.value.some(old => old.id === summary.id))?.id : null))).toEqual(bodies.ok && bodies.value)
  })
  it('adopts exactly one valid legacy plan without rewriting or deleting it', async () => {
    const { persistence, plans } = await setup(); const saved = await plans.save(metadata, input())
    const current = createCurrentResultService(persistence).forProject(project.id)
    expect(await current.load()).toMatchObject({ ok: true, value: { result: saved.ok && saved.value, ambiguousLegacyCount: 0 } })
    await current.replace(input()); await current.replace(input())
    expect(await plans.get(metadata.id)).toEqual(saved)
    expect(await plans.list()).toMatchObject({ ok: true, value: [expect.anything(), expect.anything()] })
  })
  it('does not adopt a sole corrupted legacy plan or discard its data', async () => {
    const { persistence, plans } = await setup()
    const saved = await plans.save(metadata, input()); if (!saved.ok) throw new Error('Fixture')
    await persistence.savedPlanContents.update(metadata.id, { ...saved.value.contents, metrics: { ...saved.value.contents.metrics, placedCount: 900 } })
    const before = await persistence.savedPlanContents.list()
    expect(await createCurrentResultService(persistence).forProject(project.id).load()).toMatchObject({ ok: false, error: { kind: 'invalidRecord' } })
    expect(await persistence.currentCuttingResults.list()).toEqual({ ok: true, value: [] })
    expect(await persistence.savedPlanContents.list()).toEqual(before)
  })
  it('rejects invalid inputs, corrupted payloads and cross-project references without dropping data', async () => {
    const { persistence } = await setup(); const current = createCurrentResultService(persistence).forProject(project.id)
    const saved = await current.replace(input()); if (!saved.ok) throw new Error('Fixture')
    const valid = input(); const invalid = { ...valid, plan: { ...valid.plan, metrics: { ...valid.plan.metrics, placedCount: 900 } } }
    expect(await current.replace(invalid)).toMatchObject({ ok: false, error: { kind: 'invalidRecord' } })
    expect(await current.load()).toMatchObject({ ok: true, value: { result: saved.value } })
    await persistence.savedPlanContents.update(saved.value.summary.id, { ...saved.value.contents, metrics: { ...saved.value.contents.metrics, placedCount: 900 } })
    const before = await persistence.savedPlanContents.list()
    expect(await current.load()).toMatchObject({ ok: false, error: { kind: 'invalidRecord' } })
    expect(await current.replace(input())).toMatchObject({ ok: false, error: { kind: 'invalidRecord' } })
    expect(await persistence.savedPlanContents.list()).toEqual(before)
    await persistence.savedPlanContents.update(saved.value.summary.id, saved.value.contents)
    const other = cuttingProjectSchema.parse({ ...project, id: 'other-project' }); await persistence.projects.create(other)
    await persistence.currentCuttingResults.create({ id: other.id, planId: saved.value.summary.id, preserveLegacy: false })
    expect(await createCurrentResultService(persistence).forProject(other.id).load()).toMatchObject({ ok: false, error: { kind: 'notFound' } })
  })
  it('rolls back failed replacement and invalidated pending writes', async () => {
    const { persistence } = await setup(); const current = createCurrentResultService(persistence).forProject(project.id)
    const saved = await current.replace(input()); if (!saved.ok) throw new Error('Fixture')
    const before = await current.load()
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementationOnce(() => { throw new Error('Disk full') })
    expect(await current.replace(input())).toMatchObject({ ok: false, error: { kind: 'storageFailure' } })
    vi.restoreAllMocks()
    expect(await current.load()).toEqual(before)
    const controller = new AbortController(); controller.abort()
    expect(await current.replace(input(), controller.signal)).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    expect(await current.load()).toEqual(before)
    const lateController = new AbortController()
    const invalidated = createCurrentResultService({ ...persistence, transaction: work => persistence.transaction(repositories => work({ ...repositories, currentCuttingResults: { ...repositories.currentCuttingResults, update: async (id, record) => {
      const written = await repositories.currentCuttingResults.update(id, record)
      lateController.abort()
      return written
    } } })) }).forProject(project.id)
    expect(await invalidated.replace(input(), lateController.signal)).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    expect(await current.load()).toEqual(before)
  })
  it('retains confirmed origins and idempotency while a replacement remains independent of stock movements', async () => {
    const { persistence } = await setup(); const current = createCurrentResultService(persistence).forProject(project.id)
    const saved = await current.replace(input()); if (!saved.ok) throw new Error('Fixture')
    const stock = await persistence.stockItems.create({ ...validStockItemInput, id: 'matching-stock', lengthMm: product.lengthMm, widthMm: product.widthMm, grainDirection: product.grainDirection, quantity: 2 })
    if (!stock.ok) throw new Error('Fixture')
    const cutting = createCuttingConfirmationService(persistence).forProject(project.id)
    const request = { confirmed: true, assignments: [{ panelIndex: 0, stockItemId: stock.value.id }, { panelIndex: 1, stockItemId: stock.value.id }], offcuts: [] }
    const receipt = await cutting.confirm(saved.value.summary.id, request); expect(receipt.ok).toBe(true)
    const inventory = await persistence.stockItems.list(); const movements = await cutting.list()
    expect((await current.replace(input())).ok).toBe(true)
    expect(await createSavedPlanService(persistence).forProject(project.id).get(saved.value.summary.id)).toEqual(saved)
    expect(await cutting.confirm(saved.value.summary.id, request)).toEqual(receipt)
    expect(await persistence.stockItems.list()).toEqual(inventory)
    expect(await cutting.list()).toEqual(movements)
  })
  it('adds version five without changing even ambiguous legacy payloads', async () => {
    const indexedDB = new IDBFactory(); const old = new Dexie('legacy-current', { indexedDB, IDBKeyRange }); connections.push(old)
    old.version(4).stores(DATABASE_V4_STORES)
    await old.table('projects').add(project)
    // Two summaries deliberately lack contents: schema upgrade must still preserve them.
    await old.table('savedPlanSummaries').bulkAdd([metadata, { ...metadata, id: 'plan-two' }]); old.close()
    const persistence = createLocalPersistence('legacy-current', { indexedDB, IDBKeyRange }); connections.push(persistence)
    expect((await persistence.open()).ok).toBe(true)
    expect(await persistence.savedPlanSummaries.list()).toMatchObject({ ok: true, value: [metadata, { ...metadata, id: 'plan-two' }] })
    expect(await createCurrentResultService(persistence).forProject(project.id).load()).toEqual({ ok: true, value: { result: null, ambiguousLegacyCount: 2 } })
  })
  it('round-trips the current reference with existing project JSON and remaps its relationships', async () => {
    const { persistence } = await setup()
    await createCurrentResultService(persistence).forProject(project.id).replace(input())
    const transfer = createProjectTransferService(persistence, projectJson)
    const exported = await transfer.export(project.id); if (!exported.ok) throw new Error('Export')
    const preview = await transfer.preview(exported.value.text); if (!preview.ok) throw new Error('Preview')
    expect(preview.value.file.currentResultId).toBeDefined()
    const imported = await transfer.import(preview.value.file, true); if (!imported.ok) throw new Error('Import')
    const restored = await createCurrentResultService(persistence).forProject(imported.value.id).load()
    expect(restored.ok && restored.value.result?.plan.panels).toHaveLength(2)
    expect(restored.ok && restored.value.result?.summary.id).not.toBe(preview.value.file.currentResultId)
    expect(restored.ok && restored.value.result?.contents.projectId).toBe(imported.value.id)
  })
})
