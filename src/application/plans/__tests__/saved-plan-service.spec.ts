// @vitest-environment node
import Dexie from 'dexie'
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocalPersistence, DATABASE_STORES, DATABASE_VERSION, DATABASE_V2_STORES } from '../../../infrastructure/persistence/local-database'
import { createSavedPlanService, type SavePlanInput } from '../saved-plan-service'
import { cuttingProjectSchema } from '../../../domain/model/cutting-project'
import { partSchema } from '../../../domain/model/part'
import { supplierProductSchema } from '../../../domain/model/supplier-product'
import { panelSnapshotSchema, savedPlanContentsSchema, savedPlanSummarySchema } from '../../../domain/model/saved-cutting-plan'
import { validPartInput, validSupplierProductInput, validMaterialInput, validSupplierInput, validStockItemInput } from '../../../domain/model/__tests__/fixtures'
import { optimizeProject } from '../../../domain/optimizer/optimize-project'
import { createPlanEditingSession, applyPlanEdit, currentEditingPlan } from '../../optimization/plan-editing-session'
import { createProjectService } from '../../projects/project-service'
import { createCuttingPlanPdfService } from '../../export/cutting-plan-pdf-service'
import { generateCuttingPlanPdf } from '../../../infrastructure/pdf/cutting-plan-pdf'

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
describe('project saved cutting plans', () => {
  it('saves a coherent result atomically and reopens all layouts after closing the database', async () => {
    const { indexedDB, persistence, plans } = await setup()
    const value = input()
    const before = structuredClone(value)
    const inventory = await persistence.stockItems.list()
    const saved = await plans.save(metadata, value)
    expect(saved.ok).toBe(true)
    persistence.close()
    const reopened = createLocalPersistence('saved-plans-test', { indexedDB, IDBKeyRange })
    connections.push(reopened)
    const opened = await createSavedPlanService(reopened).forProject(project.id).get(metadata.id)
    expect(opened.ok).toBe(true)
    if (!opened.ok) throw new Error('Expected saved plan')
    expect(opened.value.plan).toEqual(value.plan)
    expect(opened.value.contents.sources).toHaveLength(1)
    expect(value).toEqual(before)
    expect(await reopened.stockItems.list()).toEqual(inventory)
  })
  it('persists accepted edits without persisting optimizer baselines or Undo/Redo history', async () => {
    const { plans, persistence } = await setup()
    const value = input()
    const allocated = value.plan.panels[0]
    if (!allocated) throw new Error('Fixture')
    const session = createPlanEditingSession(allocated.plan, { panel: product, parts: value.parts, settings: value.settings })
    if (!session.ok) throw new Error(session.error.message)
    const edited = applyPlanEdit(session.session, { kind: 'swap', first: { partId: part.id, copyIndex: 0 }, second: { partId: part.id, copyIndex: 1 } })
    if (!edited.ok) throw new Error(edited.error.message)
    const plan = { ...value.plan, panels: [{ ...allocated, plan: currentEditingPlan(edited.session) }, ...value.plan.panels.slice(1)] }
    const saved = await plans.save(metadata, { ...value, plan, editedPanelIndices: [0] })
    expect(saved.ok).toBe(true)
    const reopened = await plans.get(metadata.id)
    expect(reopened.ok && reopened.value.plan.panels[0]?.plan.placements[0]?.copyIndex).toBe(1)
    expect(reopened.ok && reopened.value.contents.panels[0]?.edited).toBe(true)
    const body = await persistence.savedPlanContents.get(metadata.id)
    if (!body.ok) throw new Error('Expected body')
    expect(Object.keys(body.value).sort()).toEqual(['formatVersion', 'id', 'metrics', 'panels', 'parts', 'projectId', 'settings', 'sources', 'unplaced'].sort())
    const serialized = JSON.stringify(body.value)
    for (const field of ['history', 'cursor', 'optimizedPlan', 'placements', 'region', 'image', 'canvas', 'pdf', 'price', 'currency', 'productUrl']) expect(serialized).not.toContain(`"${field}"`)
    expect(savedPlanContentsSchema.safeParse({ ...body.value, history: [] }).success).toBe(false)
  })
  it('preserves unplaced quantities and fit/kerf diagnostics without storing repeated derived issues', async () => {
    const { plans } = await setup()
    const parts = [part, partSchema.parse({ ...part, id: 'kerf-impossible', lengthMm: 197, quantity: 1 }), partSchema.parse({ ...part, id: 'oversized', lengthMm: 900, quantity: 1 })]
    const settings = { kerfMm: 3, edgeMarginMm: 0 }
    const result = optimizeProject({ parts, panels: [{ product, quantity: 1 }], settings })
    if (!result.ok) throw new Error('Fixture')
    const value = { ...input(), plan: result.plan, parts, settings, sources: [{ ...input().sources[0], product: panelSnapshot, quantity: 1, materialName: validMaterialInput.name, supplierName: validSupplierInput.name }] }
    expect((await plans.save(metadata, value)).ok).toBe(true)
    const opened = await plans.get(metadata.id)
    expect(opened.ok && opened.value.plan).toEqual(result.plan)
    expect(opened.ok && JSON.stringify(opened.value.contents)).not.toContain('usableArea')
  })
  it('isolates projects and never overwrites an existing ID', async () => {
    const { plans, persistence, service } = await setup()
    const other = cuttingProjectSchema.parse({ ...project, id: 'other-project' })
    await persistence.projects.create(other)
    const otherPlans = service.forProject(other.id)
    expect((await plans.save(metadata, input())).ok).toBe(true)
    const original = await plans.get(metadata.id)
    expect(await otherPlans.list()).toEqual({ ok: true, value: [] })
    for (const operation of [otherPlans.get(metadata.id), otherPlans.rename(metadata.id, 'Stolen'), otherPlans.delete(metadata.id)]) expect(await operation).toMatchObject({ ok: false, error: { kind: 'notFound' } })
    expect(await otherPlans.save(metadata, input())).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    expect(await plans.save({ ...metadata, name: 'Overwrite' }, input())).toMatchObject({ ok: false, error: { kind: 'duplicateId' } })
    expect(await plans.get(metadata.id)).toEqual(original)
  })
  it('renames only metadata and deletes both records atomically', async () => {
    const { plans, persistence } = await setup()
    await plans.save(metadata, input())
    const body = await persistence.savedPlanContents.get(metadata.id)
    expect(await plans.rename(metadata.id, ' ')).toMatchObject({ ok: false, error: { kind: 'invalidRecord' } })
    expect(await plans.rename(metadata.id, 'Workshop plan')).toMatchObject({ ok: true, value: { name: 'Workshop plan', createdAt: metadata.createdAt } })
    expect(await persistence.savedPlanContents.get(metadata.id)).toEqual(body)
    expect(await plans.delete(metadata.id)).toEqual({ ok: true, value: undefined })
    expect(await plans.list()).toEqual({ ok: true, value: [] })
    expect(await plans.get(metadata.id)).toMatchObject({ ok: false, error: { kind: 'notFound' } })
    expect(await persistence.savedPlanContents.get(metadata.id)).toMatchObject({ ok: false, error: { kind: 'notFound' } })
  })
  it('loads summary lists without reading or deserializing any cutting trees', async () => {
    const { plans } = await setup()
    await plans.save(metadata, input())
    const reads = [vi.spyOn(IDBObjectStore.prototype, 'get'), vi.spyOn(IDBObjectStore.prototype, 'getAll'), vi.spyOn(IDBObjectStore.prototype, 'openCursor')]
    expect(await plans.list()).toEqual({ ok: true, value: [metadata] })
    for (const read of reads) expect(read.mock.contexts.some(store => store instanceof IDBObjectStore && store.name === 'savedPlanContents')).toBe(false)
  })
  it('rejects malformed trees, missing copies, geometry corruption and metrics before saving', async () => {
    const { plans } = await setup()
    const value = input()
    const allocated = value.plan.panels[0]
    if (!allocated) throw new Error('Fixture')
    for (const plan of [
      { ...value.plan, panels: [{ ...allocated, plan: { ...allocated.plan, tree: { ...allocated.plan.tree, region: { ...allocated.plan.tree.region, xMm: 1 } } } }, ...value.plan.panels.slice(1)] },
      { ...value.plan, panels: [allocated] },
      { ...value.plan, metrics: { ...value.plan.metrics, placedCount: 900 } },
    ]) expect(await plans.save(metadata, { ...value, plan })).toMatchObject({ ok: false, error: { kind: 'invalidRecord' } })
    expect(await plans.list()).toEqual({ ok: true, value: [] })
  })
  it('rejects corrupted stored trees and snapshots on open without deleting them', async () => {
    const { plans, persistence, indexedDB } = await setup()
    await plans.save(metadata, input())
    const body = await persistence.savedPlanContents.get(metadata.id)
    if (!body.ok) throw new Error('Expected body')
    const raw = new Dexie('saved-plans-test', { indexedDB, IDBKeyRange })
    raw.version(DATABASE_VERSION).stores(DATABASE_STORES)
    connections.push(raw)
    const cyclic: Record<string, unknown> = { kind: 'cut', cut: { axis: 'length', offsetMm: 100 } }
    cyclic.first = cyclic; cyclic.second = { kind: 'waste' }
    for (const corrupt of [
      { ...body.value, panels: [{ ...body.value.panels[0], tree: cyclic }] },
      { ...body.value, panels: body.value.panels.map(panel => ({ ...panel, tree: { kind: 'cut', cut: { axis: 'length', offsetMm: 9000 }, first: { kind: 'waste' }, second: { kind: 'waste' } } })) },
      { ...body.value, parts: [{ ...part, thicknessMm: 19 }] },
      { ...body.value, sources: [] },
      { ...body.value, projectId: 'another-owner' },
      { ...body.value, formatVersion: 99 },
      { ...body.value, panels: [{ tree: { kind: 'unknown' } }] },
    ]) {
      await raw.table('savedPlanContents').put(corrupt)
      expect(await plans.get(metadata.id)).toMatchObject({ ok: false, error: { kind: 'invalidRecord' } })
      if (corrupt.projectId === 'another-owner') expect(await plans.delete(metadata.id)).toMatchObject({ ok: false, error: { kind: 'invalidRecord' } })
      expect(await raw.table('savedPlanContents').count()).toBe(1)
      expect(await plans.list()).toEqual({ ok: true, value: [metadata] })
    }
  })
  it('retains historical geometry and PDF export when catalog and project records change or disappear', async () => {
    const { plans, persistence } = await setup()
    await plans.save(metadata, input())
    await persistence.supplierProducts.update(product.id, { ...product, lengthMm: 900, thicknessMm: 22 })
    await persistence.supplierProducts.delete(product.id)
    await persistence.materials.delete(part.materialId)
    await persistence.suppliers.delete(product.supplierId)
    const opened = await plans.get(metadata.id)
    if (!opened.ok) throw new Error('Historical snapshot should be independent')
    expect(opened.value.contents.sources[0]?.product).toEqual(panelSnapshot)
    expect(opened.value.contents.parts).toEqual([part])
    const allocation = opened.value.plan.panels[0]
    if (!allocation) throw new Error('Expected panel')
    const pdf = await createCuttingPlanPdfService({ generate: generateCuttingPlanPdf }).export({ plan: allocation.plan, panel: panelSnapshot, parts: opened.value.contents.parts, settings: opened.value.contents.settings, materialName: validMaterialInput.name, orientation: 'portrait', edited: false })
    expect(pdf.ok).toBe(true)
  })
  it('rolls back metadata when a payload insert fails and blocks deleting a project with saved plans', async () => {
    const { plans, persistence } = await setup()
    const saved = await plans.save(metadata, input())
    if (!saved.ok) throw new Error('Fixture')
    await persistence.savedPlanSummaries.delete(metadata.id)
    expect(await plans.save(metadata, input())).toMatchObject({ ok: false, error: { kind: 'duplicateId' } })
    expect(await plans.list()).toEqual({ ok: true, value: [] })
    await persistence.savedPlanSummaries.create(metadata)
    expect(await createProjectService(persistence).projects.delete(project.id)).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
  })
  it('upgrades production version 2 additively without rewriting any existing records', async () => {
    const indexedDB = new IDBFactory()
    const previous = new Dexie('upgrade-saved-plans', { indexedDB, IDBKeyRange })
    previous.version(2).stores(DATABASE_V2_STORES)
    await previous.table('projects').add(project)
    await previous.table('parts').add(validPartInput)
    await previous.table('materials').add(validMaterialInput)
    await previous.table('supplierProducts').add(validSupplierProductInput)
    await previous.table('stockItems').add(validStockItemInput)
    previous.close()
    const upgraded = createLocalPersistence('upgrade-saved-plans', { indexedDB, IDBKeyRange })
    connections.push(upgraded)
    expect(await upgraded.open()).toEqual({ ok: true, value: undefined })
    expect(await upgraded.projects.get(project.id)).toEqual({ ok: true, value: project })
    expect((await upgraded.parts.list())).toEqual({ ok: true, value: [validPartInput] })
    expect((await upgraded.materials.list())).toEqual({ ok: true, value: [validMaterialInput] })
    expect((await upgraded.supplierProducts.list())).toEqual({ ok: true, value: [validSupplierProductInput] })
    expect((await upgraded.stockItems.list())).toEqual({ ok: true, value: [validStockItemInput] })
    expect(await createSavedPlanService(upgraded).forProject(project.id).list()).toEqual({ ok: true, value: [] })
  })
})
