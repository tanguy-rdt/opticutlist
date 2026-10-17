// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request as httpRequest } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { createSelfHostedServer } from '../http'
import { createSqlitePersistence } from '../sqlite'
import { materialSchema } from '../../src/domain/model/material'
import { supplierSchema } from '../../src/domain/model/supplier'
import { supplierProductSchema } from '../../src/domain/model/supplier-product'
import { stockItemSchema } from '../../src/domain/model/stock-item'
import { cuttingProjectSchema } from '../../src/domain/model/cutting-project'
import { partSchema } from '../../src/domain/model/part'
import { stockPanel } from '../../src/domain/optimizer/panel-source'
import { optimizeProject } from '../../src/domain/optimizer/optimize-project'
import { prepareSavedPlan } from '../../src/application/plans/saved-plan-service'
import { panelSnapshotSchema } from '../../src/domain/model/saved-cutting-plan'
import { savedCuttingPlanIdSchema } from '../../src/domain/model/ids'
import { responseEnvelope } from '../../src/application/storage/api-contract'
import { createHttpStorageServices } from '../../src/infrastructure/http/storage-services'
import type { Repositories } from '../../src/application/persistence/repositories'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})
function directory() {
  const value = mkdtempSync(join(tmpdir(), 'opticutlist-server-'))
  directories.push(value)
  return value
}
const material = materialSchema.parse({ id: 'm', name: 'MDF', category: 'Panels' })
const supplier = supplierSchema.parse({ id: 's', name: 'Supplier' })
const product = supplierProductSchema.parse({
  id: 'p',
  supplierId: supplier.id,
  materialId: material.id,
  name: 'Panel',
  lengthMm: 800,
  widthMm: 600,
  thicknessMm: 15,
  grainDirection: 'none',
  currency: 'EUR',
  availability: 'available',
  price: 12
})
const stock = stockItemSchema.parse({
  id: 'physical',
  kind: 'fullPanel',
  materialId: material.id,
  lengthMm: 800,
  widthMm: 600,
  thicknessMm: 15,
  quantity: 1,
  grainDirection: 'none',
  provenance: { source: 'manual' }
})

