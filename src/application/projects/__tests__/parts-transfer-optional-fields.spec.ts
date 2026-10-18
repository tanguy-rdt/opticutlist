// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { createLocalPersistence } from '../../../infrastructure/persistence/local-database'
import { projectJson } from '../../../infrastructure/projects/project-json'
import { materialSchema } from '../../../domain/model/material'
import { cuttingProjectSchema } from '../../../domain/model/cutting-project'
import { createProjectService } from '../project-service'
import { createPartsTransferService } from '../parts-transfer-service'
import { validatePartsTransfer } from '../parts-transfer-format'
import type { PersistenceResult } from '../../persistence/repositories'

const row = { name: 'CAD shelf', length: 600, width: 300, thickness: 18, quantity: 2 }
const file = { format: 'opticutlist-parts', version: 1, parts: [row] }
const material = materialSchema.parse({ id: 'cad-material', name: 'MDF', category: 'Panels' })
const project = cuttingProjectSchema.parse({ id: 'cad-project', name: 'CAD import', partIds: [], materialIds: [material.id], supplierProductIds: [] })
const connections: ReturnType<typeof createLocalPersistence>[] = []

function value<T>(result: PersistenceResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error))
  return result.value
}

async function setup() {
  const indexedDB = new IDBFactory()
  const persistence = createLocalPersistence('optional-parts-import', { indexedDB, IDBKeyRange })
  connections.push(persistence)
  const projects = createProjectService(persistence)
  value(await persistence.materials.create(material))
  value(await projects.projects.create(project))
  return { persistence, projects, indexedDB, service: createPartsTransferService(persistence, projectJson) }
}

afterEach(() => {
  for (const connection of connections.splice(0)) connection.close()
})

describe('CAD Parts JSON optional fields', () => {
  it.each([
    {},
    { material: 'MDF' },
    { grainDirection: 'length' },
    { rotation: 'forbidden' },
    { material: 'MDF', grainDirection: 'width' },
    { material: 'MDF', rotation: 'forbidden' },
    { grainDirection: 'length', rotation: 'forbidden' },
    { material: 'MDF', grainDirection: 'width', rotation: 'forbidden' },
  ])('defaults only omitted constraints and preserves supplied values: %j', optional => {
    const parsed = value(validatePartsTransfer({ ...file, parts: [{ ...row, ...optional }] }))
    expect(parsed.parts).toEqual([{
      ...row, ...optional,
      grainDirection: optional.grainDirection ?? 'none',
      rotation: optional.rotation ?? 'allowed',
    }])
  })

  it.each([
    { material: '' }, { material: null }, { material: 3 },
    { grainDirection: null }, { grainDirection: '' }, { grainDirection: 'diagonal' },
    { rotation: null }, { rotation: '' }, { rotation: true },
    { length: undefined }, { width: undefined }, { thickness: undefined },
    { quantity: undefined }, { name: undefined }, { thickness: 0 }, { quantity: 0 },
    { id: 'not-allowed' },
  ])('still rejects invalid supplied fields and missing required fields: %j', invalid => {
    expect(validatePartsTransfer({ ...file, parts: [{ ...row, ...invalid }] }).ok).toBe(false)
  })

  it('requires an explicit material choice, persists complete Parts and reloads them without changing catalog or stock', async () => {
    const { persistence, projects, service, indexedDB } = await setup()
    const preview = value(await service.preview(project.id, JSON.stringify(file)))
    expect(preview.materialIds).toEqual([null])
    expect(preview.file.parts).toEqual([{ ...row, grainDirection: 'none', rotation: 'allowed' }])
    expect(await service.import(project.id, file, [null], true)).toMatchObject({ ok: false })
    expect(await service.import(project.id, file, [material.id], false)).toMatchObject({ ok: false })
    expect(value(await projects.parts(project.id).list())).toEqual([])

    expect(value(await service.import(project.id, file, [material.id], true))).toBe(1)
    const imported = value(await projects.parts(project.id).list())
    expect(imported).toHaveLength(1)
    expect(imported[0]).toMatchObject({
      name: row.name, materialId: material.id, lengthMm: 600, widthMm: 300,
      thicknessMm: 18, quantity: 2, grainDirection: 'none', rotation: 'allowed',
    })
    const reopened = createLocalPersistence('optional-parts-import', { indexedDB, IDBKeyRange })
    connections.push(reopened)
    expect(value(await createProjectService(reopened).parts(project.id).list())).toEqual(imported)
    expect(value(await persistence.materials.list())).toEqual([material])
    expect(value(await persistence.supplierProducts.list())).toEqual([])
    expect(value(await persistence.stockItems.list())).toEqual([])
  })

  it('rechecks material eligibility after preview and rejects the whole batch when selection changed', async () => {
    const { persistence, projects, service } = await setup()
    const preview = value(await service.preview(project.id, JSON.stringify(file)))
    value(await projects.projects.update(project.id, { ...project, materialIds: [] }))
    expect(await service.import(project.id, preview.file, [material.id], true)).toMatchObject({
      ok: false, error: { kind: 'referenceConflict' },
    })
    expect(value(await persistence.parts.list())).toEqual([])
    expect(value(await projects.projects.get(project.id)).partIds).toEqual([])
  })
})
