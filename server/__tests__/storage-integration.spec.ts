// @vitest-environment node
/// <reference lib="dom" />
import { describe, expect, it } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { createSelfHostedServer } from '../http'
import { createLocalPersistence } from '../../src/infrastructure/persistence/local-database'
import { createHttpStorageServices } from '../../src/infrastructure/http/storage-services'
import { createStorageServices } from '../../src/application/storage/services'
import { projectJson } from '../../src/infrastructure/projects/project-json'
import { materialSchema } from '../../src/domain/model/material'
import { supplierSchema } from '../../src/domain/model/supplier'
import { supplierProductSchema } from '../../src/domain/model/supplier-product'
import { cuttingProjectSchema } from '../../src/domain/model/cutting-project'
import { builtInMaterialPresets } from '../../src/application/catalog/material-presets'
import { stockItemSchema } from '../../src/domain/model/stock-item'
import { pngCover } from '../../src/infrastructure/pdf/__tests__/cover-image-fixtures'
import { partSchema } from '../../src/domain/model/part'
import { panelSnapshotSchema } from '../../src/domain/model/saved-cutting-plan'
import { stockPanel } from '../../src/domain/optimizer/panel-source'
import { optimizeProject } from '../../src/domain/optimizer/optimize-project'
import { createCuttingPlanPdfService } from '../../src/application/export/cutting-plan-pdf-service'
import { generateCuttingPlanPdf, generateProjectCuttingPdf } from '../../src/infrastructure/pdf/cutting-plan-pdf'
import type { Persistence, PersistenceResult } from '../../src/application/persistence/repositories'

function value<T>(result: PersistenceResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error))
  return result.value
}

// Both clients execute the same public service interfaces against real storage.
async function openStorage(mode: 'browser' | 'server') {
  const directory = await mkdtemp(join(tmpdir(), 'ocl-integration-'))
  const frontendPath = join(directory, 'frontend')
  await mkdir(frontendPath)
  await writeFile(join(frontendPath, 'index.html'), '<title>Integration test</title>')
  const indexedDB = new IDBFactory()
  const browserConnections: Persistence[] = []
  let backend: ReturnType<typeof createSelfHostedServer> | undefined
  let port = 0
  async function startBackend() {
    const app = createSelfHostedServer({ databasePath: join(directory, 'database.sqlite'), frontendPath })
    await new Promise<void>((resolve, reject) => {
      app.server.once('error', reject)
      app.server.listen(0, '127.0.0.1', resolve)
    })
    const address = app.server.address()
    if (!address || typeof address === 'string') throw new Error('Missing listener')
    port = address.port
    backend = app
  }
  if (mode === 'server') await startBackend()
  function newClient() {
    if (mode === 'server') return createHttpStorageServices(`http://127.0.0.1:${String(port)}/api/v1/`)
    const persistence = createLocalPersistence('integration', { indexedDB, IDBKeyRange })
    browserConnections.push(persistence)
    return createStorageServices(persistence, projectJson)
  }
  return {
    newClient,
    async restart() {
      for (const connection of browserConnections.splice(0)) connection.close()
      if (backend) {
        await backend.close()
        await startBackend()
      }
    },
    async close() {
      for (const connection of browserConnections) connection.close()
      if (backend) await backend.close()
      await rm(directory, { recursive: true, force: true })
    },
  }
}

const material = materialSchema.parse({ id: 'material', name: 'MDF', category: 'Panels' })
const supplier = supplierSchema.parse({ id: 'supplier', name: 'Supplier' })
const product = supplierProductSchema.parse({
  id: 'product', supplierId: supplier.id, materialId: material.id, name: 'Panel',
  lengthMm: 800, widthMm: 600, thicknessMm: 15, grainDirection: 'none',
  availability: 'available', currency: 'EUR', price: 12,
})
const project = cuttingProjectSchema.parse({
  id: 'project', name: 'Workshop', partIds: [], materialIds: [material.id], supplierProductIds: [product.id],
  cuttingSettings: { kerfMm: 3, edgeMarginMm: 5, preferStockPanels: false },
  pdfSettings: { orientation: 'landscape', titleOverride: 'PDF only', description: 'First line\nSecond line', coverImage: pngCover },
})
const part = partSchema.parse({
  id: 'part', name: 'A', materialId: material.id, lengthMm: 200, widthMm: 400, thicknessMm: 15,
  quantity: 2, grainDirection: 'none', rotation: 'allowed',
})

