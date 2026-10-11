// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { createLocalPersistence } from '../../../infrastructure/persistence/local-database'
import { projectJson } from '../../../infrastructure/projects/project-json'
import { createProjectTransferService } from '../project-transfer-service'
import { validateProjectTransfer } from '../project-transfer-format'
import { createSavedPlanService } from '../../plans/saved-plan-service'
import { createProjectService } from '../project-service'
import { cuttingProjectSchema } from '../../../domain/model/cutting-project'
import { panelSnapshotSchema, savedPlanSummarySchema } from '../../../domain/model/saved-cutting-plan'
import { partSchema } from '../../../domain/model/part'
import { supplierProductSchema } from '../../../domain/model/supplier-product'
import { stockItemSchema } from '../../../domain/model/stock-item'
import { stockPanel } from '../../../domain/optimizer/panel-source'
import { optimizeProject } from '../../../domain/optimizer/optimize-project'
import { applyPlanEdit, createPlanEditingSession, currentEditingPlan } from '../../optimization/plan-editing-session'
import { validMaterialInput, validPartInput, validSupplierInput, validSupplierProductInput, validStockItemInput } from '../../../domain/model/__tests__/fixtures'

const connections: ReturnType<typeof createLocalPersistence>[] = []
afterEach(() => { connections.forEach(connection => { connection.close() }); connections.length = 0; vi.restoreAllMocks() })
function database() {
  const indexedDB = new IDBFactory()
  const persistence = createLocalPersistence('project-transfer', { indexedDB, IDBKeyRange }); connections.push(persistence)
  return { indexedDB, persistence, transfer: createProjectTransferService(persistence, projectJson) }
}
const project = cuttingProjectSchema.parse({ id: 'portable-project', name: 'Étagère 木', partIds: [], materialIds: [validMaterialInput.id], supplierProductIds: [validSupplierProductInput.id], panelQuantities: [{ supplierProductId: validSupplierProductInput.id, quantity: 2 }] })
const part = partSchema.parse({ ...validPartInput, lengthMm: 100, widthMm: 100, quantity: 4, grainDirection: 'none' })
const product = supplierProductSchema.parse({ ...validSupplierProductInput, lengthMm: 200, widthMm: 100, grainDirection: 'none' })
const summary = savedPlanSummarySchema.parse({ id: 'portable-plan', projectId: project.id, name: 'Edited cuts', createdAt: '2026-10-11T12:00:00.000Z' })
async function source() {
  const setup = database()
  const { persistence, transfer } = setup
  await persistence.materials.create(validMaterialInput); await persistence.suppliers.create(validSupplierInput); await persistence.supplierProducts.create(product)
  const service = createProjectService(persistence)
  expect((await service.projects.create(project)).ok).toBe(true)
  expect((await service.parts(project.id).create(part)).ok).toBe(true)
  await persistence.stockItems.create(validStockItemInput)
  await persistence.projects.create({ ...project, id: 'unrelated', name: 'Unrelated', partIds: [] })
  const settings = { kerfMm: 0, edgeMarginMm: 0 }
  const optimized = optimizeProject({ parts: [part], panels: [{ product, quantity: 2 }], settings })
  if (!optimized.ok || !optimized.plan.panels[0]) throw new Error('Fixture')
  const allocation = optimized.plan.panels[0]
  const session = createPlanEditingSession(allocation.plan, { panel: product, parts: [part], settings }); if (!session.ok) throw new Error('Fixture')
  const edited = applyPlanEdit(session.session, { kind: 'swap', first: { partId: part.id, copyIndex: 0 }, second: { partId: part.id, copyIndex: 1 } }); if (!edited.ok) throw new Error('Fixture')
  const { id, name, materialId, lengthMm, widthMm, thicknessMm, grainDirection } = product
  expect((await createSavedPlanService(persistence).forProject(project.id).save(summary, { plan: { ...optimized.plan, panels: [{ ...allocation, plan: currentEditingPlan(edited.session) }, ...optimized.plan.panels.slice(1)] }, parts: [part], settings, sources: [{ product: panelSnapshotSchema.parse({ id, name, materialId, lengthMm, widthMm, thicknessMm, grainDirection }), quantity: 2, materialName: 'Birch', supplierName: 'Supplier' }], editedPanelIndices: [0] })).ok).toBe(true)
  const exported = await transfer.export(project.id); if (!exported.ok) throw new Error('Expected export')
  const validated = validateProjectTransfer(projectJson.parse(exported.value.text)); if (!validated.ok) throw new Error('Expected valid transfer')
  return { ...setup, text: exported.value.text, file: validated.value }
}
async function inventorySnapshot(persistence: ReturnType<typeof createLocalPersistence>) {
  return { projects: await persistence.projects.list(), parts: await persistence.parts.list(), materials: await persistence.materials.list(), suppliers: await persistence.suppliers.list(), products: await persistence.supplierProducts.list(), summaries: await persistence.savedPlanSummaries.list(), contents: await persistence.savedPlanContents.list(), stock: await persistence.stockItems.list(), confirmations: await persistence.cuttingConfirmations.list() }
}
describe('portable project transfer', () => {
  it('preserves stock selections and historical stock layouts without transferring inventory or remapping them as catalog products', async () => {
    const original = await source()
    const owner = await original.persistence.projects.get(project.id)
    if (!owner.ok) throw new Error('Missing project')
    const stock = stockItemSchema.parse({ ...validStockItemInput, lengthMm: 200, widthMm: 100, quantity: 2, grainDirection: 'none' })
    await original.persistence.stockItems.update(stock.id, stock)
    const sourcePanel = stockPanel(stock)
    const settings = { kerfMm: 0, edgeMarginMm: 0 }
    const plan = optimizeProject({ parts: [part], settings, panels: [{ product: sourcePanel, quantity: stock.quantity }] })
    if (!plan.ok) throw new Error('Invalid stock fixture')
    const selected = { ...owner.value, stockItemIds: [stock.id] }
    expect((await createProjectService(original.persistence).projects.update(project.id, selected)).ok).toBe(true)
    const saved = await createSavedPlanService(original.persistence).forProject(project.id).save({ ...summary, id: 'stock-plan' }, { plan: plan.plan, parts: [part], settings, sources: [{ product: panelSnapshotSchema.parse({ id: sourcePanel.id, stockItemId: stock.id, name: sourcePanel.name, materialId: stock.materialId, lengthMm: stock.lengthMm, widthMm: stock.widthMm, thicknessMm: stock.thicknessMm, grainDirection: stock.grainDirection }), quantity: stock.quantity, materialName: 'Birch', supplierName: 'Owned stock' }], editedPanelIndices: [] })
    expect(saved.ok).toBe(true)
    const exported = await original.transfer.export(project.id)
    if (!exported.ok) throw new Error('Export failed')
    const file = validateProjectTransfer(projectJson.parse(exported.value.text))
    if (!file.ok) throw new Error('Invalid file')
    const target = database()
    const imported = await target.transfer.import(file.value, true)
    if (!imported.ok) throw new Error('Import failed')
    expect(imported.value.stockItemIds).toEqual([stock.id])
    expect(await target.persistence.stockItems.list()).toEqual({ ok: true, value: [] })
    const plans = await createSavedPlanService(target.persistence).forProject(imported.value.id).list()
    if (!plans.ok) throw new Error('Missing imported plans')
    const stored = plans.value.find(record => record.id === 'stock-plan')
    if (!stored) throw new Error('Missing stock plan')
    const opened = await createSavedPlanService(target.persistence).forProject(imported.value.id).get(stored.id)
    expect(opened.ok && opened.value.contents.sources[0]?.product.stockItemId).toBe(stock.id)
    expect(opened.ok && opened.value.plan.metrics.placedCount).toBe(4)
  })

  it('round-trips UTF-8 Parts, selections, complete edited multi-panel plans and timestamps into an empty installation', async () => {
    const original = await source(); const target = database()
    const before = await inventorySnapshot(original.persistence)
    const preview = await target.transfer.preview(original.text)
    expect(preview).toMatchObject({ ok: true, value: { projectIdCollision: false, catalogConflicts: 0, reusedCatalogRecords: 0 } })
    expect((await target.persistence.projects.list())).toEqual({ ok: true, value: [] })
    expect((await target.transfer.import(original.file, true))).toEqual({ ok: true, value: original.file.project })
    expect(await createProjectService(target.persistence).parts(project.id).list()).toEqual({ ok: true, value: [part] })
    const opened = await createSavedPlanService(target.persistence).forProject(project.id).get(summary.id)
    const previous = await createSavedPlanService(original.persistence).forProject(project.id).get(summary.id)
    expect(opened).toEqual(previous); expect(opened.ok && opened.value.contents.panels[0]?.edited).toBe(true)
    expect((await target.transfer.export(project.id))).toEqual({ ok: true, value: { text: original.text, name: project.name } })
    expect(await inventorySnapshot(original.persistence)).toEqual(before)
    expect(await target.persistence.stockItems.list()).toEqual({ ok: true, value: [] })
    expect(await target.persistence.cuttingConfirmations.list()).toEqual({ ok: true, value: [] })
    target.persistence.close()
    const reopened = createLocalPersistence('project-transfer', { indexedDB: target.indexedDB, IDBKeyRange }); connections.push(reopened)
    expect(await createSavedPlanService(reopened).forProject(project.id).get(summary.id)).toEqual(opened)
  })

  it('preserves deselected legacy Part associations and edited plans through export/import', async () => {
    const original = await source()
    const service = createProjectService(original.persistence)
    const owner = await service.projects.get(project.id)
    if (!owner.ok) throw new Error('Missing project')
    expect((await service.projects.update(project.id, { ...owner.value, materialIds: [], supplierProductIds: [], panelQuantities: [] })).ok).toBe(true)
    const before = await service.parts(project.id).list()
    const stock = await inventorySnapshot(original.persistence)
    const exported = await original.transfer.export(project.id)
    if (!exported.ok) throw new Error('Export')
    const target = database()
    const preview = await target.transfer.preview(exported.value.text)
    if (!preview.ok) throw new Error('Preview')
    expect(preview.value.file.project.materialIds).toEqual([])
    expect(preview.value.file.project.supplierProductIds).toEqual([])
    expect(preview.value.file.parts).toEqual([part])
    expect(preview.value.file.catalog.materials).toEqual([validMaterialInput])
    expect((await target.transfer.import(preview.value.file, true)).ok).toBe(true)
    const importedService = createProjectService(target.persistence)
    expect(await importedService.parts(project.id).list()).toEqual(before)
    expect(await importedService.parts(project.id).create({ ...part, id: 'new-unselected-part' })).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    const plan = await createSavedPlanService(target.persistence).forProject(project.id).get(summary.id)
    expect(plan.ok && plan.value.contents.panels[0]?.edited).toBe(true)
    expect(await inventorySnapshot(original.persistence)).toEqual(stock)
    expect(await target.persistence.stockItems.list()).toEqual({ ok: true, value: [] })
  })
  it('exports only related catalog dependencies and compact persisted plans', async () => {
    const { file, text, persistence, transfer } = await source()
    await persistence.materials.create({ ...validMaterialInput, id: 'other-material', name: 'Other' })
    const next = await transfer.export(project.id); expect(next.ok && next.value.text).toBe(text)
    expect(Object.keys(file).sort()).toEqual(['catalog', 'format', 'parts', 'project', 'savedPlans', 'schemaVersion'])
    expect(file.catalog.materials).toHaveLength(1); expect(file.catalog.products).toHaveLength(1)
    expect(text).toContain('Étagère 木'); expect(text).toContain('\n  "schemaVersion": 1')
    for (const field of ['stockItems', 'cuttingConfirmations', 'unrelated', 'canvas', 'pdf', 'history', 'placements', 'region']) expect(text).not.toContain(`"${field}"`)
  })
  it('reuses only identical stable catalog identities and remaps existing project, Part and saved plan IDs', async () => {
    const { transfer, persistence, file, text } = await source()
    const preview = await transfer.preview(text)
    expect(preview).toMatchObject({ ok: true, value: { projectIdCollision: true, reusedCatalogRecords: 3, catalogConflicts: 0 } })
    const beforeStock = await persistence.stockItems.list()
    const imported = await transfer.import(file, true); if (!imported.ok) throw new Error('Import')
    expect(imported.value.id).not.toBe(project.id); expect(imported.value.partIds[0]).not.toBe(part.id)
    expect(imported.value.materialIds).toEqual(file.project.materialIds); expect(imported.value.supplierProductIds).toEqual(file.project.supplierProductIds)
    const plans = createSavedPlanService(persistence).forProject(imported.value.id)
    const listed = await plans.list(); if (!listed.ok || !listed.value[0]) throw new Error('Plans')
    expect(listed.value[0].id).not.toBe(summary.id)
    const opened = await plans.get(listed.value[0].id); if (!opened.ok) throw new Error('Open')
    expect(opened.value.contents.parts[0]?.id).toBe(imported.value.partIds[0]); expect(opened.value.plan.panels[0]?.plan.placements[0]?.partId).toBe(imported.value.partIds[0])
    expect(await persistence.materials.list()).toEqual({ ok: true, value: file.catalog.materials })
    expect(await persistence.stockItems.list()).toEqual(beforeStock)
    expect(await persistence.projects.get(file.project.id)).toEqual({ ok: true, value: file.project })
  })
  it('remaps conflicting catalog IDs and all physical/history relationships without overwriting existing records', async () => {
    const original = await source(); const target = database()
    await target.persistence.materials.create({ ...validMaterialInput, name: 'Different material' })
    await target.persistence.suppliers.create({ ...validSupplierInput, name: 'Different supplier' })
    await target.persistence.supplierProducts.create({ ...product, thicknessMm: 22 })
    await target.persistence.stockItems.create(validStockItemInput)
    const preview = await target.transfer.preview(original.text)
    expect(preview).toMatchObject({ ok: true, value: { catalogConflicts: 3, reusedCatalogRecords: 0 } })
    const before = await inventorySnapshot(target.persistence)
    const imported = await target.transfer.import(original.file, true); if (!imported.ok) throw new Error('Import')
    const newMaterial = imported.value.materialIds[0]; const newProduct = imported.value.supplierProductIds[0]
    expect(newMaterial).not.toBe(validMaterialInput.id); expect(newProduct).not.toBe(product.id)
    const parts = await createProjectService(target.persistence).parts(imported.value.id).list()
    expect(parts.ok && parts.value[0]?.materialId).toBe(newMaterial)
    const saved = await createSavedPlanService(target.persistence).forProject(imported.value.id).get(summary.id)
    expect(saved.ok && saved.value.contents.sources[0]?.product.materialId).toBe(newMaterial)
    expect(saved.ok && saved.value.plan.panels[0]?.supplierProductId).toBe(newProduct)
    expect(await target.persistence.stockItems.list()).toEqual(before.stock)
    expect(await target.persistence.supplierProducts.get(product.id)).toEqual({ ok: true, value: { ...product, thicknessMm: 22 } })
  })
  it('preserves historical snapshots when current Parts/catalog dimensions change or historical references disappear', async () => {
    const original = await source()
    await original.persistence.parts.update(part.id, { ...part, thicknessMm: 22 })
    await original.persistence.supplierProducts.update(product.id, { ...product, thicknessMm: 22 })
    const exported = await original.transfer.export(project.id); if (!exported.ok) throw new Error('Export')
    const target = database(); const preview = await target.transfer.preview(exported.value.text); if (!preview.ok) throw new Error('Preview')
    expect((await target.transfer.import(preview.value.file, true)).ok).toBe(true)
    const saved = await createSavedPlanService(target.persistence).forProject(project.id).get(summary.id)
    expect(saved.ok && saved.value.contents.parts[0]?.thicknessMm).toBe(18)
    expect(saved.ok && saved.value.contents.sources[0]?.product.thicknessMm).toBe(18)
    await original.persistence.projects.update(project.id, { ...original.file.project, supplierProductIds: [], panelQuantities: [] })
    await original.persistence.supplierProducts.delete(product.id)
    const historical = await original.transfer.export(project.id); expect(historical.ok).toBe(true)
    if (!historical.ok) throw new Error('Export')
    const parsed = validateProjectTransfer(projectJson.parse(historical.value.text))
    expect(parsed.ok && parsed.value.catalog.products).toEqual([])
    expect(parsed.ok && parsed.value.savedPlans[0]?.contents.sources[0]?.product.id).toBe(product.id)
  })
  it('rejects malformed, unsupported, inconsistent and corrupted files before any writes', async () => {
    const { file } = await source(); const target = database()
    const plan = file.savedPlans[0]; if (!plan) throw new Error('Fixture')
    const invalid: unknown[] = [null, {}, { ...file, schemaVersion: 999 }, { ...file, format: 'other' }, { ...file, stockItems: [] }, { ...file, parts: [{ ...part, thicknessMm: undefined }] }, { ...file, parts: [part, part] }, { ...file, catalog: { ...file.catalog, materials: [] } }, { ...file, project: { ...file.project, partIds: [] } }, { ...file, savedPlans: [{ ...plan, summary: { ...plan.summary, projectId: 'other' } }] }, { ...file, savedPlans: [{ ...plan, contents: { ...plan.contents, metrics: { ...plan.contents.metrics, placedCount: 999 } } }] }, { ...file, savedPlans: [{ ...plan, contents: { ...plan.contents, panels: [{ ...plan.contents.panels[0], tree: { kind: 'cut', cut: { axis: 'length', offsetMm: 9000 }, first: { kind: 'waste' }, second: { kind: 'waste' } } }] } }] }]
    const before = await inventorySnapshot(target.persistence)
    for (const input of invalid) { expect((await target.transfer.preview(JSON.stringify(input))).ok).toBe(false); expect((await target.transfer.import(input, true)).ok).toBe(false) }
    expect((await target.transfer.preview('{broken json')).ok).toBe(false)
    expect((await target.transfer.import(file, false)).ok).toBe(false)
    expect(await inventorySnapshot(target.persistence)).toEqual(before)
  })
  it('rolls back every catalog, Part, project and summary insert when saved payload storage fails', async () => {
    const { file } = await source(); const target = database()
    await target.persistence.stockItems.create(validStockItemInput)
    const before = await inventorySnapshot(target.persistence)
    const transaction = target.persistence.transaction.bind(target.persistence)
    vi.spyOn(target.persistence, 'transaction').mockImplementation(work => transaction(repositories => work({ ...repositories, savedPlanContents: { ...repositories.savedPlanContents, create: () => Promise.resolve({ ok: false, error: { kind: 'storageFailure', message: 'Disk full' } }) } })))
    expect(await target.transfer.import(file, true)).toMatchObject({ ok: false, error: { kind: 'storageFailure' } })
    expect(await inventorySnapshot(target.persistence)).toEqual(before)
  })
  it('rechecks collisions created after preview and serializes concurrent imports without duplicates or overwrite', async () => {
    const { file, text } = await source(); const target = database()
    await target.transfer.preview(text)
    const outcomes = await Promise.all([target.transfer.import(file, true), target.transfer.import(file, true)])
    expect(outcomes.every(outcome => outcome.ok)).toBe(true)
    if (!outcomes[0].ok || !outcomes[1].ok) throw new Error('Import')
    expect(outcomes[0].value.id).not.toBe(outcomes[1].value.id)
    expect(await target.persistence.materials.list()).toEqual({ ok: true, value: file.catalog.materials })
  })
  it('fails export explicitly on missing live selections rather than discarding project data', async () => {
    const { persistence, transfer } = await source()
    await persistence.supplierProducts.delete(product.id)
    expect(await transfer.export(project.id)).toMatchObject({ ok: false, error: { kind: 'notFound' } })
    expect(await persistence.projects.get(project.id)).toMatchObject({ ok: true, value: { supplierProductIds: [product.id] } })
  })
  it('reserves dangling stock references instead of attaching unrelated inventory to imported catalog records', async () => {
    const original = await source(); const target = database()
    const stock = { ...validStockItemInput, provenance: { source: 'purchase', supplierProductId: product.id } }
    await target.persistence.stockItems.create(stock)
    const imported = await target.transfer.import(original.file, true); if (!imported.ok) throw new Error('Import')
    expect(imported.value.materialIds[0]).not.toBe(validMaterialInput.id)
    expect(imported.value.supplierProductIds[0]).not.toBe(product.id)
    expect(await target.persistence.stockItems.list()).toEqual({ ok: true, value: [stock] })
  })
  it('transfers historical-only plans after all live dependencies have been explicitly removed', async () => {
    const original = await source()
    await original.persistence.projects.update(project.id, { ...original.file.project, partIds: [], materialIds: [], supplierProductIds: [], panelQuantities: [] })
    await original.persistence.parts.delete(part.id); await original.persistence.supplierProducts.delete(product.id)
    await original.persistence.materials.delete(part.materialId); await original.persistence.suppliers.delete(product.supplierId)
    const exported = await original.transfer.export(project.id); if (!exported.ok) throw new Error('Export')
    const target = database()
    const preview = await target.transfer.preview(`\uFEFF${exported.value.text}`); if (!preview.ok) throw new Error('Preview')
    expect(preview.value.file.catalog).toEqual({ materials: [], products: [], suppliers: [] })
    expect((await target.transfer.import(preview.value.file, true)).ok).toBe(true)
    const saved = await createSavedPlanService(target.persistence).forProject(project.id).get(summary.id)
    expect(saved.ok && saved.value.plan.panels).toHaveLength(2)
    expect(saved.ok && saved.value.contents.parts).toEqual([part])
    expect(await target.persistence.parts.list()).toEqual({ ok: true, value: [] })
  })

})
