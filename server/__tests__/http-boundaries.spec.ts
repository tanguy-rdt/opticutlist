// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { createSelfHostedServer } from '../http'
import { createHttpStorageServices } from '../../src/infrastructure/http/storage-services'
import { materialSchema } from '../../src/domain/model/material'
import { supplierSchema } from '../../src/domain/model/supplier'
import { supplierProductSchema } from '../../src/domain/model/supplier-product'

async function start() {
  const directory = await mkdtemp(join(tmpdir(), 'ocl-http-'))
  const frontendPath = join(directory, 'frontend')
  await mkdir(frontendPath)
  await writeFile(join(frontendPath, 'index.html'), '<title>API boundary test</title>')
  const databasePath = join(directory, 'data.sqlite')
  const app = createSelfHostedServer({ databasePath, frontendPath })
  await new Promise<void>((resolve, reject) => {
    app.server.once('error', reject)
    app.server.listen(0, '127.0.0.1', resolve)
  })
  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('Missing listener')
  const base = `http://127.0.0.1:${String(address.port)}/api/v1/`
  return {
    databasePath, base, services: createHttpStorageServices(base),
    async close() {
      await app.close()
      await rm(directory, { recursive: true, force: true })
    },
  }
}
const headers = { 'Content-Type': 'application/json', 'X-OptiCutList': '1', 'Idempotency-Key': 'boundary-test' }

describe('HTTP and SQLite failure boundaries', () => {
  it('returns a clear size error for oversized chunked requests without writing data', async () => {
    const app = await start()
    try {
      const response = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
        const pending = request(`${app.base}catalog/materials/create`, { method: 'POST', headers }, response => {
          const chunks: Buffer[] = []
          response.on('data', (chunk: Buffer) => { chunks.push(chunk) })
          response.on('end', () => { resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }) })
        })
        pending.on('error', reject)
        pending.write(Buffer.alloc(16 * 1024 * 1024, ' '))
        pending.end('[]')
      })
      expect(response.status).toBe(413)
      expect(response.body).toContain('Request exceeds 16 MiB')
      expect(await app.services.catalog.materials.list()).toEqual({ ok: true, value: [] })
    } finally {
      await app.close()
    }
  })

  it('rejects malformed JSON, invalid references and unsupported requests without changing data', async () => {
    const app = await start()
    try {
      const material = materialSchema.parse({ id: 'm', name: 'MDF', category: 'Panels' })
      expect((await app.services.catalog.materials.create(material)).ok).toBe(true)
      const malformed = await fetch(`${app.base}catalog/materials/create`, { method: 'POST', headers, body: '{' })
      expect(malformed.status).toBe(400)
      expect(await malformed.text()).toContain('Invalid JSON request')
      expect((await fetch(`${app.base}catalog/materials/create`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body: '[]',
      })).status).toBe(415)
      expect((await fetch(`${app.base}catalog/materials/create`, {
        method: 'POST', headers: { ...headers, 'Idempotency-Key': '' }, body: '[]',
      })).status).toBe(400)
      const options = await fetch(`${app.base}catalog/materials/create`, { method: 'OPTIONS', headers: { Origin: 'https://untrusted.invalid' } })
      expect(options.status).toBe(403)
      expect(options.headers.get('access-control-allow-origin')).toBeNull()
      const injection = materialSchema.shape.id.parse("missing'/**/OR/**/1=1--")
      const missing = await app.services.catalog.materials.get(injection)
      expect(missing).toEqual({ ok: false, error: { kind: 'notFound', id: injection } })
      const invalid = await app.services.catalog.supplierProducts.create({
        id: 'invalid', supplierId: 'missing', materialId: material.id, name: 'Panel',
        lengthMm: 800, widthMm: 600, thicknessMm: 15, grainDirection: 'none', currency: 'EUR', availability: 'available',
      })
      expect(invalid.ok).toBe(false)
      expect(await app.services.catalog.materials.list()).toEqual({ ok: true, value: [material] })
      expect(await app.services.catalog.supplierProducts.list()).toEqual({ ok: true, value: [] })
    } finally {
      await app.close()
    }
  })

  it('rolls back a purchase and its request receipt after a real mid-write SQLite failure', async () => {
    const app = await start()
    try {
      const material = materialSchema.parse({ id: 'm', name: 'MDF', category: 'Panels' })
      const supplier = supplierSchema.parse({ id: 's', name: 'Supplier' })
      const product = supplierProductSchema.parse({
        id: 'p', materialId: material.id, supplierId: supplier.id, name: 'Panel',
        lengthMm: 800, widthMm: 600, thicknessMm: 15, grainDirection: 'none', currency: 'EUR', availability: 'available',
      })
      expect((await app.services.catalog.materials.create(material)).ok).toBe(true)
      expect((await app.services.catalog.suppliers.create(supplier)).ok).toBe(true)
      expect((await app.services.catalog.supplierProducts.create(product)).ok).toBe(true)
      const inspect = new DatabaseSync(app.databasePath)
      inspect.exec("CREATE TRIGGER fail_purchase BEFORE INSERT ON stockItems WHEN (SELECT count(*) FROM stockItems) = 1 BEGIN SELECT RAISE(ABORT, 'simulated database failure'); END")
      try {
        const response = await fetch(`${app.base}stock/addFromProduct`, { method: 'POST', headers, body: JSON.stringify([product, 2]) })
        expect(response.status).toBe(503)
        const error = await response.text()
        expect(error).toContain('Server storage failed')
        expect(error).not.toContain('simulated database failure')
        expect(error).not.toContain(app.databasePath)
        expect(inspect.prepare('SELECT id FROM stockItems').all()).toEqual([])
        expect(inspect.prepare('SELECT id FROM request_receipts WHERE id = ?').all(headers['Idempotency-Key'])).toEqual([])
        expect(inspect.prepare('PRAGMA foreign_key_check').all()).toEqual([])
        inspect.exec('DROP TRIGGER fail_purchase')
        const retry = await fetch(`${app.base}stock/addFromProduct`, { method: 'POST', headers, body: JSON.stringify([product, 2]) })
        expect(retry.status).toBe(200)
        expect(inspect.prepare('SELECT id FROM stockItems').all()).toHaveLength(2)
      } finally {
        inspect.close()
      }
    } finally {
      await app.close()
    }
  })
})
