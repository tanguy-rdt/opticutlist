// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { createLocalPersistence } from '../../../infrastructure/persistence/local-database'
import { createProjectService } from '../project-service'
import { createPartsTransferService } from '../parts-transfer-service'
import { validatePartsTransfer, partsTransferSchema } from '../parts-transfer-format'
import { projectJson } from '../../../infrastructure/projects/project-json'
import { cuttingProjectSchema } from '../../../domain/model/cutting-project'
import { materialSchema } from '../../../domain/model/material'
import { partSchema } from '../../../domain/model/part'
import { validMaterialInput, validPartInput } from '../../../domain/model/__tests__/fixtures'
import type { PersistenceResult } from '../../persistence/repositories'
function value<T>(result: PersistenceResult<T>): T { if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.value }
const connections: ReturnType<typeof createLocalPersistence>[] = []
afterEach(() => { connections.forEach(connection => { connection.close() }); connections.length = 0; vi.restoreAllMocks() })
const material = materialSchema.parse({ ...validMaterialInput, name: 'Birch plywood' })
const row = { name: 'Cabinet side', material: material.name, length: 720, width: 560, thickness: 18, quantity: 2, grainDirection: 'length', rotation: 'forbidden' }
const file = { format: 'opticutlist-parts', version: 1, parts: [row, { ...row, name: 'Shelf', quantity: 3, grainDirection: 'none', rotation: 'allowed' }] }
async function setup() {
  const indexedDB = new IDBFactory()
  const persistence = createLocalPersistence('parts-json', { indexedDB, IDBKeyRange }); connections.push(persistence)
  const projects = createProjectService(persistence)
  const project = cuttingProjectSchema.parse({ id: 'parts-project', name: 'Cabinet', partIds: [], materialIds: [material.id], supplierProductIds: [] })
  value(await persistence.materials.create(material)); value(await projects.projects.create(project))
  return { indexedDB, persistence, projects, project, service: createPartsTransferService(persistence, projectJson) }
}
describe('Parts JSON exchange', () => {
  it('imports, exports and round trips all properties with fresh identities, without unrelated data', async () => {
    const { projects, project, service, indexedDB } = await setup()
    value(await projects.parts(project.id).create(validPartInput))
    const existing = value(await projects.parts(project.id).list())
    const preview = value(await service.preview(project.id, JSON.stringify(file)))
    expect(preview.materialIds).toEqual([material.id, material.id])
    expect(value(await service.import(project.id, preview.file, preview.materialIds, true))).toBe(2)
    const exported = value(await service.export(project.id))
    expect(exported.name).toBe('Cabinet')
    const parsed = partsTransferSchema.parse(projectJson.parse(exported.text))
    expect(parsed.parts.slice(1)).toEqual(file.parts)
    expect(exported.text).toContain('\n  "format"')
    expect(exported.text).not.toContain('materialId'); expect(exported.text).not.toContain('lengthMm')
    expect(value(await projects.parts(project.id).get(partSchema.parse(validPartInput).id))).toEqual(existing[0])
    const next = createLocalPersistence('parts-json', { indexedDB, IDBKeyRange }); connections.push(next)
    const nextService = createPartsTransferService(next, projectJson)
    const reopened = value(await nextService.preview(project.id, exported.text))
    value(await nextService.import(project.id, reopened.file, reopened.materialIds, true))
    const parts = value(await createProjectService(next).parts(project.id).list())
    expect(parts).toHaveLength(6); expect(new Set(parts.map(part => part.id)).size).toBe(6)
    expect(value(await next.materials.list())).toEqual([material])
    expect(value(await next.stockItems.list())).toEqual([])
    expect(value(await next.supplierProducts.list())).toEqual([])
  })
  it('exports and imports an empty list without changing selections or requiring a material', async () => {
    const { persistence, projects, project, service } = await setup()
    value(await projects.projects.update(project.id, { ...project, materialIds: [] }))
    const exported = value(await service.export(project.id))
    expect(projectJson.parse(exported.text)).toEqual({ format: 'opticutlist-parts', version: 1, parts: [] })
    expect(value(await service.import(project.id, projectJson.parse(exported.text), [], true))).toBe(0)
    expect(value(await persistence.parts.list())).toEqual([])
  })
  it.each([
    { ...file, format: 'another-format' }, { ...file, version: 2 }, { ...file, version: '1' },
    { ...file, parts: [{ ...row, length: 0 }] }, { ...file, parts: [{ ...row, width: -1 }] },
    { ...file, parts: [{ ...row, thickness: null }] }, { ...file, parts: [{ ...row, quantity: 1.5 }] },
    { ...file, parts: [{ ...row, quantity: 0 }] }, { ...file, parts: [{ ...row, grainDirection: 'diagonal' }] },
    { ...file, parts: [{ ...row, rotation: true }] }, { ...file, parts: [{ name: 'Missing fields' }] },
    { ...file, extra: 'metadata' }, { ...file, parts: [{ ...row, id: 'database-id' }] },
  ])('rejects unsupported or invalid files before writes: %j', async invalid => {
    const { persistence, project, service } = await setup()
    expect(validatePartsTransfer(invalid).ok).toBe(false)
    expect(await service.preview(project.id, JSON.stringify(invalid))).toMatchObject({ ok: false, error: { kind: 'invalidRecord' } })
    expect(await service.import(project.id, invalid, [material.id], true)).toMatchObject({ ok: false })
    expect(value(await persistence.parts.list())).toEqual([])
  })
  it('rejects malformed JSON and non-finite dimensions', async () => {
    const { project, service } = await setup()
    expect(await service.preview(project.id, '{broken')).toMatchObject({ ok: false, error: { kind: 'invalidRecord' } })
    expect(validatePartsTransfer({ ...file, parts: [{ ...row, length: Infinity }] }).ok).toBe(false)
  })
  it('requires confirmation and explicit mapping of missing/ambiguous material labels', async () => {
    const { persistence, projects, project, service } = await setup()
    const duplicate = materialSchema.parse({ ...material, id: 'same-name-material' })
    value(await persistence.materials.create(duplicate))
    value(await projects.projects.update(project.id, { ...project, materialIds: [material.id, duplicate.id] }))
    const preview = value(await service.preview(project.id, JSON.stringify(file)))
    expect(preview.materialIds).toEqual([null, null])
    expect(await service.import(project.id, preview.file, preview.materialIds, true)).toMatchObject({ ok: false })
    expect(await service.import(project.id, preview.file, [material.id, material.id], false)).toMatchObject({ ok: false })
    expect(value(await service.import(project.id, preview.file, [material.id, duplicate.id], true))).toBe(2)
    const parts = value(await persistence.parts.list())
    expect(new Set(parts.map(part => part.materialId))).toEqual(new Set([material.id, duplicate.id]))
    expect(value(await service.preview(project.id, JSON.stringify({ ...file, parts: [{ ...row, material: 'Unknown wood' }] }))).materialIds).toEqual([null])
  })
  it('rechecks saved material membership and rolls back a failed batch without changing existing Parts or ownership', async () => {
    const { persistence, projects, project, service } = await setup()
    value(await projects.parts(project.id).create(validPartInput))
    const owner = value(await projects.projects.get(project.id))
    const before = value(await persistence.parts.list())
    const transaction = persistence.transaction.bind(persistence)
    let inserted = 0
    vi.spyOn(persistence, 'transaction').mockImplementation(work => transaction(repositories => work({ ...repositories, parts: { ...repositories.parts, create: record => ++inserted === 2 ? Promise.resolve({ ok: false, error: { kind: 'storageFailure', message: 'Disk full' } }) : repositories.parts.create(record) } })))
    expect(await service.import(project.id, file, [material.id, material.id], true)).toMatchObject({ ok: false })
    vi.restoreAllMocks()
    expect(value(await persistence.parts.list())).toEqual(before)
    expect(value(await projects.projects.get(project.id))).toEqual(owner)
    value(await projects.projects.update(project.id, { ...owner, materialIds: [] }))
    expect(await service.import(project.id, file, [material.id, material.id], true)).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    expect(value(await persistence.parts.list())).toEqual(before)
  })
})