for (const mode of ['browser', 'server'] as const) {
  describe(`${mode} service workflow compatibility`, () => {
    it('reloads selections/settings and preserves all JSON transfers across clients and restart', async () => {
      const storage = await openStorage(mode)
      try {
        const first = storage.newClient()
        value(await first.catalog.materials.create(material))
        value(await first.catalog.suppliers.create(supplier))
        value(await first.catalog.supplierProducts.create(product))
        const empty = cuttingProjectSchema.parse({ ...project, materialIds: [], supplierProductIds: [], pdfSettings: { orientation: 'portrait' } })
        value(await first.projects.projects.create(empty))
        expect((await first.projects.parts(project.id).create(part)).ok).toBe(false)
        value(await first.projects.projects.update(project.id, { ...empty, materialIds: [material.id], supplierProductIds: [product.id], pdfSettings: project.pdfSettings }))
        value(await first.projects.parts(project.id).create(part))
        expect((await first.projects.parts(project.id).createMany([{ ...part, id: 'new-part' }, { ...part, id: 'invalid-part', widthMm: 0 }])).ok).toBe(false)
        const second = storage.newClient()
        const read = value(await second.projects.projects.get(project.id))
        expect(read.name).toBe('Workshop')
        expect(read.partIds).toEqual([part.id])
        expect(read.materialIds).toEqual([material.id])
        expect(read.supplierProductIds).toEqual([product.id])
        expect(read.cuttingSettings?.preferStockPanels).toBe(false)
        expect(read.pdfSettings).toEqual(project.pdfSettings)
        expect(value(await second.projects.parts(project.id).list())).toEqual([part])
        expect((await second.projects.parts(project.id).update(part.id, { ...part, thicknessMm: 0 })).ok).toBe(false)
        expect(value(await first.projects.parts(project.id).get(part.id))).toEqual(part)

        const catalog = value(await second.catalogTransfer.preview(value(await first.catalogTransfer.export())))
        expect(catalog.conflicts).toBe(0)
        expect(catalog.reused).toBe(3)
        expect((await second.catalogTransfer.import(catalog.file, false)).ok).toBe(false)
        value(await second.catalogTransfer.import(catalog.file, true))
        expect(value(await first.catalog.supplierProducts.list())).toEqual([product])
        const panels = value(await first.stock.addFromProduct(product, 2))
        const stock = value(await second.stockTransfer.preview(value(await first.stockTransfer.export())))
        expect(stock.reused).toBe(2)
        value(await second.stockTransfer.import(stock.file, true))
        expect(value(await first.stock.list())).toHaveLength(2)
        expect(new Set(panels.map(panel => panel.id)).size).toBe(2)

        const alternate = value(await first.catalog.supplierProducts.create({ ...product, id: 'alternate' }))
        const order = value(await first.catalog.supplierProducts.move(alternate.id, product.id, 'before'))
        expect(order.productIds[0]).toBe(alternate.id)
        expect(value(await second.catalog.supplierProducts.ordering())).toEqual([order])
        value(await first.catalog.supplierProducts.update(alternate.id, { ...alternate, price: 20 }))
        expect(value(await second.catalog.supplierProducts.get(alternate.id)).price).toBe(20)
        value(await first.catalog.supplierProducts.delete(alternate.id))
        const manual = stockItemSchema.parse({
          id: 'manual', kind: 'fullPanel', materialId: material.id, lengthMm: 500, widthMm: 300,
          thicknessMm: 15, grainDirection: 'none', quantity: 1, provenance: { source: 'manual' },
        })
        value(await first.stock.create(manual))
        const changed = value(await second.stock.update(manual.id, { ...manual, quantity: 2 }, manual))
        const purchased = panels[0]
        if (!purchased) throw new Error('Expected physical panel')
        const stockOrder = value(await second.stock.move(manual.id, purchased.id, 'before'))
        expect(stockOrder.stockItemIds.indexOf(manual.id)).toBeLessThan(stockOrder.stockItemIds.indexOf(purchased.id))
        expect(value(await first.stock.ordering())).toEqual([stockOrder])
        value(await first.stock.delete(manual.id, changed))
        const preset = builtInMaterialPresets[0]
        if (!preset) throw new Error('Missing material preset')
        const presetProduct = value(await first.catalog.supplierProducts.saveWithPreset({ ...product, id: 'preset-product' }, preset.id))
        const presetStock = value(await second.stock.saveWithPreset({ ...manual, id: 'preset-stock' }, preset.id))
        expect(presetProduct.materialId).toBe(presetStock.materialId)
        value(await first.stock.delete(presetStock.id, presetStock))
        value(await first.catalog.supplierProducts.delete(presetProduct.id))
        value(await first.catalog.materials.delete(presetProduct.materialId))
        expect(value(await first.projects.listLegacyParts())).toEqual([])

        const partsFile = { format: 'opticutlist-parts', version: 1, parts: [{
          name: 'Imported', material: material.name, length: 100, width: 100, thickness: 15,
          quantity: 1, grainDirection: 'none', rotation: 'allowed',
        }] }
        const partsPreview = value(await first.partsTransfer.preview(project.id, JSON.stringify(partsFile)))
        expect(partsPreview.materialIds).toEqual([material.id])
        expect(value(await second.partsTransfer.import(project.id, partsPreview.file, partsPreview.materialIds, true))).toBe(1)
        expect(value(await first.projects.parts(project.id).list())).toHaveLength(2)
        const exported = value(await first.projectTransfer.export(project.id))
        const preview = value(await second.projectTransfer.preview(exported.text))
        expect(preview.projectIdCollision).toBe(true)
        const imported = value(await second.projectTransfer.import(preview.file, true))
        expect(imported.id).not.toBe(project.id)
        expect(value(await first.projects.parts(imported.id).list())).toHaveLength(2)
        value(await first.projects.deleteProject(imported.id, 'keep'))
        expect(value(await second.projects.parts(project.id).list())).toHaveLength(2)

        await storage.restart()
        const fresh = storage.newClient()
        expect(value(await fresh.projects.projects.get(project.id)).pdfSettings).toEqual(project.pdfSettings)
        expect(value(await fresh.projects.parts(project.id).list())).toHaveLength(2)
        expect(value(await fresh.stock.list()).map(panel => panel.id).sort()).toEqual(panels.map(panel => panel.id).sort())
      } finally {
        await storage.close()
      }
    })

    it('reloads validated plans, generates a PDF, reconciles offcuts and restores exact stock identities', async () => {
      const storage = await openStorage(mode)
      try {
        const first = storage.newClient()
        value(await first.catalog.materials.create(material))
        value(await first.catalog.suppliers.create(supplier))
        value(await first.catalog.supplierProducts.create(product))
        const panels = value(await first.stock.addFromProduct(product, 2))
        const physical = panels[0]
        if (!physical) throw new Error('Missing purchased panel')
        value(await first.projects.projects.create({ ...project, stockItemIds: [physical.id] }))
        value(await first.projects.parts(project.id).create(part))
        const source = stockPanel(physical)
        const settings = { kerfMm: 3, edgeMarginMm: 5 }
        const result = optimizeProject({ parts: [part], panels: [{ product: source, quantity: 1 }], settings })
        if (!result.ok) throw new Error('Invalid optimization fixture')
        const input = {
          parts: [part], settings, plan: result.plan, editedPanelIndices: [],
          sources: [{ product: panelSnapshotSchema.parse({
            id: source.id, stockItemId: physical.id, name: source.name, materialId: physical.materialId,
            lengthMm: physical.lengthMm, widthMm: physical.widthMm, thicknessMm: physical.thicknessMm,
            grainDirection: physical.grainDirection,
          }), quantity: 1, materialName: material.name, supplierName: 'Stock' }],
        }
        const saved = value(await first.currentResults.forProject(project.id).replace(input))
        const second = storage.newClient()
        const reloaded = value(await second.currentResults.forProject(project.id).load()).result
        expect(reloaded?.plan).toEqual(saved.plan)
        expect(value(await second.confirmations.forProject(project.id).list())).toEqual([])
        expect(value(await second.confirmations.forProject(project.id).preview(saved.summary.id)).saved.plan).toEqual(saved.plan)
        const duplicateConsumption = await second.confirmations.forProject(project.id).confirm(saved.summary.id, {
          confirmed: true, assignments: [{ panelIndex: 0, stockItemId: physical.id }], offcuts: [],
        })
        expect(duplicateConsumption.ok).toBe(false)
        if (duplicateConsumption.ok) throw new Error('Legacy confirmation must not consume automatic stock again')
        expect(duplicateConsumption.error.kind).toBe('referenceConflict')
        expect((await second.stock.get(physical.id)).ok).toBe(false)
        expect(value(await second.stock.selectionStock(project.id)).some(panel => panel.id === physical.id)).toBe(true)
        const stockPreview = value(await second.projectStock.forProject(project.id).preview())
        const offcut = stockPreview.rows[0]
        if (!offcut) throw new Error('Expected waste')
        value(await first.projectStock.forProject(project.id).setKeep(offcut.key, true))
        value(await second.projectStock.forProject(project.id).setKeep(offcut.key, true))
        const kept = value(await second.stock.list()).find(panel => panel.provenance.source === 'cutting')
        if (!kept) throw new Error('Expected physical offcut')
        expect(value(await first.stock.planningStock(project.id)).some(panel => panel.id === kept.id)).toBe(false)
        const other = cuttingProjectSchema.parse({ ...project, id: 'other', partIds: [], stockItemIds: [] })
        value(await second.projects.projects.create(other))
        const availableElsewhere = value(await second.stock.selectionStock(other.id))
        expect(availableElsewhere.some(panel => panel.id === physical.id)).toBe(false)
        expect(availableElsewhere.some(panel => panel.id === kept.id)).toBe(true)

        const pdfService = createCuttingPlanPdfService({ generate: generateCuttingPlanPdf, generateProject: generateProjectCuttingPdf }, {
          supplierProducts: second.catalog.supplierProducts, stockItems: second.stock,
        })
        const pdf = await pdfService.exportProject({ ...input, title: project.name, orientation: 'landscape', cover: { title: 'PDF only', description: 'First line\nSecond line', image: pngCover } })
        expect(pdf.ok).toBe(true)
        if (!pdf.ok) throw new Error(pdf.error.message)
        const document = await PDFDocument.load(pdf.bytes)
        expect(document.getPageCount()).toBeGreaterThanOrEqual(4)
        expect(document.getPages().every(page => page.getWidth() > page.getHeight())).toBe(true)

        await storage.restart()
        const fresh = storage.newClient()
        expect(value(await fresh.currentResults.forProject(project.id).load()).result?.plan).toEqual(saved.plan)
        const after = value(await fresh.projectStock.forProject(project.id).preview())
        expect(after.rows.find(row => row.key === offcut.key)?.keep).toBe(true)
        expect(value(await fresh.stock.get(kept.id))).toEqual(kept)
        value(await fresh.currentResults.forProject(project.id).replace(input))
        expect(value(await fresh.projectStock.forProject(project.id).preview()).movements).toEqual(after.movements)
        value(await fresh.projects.deleteProject(project.id, 'restore'))
        expect(value(await fresh.stock.get(physical.id))).toEqual(physical)
        expect((await fresh.stock.get(kept.id)).ok).toBe(false)
        expect((await fresh.projects.projects.get(project.id)).ok).toBe(false)
        expect((await fresh.projects.projects.create(project)).ok).toBe(false)
      } finally {
        await storage.close()
      }
    })
  })
}