async function start(databasePath = join(directory(), 'database.sqlite')) {
  const frontendPath = directory()
  writeFileSync(join(frontendPath, 'index.html'), '<title>Self-hosted test</title>')
  const app = createSelfHostedServer({ databasePath, frontendPath })
  await new Promise<void>((resolve, reject) => {
    app.server.once('error', reject)
    app.server.listen(0, '127.0.0.1', resolve)
  })
  const address = app.server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Missing test listener')
  }
  const base = `http://127.0.0.1:${String(address.port)}`
  async function request(path: string, args: unknown[] = [], method = 'POST', key = crypto.randomUUID(), extraHeaders: Record<string, string> = {}) {
    return fetch(`${base}/api/v1/${path}${method === 'GET' ? `?args=${encodeURIComponent(JSON.stringify(args))}` : ''}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-OptiCutList': '1',
        'Idempotency-Key': key,
        ...extraHeaders
      },
      ...(method === 'GET' ? {} : { body: JSON.stringify(args) }),
    })
  }
  async function seed() {
    expect((await app.services.catalog.materials.create(material)).ok).toBe(true)
    expect((await app.services.catalog.suppliers.create(supplier)).ok).toBe(true)
    expect((await app.services.catalog.supplierProducts.create(product)).ok).toBe(true)
  }
  return { ...app, base, request, seed, databasePath }
}

describe('SQLite persistence and migrations', () => {
  it('keeps data across connection restart and records a single migration', async () => {
    const filename = join(directory(), 'database.sqlite')
    const first = createSqlitePersistence(filename)
    expect((await first.persistence.materials.create(material)).ok).toBe(true)
    first.persistence.close()
    const second = createSqlitePersistence(filename)
    expect(await second.persistence.materials.get(material.id)).toEqual({ ok: true, value: material })
    second.persistence.close()
    const inspect = new DatabaseSync(filename)
    expect(inspect.prepare('PRAGMA user_version').get()?.user_version).toBe(1)
    expect(inspect.prepare('SELECT version FROM schema_migrations').all()).toHaveLength(1)
    expect(inspect.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok')
    inspect.close()
  })
  it('rolls back ignored failures, enforces foreign keys, and expires scoped repositories', async () => {
    const db = createSqlitePersistence(join(directory(), 'db.sqlite'))
    let leaked: Repositories | undefined
    try {
      const result = await db.persistence.transaction(async repositories => {
        leaked = repositories
        await repositories.materials.create(material)
        await repositories.materials.get(materialSchema.shape.id.parse('missing'))
        return { ok: true, value: undefined }
      })
      expect(result.ok).toBe(false)
      expect((await db.persistence.materials.list())).toEqual({ ok: true, value: [] })
      expect((await leaked?.materials.create(material))?.ok).toBe(false)
      expect((await db.persistence.stockItems.create(stock)).ok).toBe(false)
      expect(await db.persistence.stockItems.list()).toEqual({ ok: true, value: [] })
    } finally {
      db.persistence.close()
    }
  })
  it('persists successful request receipts and rolls back a failed command with its writes', async () => {
    const filename = join(directory(), 'requests.sqlite')
    const first = createSqlitePersistence(filename)
    expect((await first.command('retry', 'same-payload', () => first.persistence.materials.create(material))).ok).toBe(true)
    first.persistence.close()
    const second = createSqlitePersistence(filename)
    try {
      const replayed = await second.command('retry', 'same-payload', () => {
        throw new Error('A committed request must not run again')
      })
      expect(replayed).toEqual({ ok: true, value: material })
      const failed = await second.command('failed', 'payload', async () => {
        await second.persistence.materials.create({ ...material, id: 'rolled-back' })
        return { ok: false, error: { kind: 'referenceConflict', message: 'Rejected operation' } }
      })
      expect(failed.ok).toBe(false)
      expect(await second.persistence.materials.list()).toEqual({ ok: true, value: [material] })
    } finally {
      second.persistence.close()
    }
    const inspect = new DatabaseSync(filename)
    expect(inspect.prepare('SELECT id FROM request_receipts').all()).toEqual([{ id: 'retry' }])
    inspect.close()
  })
  it('keeps the database outside frontend assets even through a symlink', () => {
    const frontend = directory()
    const alias = join(directory(), 'data-link')
    symlinkSync(frontend, alias, 'dir')
    expect(() => createSelfHostedServer({ databasePath: join(alias, 'private.json'), frontendPath: frontend })).toThrow('outside frontend')
  })
  it('preserves unknown newer and unrelated databases instead of resetting them', () => {
    const filename = join(directory(), 'newer.sqlite')
    const db = new DatabaseSync(filename)
    db.exec('CREATE TABLE private_data (value TEXT); INSERT INTO private_data VALUES (\'keep\'); PRAGMA user_version=99')
    db.close()
    expect(() => createSqlitePersistence(filename)).toThrow('newer')
    const check = new DatabaseSync(filename)
    expect(check.prepare('SELECT value FROM private_data').get()?.value).toBe('keep')
    check.exec('PRAGMA user_version=0')
    check.close()
    expect(() => createSqlitePersistence(filename)).toThrow('unrelated')
    expect(() => createSqlitePersistence(':memory:')).toThrow('persistent')
  })
})

describe('versioned service API', () => {
  it('validates requests, methods, origins, hosts, body sizes and asset paths', async () => {
    const app = await start()
    try {
      expect((await fetch(`${app.base}/api/v1/health`)).status).toBe(200)
      expect((await fetch(`${app.base}/opticutlist/`)).status).toBe(200)
      expect((await app.request('catalog/materials/create', [{}])).status).toBe(400)
      expect((await app.request('catalog/materials/list', [], 'POST')).status).toBe(405)
      expect((await app.request('sql/execute', ['DROP TABLE materials'])).status).toBe(404)
      expect((await app.request('catalog/materials/create', [material], 'POST', crypto.randomUUID(), { Origin: 'https://untrusted.invalid' })).status).toBe(403)
      expect((await app.request('catalog/materials/create', [material], 'POST', crypto.randomUUID(), { 'X-OptiCutList': '' })).status).toBe(403)
      const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
        const request = httpRequest(`${app.base}/api/v1/health`, { headers: { Host: 'untrusted.invalid' } }, response => {
          response.resume()
          resolve(response.statusCode)
        })
        request.on('error', reject)
        request.end()
      })
      expect(wrongHost).toBe(403)
      expect((await app.request('catalog/materials/create', ['x'.repeat(16 * 1024 * 1024)])).status).toBe(413)
      expect((await fetch(`${app.base}/opticutlist/%2e%2e%2fprivate.sqlite`)).status).toBe(404)
      expect((await fetch(`${app.base}/api/v1/health`)).headers.get('access-control-allow-origin')).toBeNull()
      expect(await app.services.catalog.materials.list()).toEqual({ ok: true, value: [] })
    } finally {
      await app.close()
    }
  })
  it('deduplicates stock purchases transactionally and rejects reused keys with changed arguments', async () => {
    const app = await start()
    try {
      await app.seed()
      const key = crypto.randomUUID()
      const replies = await Promise.all([app.request('stock/addFromProduct', [product, 5], 'POST', key), app.request('stock/addFromProduct', [product, 5], 'POST', key)])
      expect(replies.map(response => response.status)).toEqual([200, 200])
      expect(await replies[0].json()).toEqual(await replies[1].json())
      const items = await app.services.stock.list()
      if (!items.ok) {
        throw new Error('Stock read failed')
      }
      expect(items.value).toHaveLength(5)
      expect(new Set(items.value.map(item => item.id)).size).toBe(5)
      expect(items.value.every(item => item.quantity === 1 && item.provenance.source === 'purchase' && item.provenance.supplierProductId === product.id)).toBe(true)
      expect((await app.request('stock/addFromProduct', [product, 6], 'POST', key)).status).toBe(409)
      expect(await app.services.catalog.supplierProducts.get(product.id)).toEqual({ ok: true, value: product })
    } finally {
      await app.close()
    }
  })
  it('rejects stale concurrent stock changes and rolls back complete invalid imports', async () => {
    const app = await start()
    try {
      await app.seed()
      const previous = { ...stock, quantity: 2 }
      expect((await app.services.stock.create(previous)).ok).toBe(true)
      const responses = await Promise.all([app.request('stock/update', [stock.id, stock, previous], 'PUT'), app.request('stock/update', [stock.id, stock, previous], 'PUT')])
      expect(responses.map(response => response.status).sort()).toEqual([200, 409])
      expect(await app.services.stock.get(stock.id)).toEqual({ ok: true, value: stock })
      const before = await app.services.catalog.materials.list()
      expect((await app.request('catalogTransfer/import', [{
        format: 'opticutlist-catalog',
        schemaVersion: 1,
        catalog: { materials: [{ ...material, id: 'new' }], suppliers: [], products: [product] }
      }, true])).status).toBe(400)
      expect(await app.services.catalog.materials.list()).toEqual(before)
    } finally {
      await app.close()
    }
  })
  it('uses the real HTTP adapter and preserves project/Parts/catalog JSON workflows across restart', async () => {
    let app = await start()
    const filename = app.databasePath
    try {
      const remote = createHttpStorageServices(`${app.base}/api/v1/`)
      await app.seed()
      const project = cuttingProjectSchema.parse({
        id: 'project',
        name: 'Shared project',
        partIds: [],
        materialIds: [material.id],
        supplierProductIds: [product.id],
        pdfSettings: { orientation: 'landscape' },
        cuttingSettings: { kerfMm: 3, edgeMarginMm: 5, preferStockPanels: false }
      })
      expect((await remote.projects.projects.create(project)).ok).toBe(true)
      const part = partSchema.parse({
        id: 'part',
        name: 'A',
        materialId: material.id,
        lengthMm: 200,
        widthMm: 400,
        thicknessMm: 15,
        quantity: 2,
        grainDirection: 'none',
        rotation: 'allowed'
      })
      expect((await remote.projects.parts(project.id).create(part)).ok).toBe(true)
      expect((await remote.projects.parts(project.id).list())).toEqual({ ok: true, value: [part] })
      const exported = await remote.projectTransfer.export(project.id)
      if (!exported.ok) {
        throw new Error('Export failed')
      }
      const preview = await remote.projectTransfer.preview(exported.value.text)
      expect(preview.ok).toBe(true)
      expect((await remote.projectTransfer.import(JSON.parse(exported.value.text), true)).ok).toBe(true)
      await app.close()
      app = await start(filename)
      const records = await app.services.projects.projects.list()
      if (!records.ok) {
        throw new Error('Read failed')
      }
      expect(records.value).toHaveLength(2)
      expect(records.value.every(record => record.pdfSettings?.orientation === 'landscape' && record.cuttingSettings?.preferStockPanels === false)).toBe(true)
      await app.close()
      const unavailable = await remote.stock.list()
      expect(unavailable.ok).toBe(false)
      app = await start(filename)
    } finally {
      await app.close()
    }
  })
  it('does not allocate one physical panel to two concurrent project results', async () => {
    const app = await start()
    try {
      await app.seed()
      expect((await app.services.stock.create(stock)).ok).toBe(true)
      const source = stockPanel(stock)
      const settings = { kerfMm: 3, edgeMarginMm: 5 }
      const submissions: Promise<Response>[] = []
      const projectIds = []
      for (const id of ['first', 'second']) {
        const project = cuttingProjectSchema.parse({ id, name: id, partIds: [], materialIds: [material.id], supplierProductIds: [], stockItemIds: [stock.id] })
        const part = partSchema.parse({ id: `${id}-part`, name: 'A', materialId: material.id, lengthMm: 200, widthMm: 400, thicknessMm: 15, quantity: 2, grainDirection: 'none', rotation: 'allowed' })
        expect((await app.services.projects.projects.create(project)).ok).toBe(true)
        expect((await app.services.projects.parts(project.id).create(part)).ok).toBe(true)
        projectIds.push(project.id)
      }
      for (const projectId of projectIds) {
        const parts = await app.services.projects.parts(projectId).list()
        if (!parts.ok) throw new Error('Part read failed')
        const result = optimizeProject({ parts: parts.value, panels: [{ product: source, quantity: 1 }], settings })
        if (!result.ok) throw new Error('Fixture cannot be optimized')
        const prepared = prepareSavedPlan({ id: savedCuttingPlanIdSchema.parse(`transport-${projectId}`), projectId, name: 'Transport', createdAt: new Date().toISOString() }, {
          parts: [...parts.value],
          settings,
          sources: [{ product: panelSnapshotSchema.parse({
            id: source.id, stockItemId: stock.id, name: source.name, materialId: stock.materialId,
            lengthMm: stock.lengthMm, widthMm: stock.widthMm, thicknessMm: stock.thicknessMm,
            grainDirection: stock.grainDirection,
          }), quantity: 1, materialName: 'MDF', supplierName: 'Stock' }],
          plan: result.plan,
          editedPanelIndices: [],
        })
        if (!prepared.ok) throw new Error('Invalid fixture')
        submissions.push(app.request('current/replace', [projectId, prepared.value.contents, []], 'PUT'))
      }
      expect((await Promise.all(submissions)).map(response => response.status)).toEqual([200, 200])
      const previews = await Promise.all(projectIds.map(id => app.services.projectStock.forProject(id).preview()))
      const states = previews.map(preview => {
        if (!preview.ok) throw new Error('Preview failed')
        return preview.value
      })
      expect(states.filter(state => state.conflict === null)).toHaveLength(1)
      expect(states.filter(state => state.conflict !== null)).toHaveLength(1)
      expect(states.flatMap(state => state.movements)).toHaveLength(1)
      expect(await app.services.stock.list()).toEqual({ ok: true, value: [] })
    } finally {
      await app.close()
    }
  })
  it('reconciles browser-computed plans idempotently and isolates consumed physical stock', async () => {
    const app = await start()
    try {
      await app.seed()
      expect((await app.services.stock.create(stock)).ok).toBe(true)
      const project = cuttingProjectSchema.parse({
        id: 'cut-project',
        name: 'Cut project',
        partIds: [],
        materialIds: [material.id],
        supplierProductIds: [],
        stockItemIds: [stock.id]
      })
      expect((await app.services.projects.projects.create(project)).ok).toBe(true)
      const part = partSchema.parse({
        id: 'cut-part',
        name: 'A',
        materialId: material.id,
        lengthMm: 200,
        widthMm: 400,
        thicknessMm: 15,
        quantity: 2,
        grainDirection: 'none',
        rotation: 'allowed'
      })
      expect((await app.services.projects.parts(project.id).create(part)).ok).toBe(true)
      const source = stockPanel(stock)
      // This is the browser-side computation; no optimize endpoint exists on the server.
      const selection = optimizeProject({
        parts: [part],
        panels: [{ product: source, quantity: 1 }],
        settings: { kerfMm: 3, edgeMarginMm: 5 }
      })
      if (!selection.ok) {
        throw new Error('Fixture cannot be optimized')
      }
      const input = {
        parts: [part],
        sources: [{
          product: panelSnapshotSchema.parse({
            id: source.id,
            stockItemId: stock.id,
            name: source.name,
            materialId: stock.materialId,
            lengthMm: 800,
            widthMm: 600,
            thicknessMm: 15,
            grainDirection: 'none'
          }),
          quantity: 1,
          materialName: 'MDF',
          supplierName: 'Stock'
        }],
        settings: { kerfMm: 3, edgeMarginMm: 5 },
        plan: selection.plan,
        editedPanelIndices: []
      }
      const prepared = prepareSavedPlan({
        id: savedCuttingPlanIdSchema.parse('transport'),
        projectId: project.id,
        name: 'Transport',
        createdAt: new Date().toISOString()
      }, input)
      if (!prepared.ok) {
        throw new Error('Invalid fixture')
      }
      const invalid = structuredClone(prepared.value.contents)
      const invalidPanel = invalid.panels[0]
      if (!invalidPanel) throw new Error('Expected allocated panel')
      invalidPanel.tree = { kind: 'waste' }
      expect((await app.request('current/replace', [project.id, invalid, []], 'PUT')).status).toBe(400)
      expect(await app.services.stock.get(stock.id)).toEqual({ ok: true, value: stock })
      for (let repeat = 0; repeat < 2; repeat++) {
        const response = await app.request('current/replace', [project.id, prepared.value.contents, []], 'PUT')
        expect(response.status).toBe(200)
        const raw: unknown = await response.json()
        expect(responseEnvelope.parse(raw).ok).toBe(true)
      }
      expect((await app.services.stock.get(stock.id)).ok).toBe(false)
      const ledger = new DatabaseSync(app.databasePath)
      const rows = ledger.prepare('SELECT record FROM projectStock WHERE id = ?').get(project.id)
      expect(rows?.record).toBeTypeOf('string')
      const physical = await app.services.stock.planningStock(project.id)
      expect(physical).toEqual({ ok: true, value: [stock] })
      ledger.close()
      const preview = await app.services.projectStock.forProject(project.id).preview()
      if (!preview.ok) {
        throw new Error('Preview failed')
      }
      expect(preview.value.movements).toHaveLength(1)
      const offcut = preview.value.rows[0]
      if (!offcut) {
        throw new Error('Expected reusable waste')
      }
      expect((await app.request('projectStock/setKeep', [project.id, offcut.key, true])).status).toBe(200)
      expect((await app.request('projectStock/setKeep', [project.id, offcut.key, true])).status).toBe(200)
      const added = await app.services.stock.list()
      if (!added.ok) {
        throw new Error('Stock read failed')
      }
      expect(added.value).toHaveLength(1)
      expect(added.value[0]?.provenance.source).toBe('cutting')
      const other = { ...project, id: 'other-project', name: 'Other' }
      expect((await app.services.projects.projects.create(other)).ok).toBe(false)
      expect((await app.request('optimization/run', [])).status).toBe(404)
      const remote = createHttpStorageServices(`${app.base}/api/v1/`)
      expect((await remote.currentResults.forProject(project.id).load()).ok).toBe(true)
      expect((await remote.projectStock.forProject(project.id).preview()).ok).toBe(true)
      expect((await remote.projectStock.forProject(project.id).setKeep(offcut.key, false)).ok).toBe(true)
      expect((await remote.projects.deleteProject(project.id, 'restore')).ok).toBe(true)
      expect(await remote.stock.get(stock.id)).toEqual({ ok: true, value: stock })
      expect((await remote.projects.projects.get(project.id)).ok).toBe(false)
    } finally {
      await app.close()
    }
  })
})
