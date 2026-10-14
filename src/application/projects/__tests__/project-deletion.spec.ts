// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { createLocalPersistence } from '../../../infrastructure/persistence/local-database'
import { createProjectService } from '../project-service'
import { createCurrentResultService } from '../../plans/current-result-service'
import { createProjectStockService } from '../../inventory/project-stock-service'
import { cuttingConfirmationSchema } from '../../../domain/model/cutting-confirmation'
import { cuttingProjectSchema } from '../../../domain/model/cutting-project'
import { stockItemSchema } from '../../../domain/model/stock-item'
import { partSchema } from '../../../domain/model/part'
import { supplierProductSchema } from '../../../domain/model/supplier-product'
import { panelSnapshotSchema } from '../../../domain/model/saved-cutting-plan'
import { stockPanel } from '../../../domain/optimizer/panel-source'
import { optimizeProject } from '../../../domain/optimizer/optimize-project'
import { validMaterialInput, validPartInput, validStockItemInput, validSupplierProductInput } from '../../../domain/model/__tests__/fixtures'
import type { PersistenceResult } from '../../persistence/repositories'
function value<T>(result: PersistenceResult<T>): T { if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.value }
const connections: ReturnType<typeof createLocalPersistence>[] = []
afterEach(() => { connections.forEach(item => { item.close() }); connections.length = 0; vi.restoreAllMocks() })
async function setup(source: 'stock' | 'catalog' | 'mixed' = 'stock') {
  const persistence = createLocalPersistence('delete-project', { indexedDB: new IDBFactory(), IDBKeyRange }); connections.push(persistence)
  const service = createProjectService(persistence)
  const project = cuttingProjectSchema.parse({ id: 'source-project', name: 'Workshop', partIds: [], materialIds: [validMaterialInput.id], supplierProductIds: [] })
  value(await persistence.materials.create(validMaterialInput)); value(await service.projects.create(project))
  const other = cuttingProjectSchema.parse({ ...project, id: 'other-project' }); value(await service.projects.create(other))
  const stock = stockItemSchema.parse({ ...validStockItemInput, lengthMm: 200, widthMm: 100, quantity: 2, grainDirection: 'none', provenance: { source: 'manual' } })
  value(await persistence.stockItems.create(stock))
  const catalog = supplierProductSchema.parse({ ...validSupplierProductInput, lengthMm: 200, widthMm: 100, grainDirection: 'none' }); value(await persistence.supplierProducts.create(catalog))
  const part = partSchema.parse({ ...validPartInput, lengthMm: 100, widthMm: 100, grainDirection: 'none', quantity: source === 'mixed' ? 2 : 1 }); value(await service.parts(project.id).create(part))
  const products = source === 'mixed' ? [stockPanel(stock), catalog] : [source === 'stock' ? stockPanel(stock) : catalog]
  const settings = { kerfMm: 3, edgeMarginMm: 0 }
  const result = optimizeProject({ parts: [part], panels: products.map(product => ({ product, quantity: 1 })), settings })
  if (!result.ok) throw new Error('Invalid fixture')
  const saved = value(await createCurrentResultService(persistence).forProject(project.id).replace({ plan: result.plan, parts: [part], settings, editedPanelIndices: [], sources: products.map(product => ({ product: panelSnapshotSchema.parse({ id: product.id, name: product.name, materialId: product.materialId, lengthMm: product.lengthMm, widthMm: product.widthMm, thicknessMm: product.thicknessMm, grainDirection: product.grainDirection, ...('stockItemId' in product ? { stockItemId: product.stockItemId } : {}) }), quantity: 1, materialName: 'Birch', supplierName: 'Source' })) }))
  const offcuts = createProjectStockService(persistence).forProject(project.id)
  for (const row of value(await offcuts.preview()).rows) value(await offcuts.setKeep(row.key, true))
  return { persistence, service, project, other, stock, part, saved, offcuts }
}
describe('atomic project deletion with stock handling', () => {
  it.each(['stock', 'catalog', 'mixed'] as const)('keeps current %s stock and history while deleting all project-owned records', async source => {
    const { persistence, service, project, other, saved, offcuts } = await setup(source)
    const inventory = value(await persistence.stockItems.list())
    const movements = value(await offcuts.preview()).movements
    value(await service.deleteProject(project.id, 'keep'))
    expect(value(await persistence.stockItems.list())).toEqual(inventory)
    expect(value(await persistence.parts.list())).toEqual([])
    expect(value(await persistence.savedPlanSummaries.listForProject(project.id))).toEqual([])
    expect(value(await persistence.savedPlanContents.list())).toEqual([])
    expect(value(await persistence.currentCuttingResults.find(project.id))).toBeNull()
    const audit = value(await persistence.projectStock.find(project.id))
    expect(audit?.deletedProject?.name).toBe(project.name); expect(audit?.entries).toEqual([]); expect(audit?.movements).toEqual(movements)
    expect(value(await persistence.projects.get(other.id))).toEqual(other)
    expect(value(await persistence.materials.list())).toHaveLength(1)
    expect(value(await persistence.supplierProducts.list())).toHaveLength(1)
    expect(await offcuts.sync()).toMatchObject({ ok: false })
    expect(await service.deleteProject(project.id, 'keep')).toMatchObject({ ok: false })
    expect(value(await persistence.stockItems.list())).toEqual(inventory)
    const retained = inventory.find(item => item.provenance.source === 'cutting')
    if (!retained) throw new Error('Missing retained offcut')
    value(await service.projects.update(other.id, { ...other, stockItemIds: [retained.id] }))
    value(await service.parts(other.id).create({ ...validPartInput, id: 'retained-offcut-part', lengthMm: 20, widthMm: 20 }))
    expect(await service.projects.create(project)).toMatchObject({ ok: false })
    expect(await persistence.savedPlanContents.get(saved.summary.id)).toMatchObject({ ok: false })
  })
  it.each(['stock', 'catalog', 'mixed'] as const)('restores %s sources and removes only unused generated offcuts', async source => {
    const { persistence, service, project, stock } = await setup(source)
    expect(value(await service.deletionPreview(project.id)).restorationIssues).toEqual([])
    value(await service.deleteProject(project.id, 'restore'))
    expect(value(await persistence.stockItems.list())).toEqual([stock])
    const audit = value(await persistence.projectStock.find(project.id))
    expect(audit?.deletedProject?.stockHandling).toBe('restore')
    const movements = audit?.movements.length
    expect(await service.deleteProject(project.id, 'restore')).toMatchObject({ ok: false })
    expect(value(await persistence.projectStock.find(project.id))?.movements.length).toBe(movements)
  })
  it.each(['selected', 'consumed', 'modified', 'missing history'] as const)('blocks full restoration for %s offcuts but still permits keeping stock', async condition => {
    const { persistence, service, project, other, offcuts } = await setup()
    const offcut = value(await offcuts.preview()).rows[0]?.entry?.stock
    if (!offcut) throw new Error('No offcut')
    if (condition === 'selected') value(await service.projects.update(other.id, { ...other, stockItemIds: [offcut.id] }))
    if (condition === 'consumed') {
      value(await persistence.stockItems.delete(offcut.id))
      value(await persistence.projectStock.create({ id: other.id, entries: [], consumed: [{ stock: offcut, quantity: 1 }], movements: [{ id: 'other-movement', planId: 'other-plan', createdAt: new Date().toISOString(), consumed: [{ stock: offcut, quantity: 1 }], restored: [], added: [], removed: [] }] }))
    }
    if (condition === 'modified') value(await persistence.stockItems.update(offcut.id, { ...offcut, quantity: 2 }))
    if (condition === 'missing history') { const audit = value(await persistence.projectStock.find(project.id)); if (!audit) throw new Error('No ledger'); value(await persistence.projectStock.update(project.id, { ...audit, movements: [] })) }
    const inventory = value(await persistence.stockItems.list())
    expect(value(await service.deletionPreview(project.id)).restorationIssues.length).toBeGreaterThan(0)
    expect(await service.deleteProject(project.id, 'restore')).toMatchObject({ ok: false })
    expect(value(await persistence.stockItems.list())).toEqual(inventory)
    value(await service.deleteProject(project.id, 'keep'))
    expect(value(await persistence.stockItems.list())).toEqual(inventory)
    expect(value(await persistence.projects.get(other.id)).id).toBe(other.id)
  })
  it('blocks restoration of modified source stock and rolls back all deductions/restoration/deletions on failure', async () => {
    const { persistence, service, project, stock } = await setup()
    const current = value(await persistence.stockItems.get(stock.id))
    value(await persistence.stockItems.update(stock.id, { ...current, quantity: 5 }))
    expect(value(await service.deletionPreview(project.id)).restorationIssues.length).toBeGreaterThan(0)
    value(await persistence.stockItems.update(stock.id, current))
    const inventory = value(await persistence.stockItems.list())
    const ledger = value(await persistence.projectStock.find(project.id))
    const transaction = persistence.transaction.bind(persistence)
    vi.spyOn(persistence, 'transaction').mockImplementation(work => transaction(repositories => work({ ...repositories, projects: { ...repositories.projects, delete: () => Promise.resolve({ ok: false, error: { kind: 'storageFailure', message: 'Disk failure' } }) } })))
    expect(await service.deleteProject(project.id, 'restore')).toMatchObject({ ok: false })
    vi.restoreAllMocks()
    expect(value(await persistence.stockItems.list())).toEqual(inventory)
    expect(value(await persistence.projectStock.find(project.id))).toEqual(ledger)
    expect(value(await persistence.projects.get(project.id)).partIds).toHaveLength(1)
    expect(value(await persistence.savedPlanSummaries.listForProject(project.id))).toHaveLength(1)
  })
  it('restores legacy receipt deductions without removing immutable cutting history', async () => {
    const { persistence, service, other, stock } = await setup('catalog')
    const receipt = cuttingConfirmationSchema.parse({ id: 'legacy-result', projectId: other.id, confirmedAt: new Date().toISOString(), consumed: [{ stock, quantity: 1, panelIndices: [0] }], offcuts: [] })
    value(await persistence.cuttingConfirmations.create(receipt))
    value(await persistence.stockItems.update(stock.id, { ...stock, quantity: 1 }))
    expect(value(await service.deletionPreview(other.id)).restorationIssues).toEqual([])
    value(await service.deleteProject(other.id, 'restore'))
    expect(value(await persistence.stockItems.get(stock.id))).toEqual(stock)
    expect(value(await persistence.cuttingConfirmations.get(receipt.id))).toEqual(receipt)
    expect(value(await persistence.projectStock.find(other.id))?.movements.at(-1)?.restored).toEqual([{ stock, quantity: 1 }])
  })

  it('directly deletes projects with Parts and no stock activity', async () => {
    const { persistence, service, other, part } = await setup()
    value(await service.parts(other.id).create({ ...part, id: 'other-part' }))
    const inventory = value(await persistence.stockItems.list())
    value(await service.projects.delete(other.id))
    expect(value(await persistence.parts.list()).some(item => item.id === 'other-part')).toBe(false)
    expect(value(await persistence.stockItems.list())).toEqual(inventory)
  })
})
