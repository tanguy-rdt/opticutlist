// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSelfHostedServer } from '../http'
import { createHttpStorageServices } from '../../src/infrastructure/http/storage-services'
import { materialSchema } from '../../src/domain/model/material'
import { cuttingProjectSchema } from '../../src/domain/model/cutting-project'
import type { PersistenceResult } from '../../src/application/persistence/repositories'

function value<T>(result: PersistenceResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error))
  return result.value
}

describe('CAD Parts import over HTTP', () => {
  it('normalizes omitted fields in preview and atomically persists complete Parts in SQLite', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ocl-cad-parts-'))
    const frontendPath = join(directory, 'frontend')
    await mkdir(frontendPath)
    await writeFile(join(frontendPath, 'index.html'), '<title>CAD import test</title>')
    const app = createSelfHostedServer({ databasePath: join(directory, 'data.sqlite'), frontendPath })
    try {
      await new Promise<void>(resolve => { app.server.listen(0, '127.0.0.1', resolve) })
      const address = app.server.address()
      if (!address || typeof address === 'string') throw new Error('Missing listener')
      const base = `http://127.0.0.1:${String(address.port)}/api/v1/`
      const client = createHttpStorageServices(base)
      const material = materialSchema.parse({ id: 'cad-material', name: 'MDF', category: 'Panels' })
      const project = cuttingProjectSchema.parse({ id: 'cad-project', name: 'CAD project', partIds: [], materialIds: [material.id], supplierProductIds: [] })
      value(await client.catalog.materials.create(material))
      value(await client.projects.projects.create(project))
      const row = { name: 'CAD shelf', length: 600, width: 300, thickness: 18, quantity: 2 }
      const file = { format: 'opticutlist-parts', version: 1, parts: [row] }
      const preview = value(await client.partsTransfer.preview(project.id, JSON.stringify(file)))
      expect(preview.materialIds).toEqual([null])
      expect(preview.file.parts).toEqual([{ ...row, grainDirection: 'none', rotation: 'allowed' }])
      expect(await client.partsTransfer.import(project.id, file, [null], true)).toMatchObject({ ok: false })
      expect(value(await client.projects.parts(project.id).list())).toEqual([])
      expect(value(await client.partsTransfer.import(project.id, file, [material.id], true))).toBe(1)
      const secondClient = createHttpStorageServices(base)
      expect(value(await secondClient.projects.parts(project.id).list())).toEqual([
        expect.objectContaining({ name: row.name, materialId: material.id, lengthMm: 600, widthMm: 300, thicknessMm: 18, quantity: 2, grainDirection: 'none', rotation: 'allowed' }),
      ])
      expect(value(await secondClient.stock.list())).toEqual([])
    } finally {
      await app.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
