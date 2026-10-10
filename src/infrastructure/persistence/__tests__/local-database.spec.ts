// @vitest-environment node
import Dexie from 'dexie'
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { z } from 'zod'

import type { LocalPersistence, PersistenceResult, Repositories, Repository } from '../../../application/persistence/repositories'
import { materialSchema } from '../../../domain/model/material'
import { partSchema } from '../../../domain/model/part'
import { stockItemSchema } from '../../../domain/model/stock-item'
import { supplierSchema } from '../../../domain/model/supplier'
import { supplierProductSchema } from '../../../domain/model/supplier-product'
import {
  dimensionKeys, invalidDimensionValues, validMaterialInput, validPartInput,
  validStockItemInput, validSupplierInput, validSupplierProductInput, without,
} from '../../../domain/model/__tests__/fixtures'
import { createLocalPersistence, DATABASE_STORES, DATABASE_VERSION } from '../local-database'

let indexedDB: IDBFactory
let persistence: LocalPersistence
const connections: { close(): void }[] = []

function success<T>(result: PersistenceResult<T>): T {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(`Unexpected ${result.error.kind}`)
  return result.value
}

function connect(): LocalPersistence {
  const connection = createLocalPersistence('persistence-test', { indexedDB, IDBKeyRange })
  connections.push(connection)
  return connection
}

function rawDatabase(): Dexie {
  const database = new Dexie('persistence-test', { indexedDB, IDBKeyRange })
  connections.push(database)
  return database
}

beforeEach(() => {
  indexedDB = new IDBFactory()
  persistence = connect()
})
afterEach(() => {
  for (const connection of connections) connection.close()
  connections.length = 0
})

function repositoryTests<Entity extends { id: string }>(
  name: string, schema: z.ZodType<Entity>, raw: unknown, select: (repositories: Repositories) => Repository<Entity>,
): void {
  describe(name, () => {
    const entity = schema.parse(raw)
    it('creates, reads, lists, replaces and deletes records', async () => {
      const repository = select(persistence)
      expect(success(await repository.list())).toEqual([])
      expect(success(await repository.create(entity))).toEqual(entity)
      expect(success(await repository.get(entity.id))).toEqual(entity)
      expect(success(await repository.list())).toEqual([entity])
      const updated = schema.parse({ ...entity, ...('name' in entity ? { name: 'Updated name' } : { quantity: 2 }) })
      expect(success(await repository.update(entity.id, updated))).toEqual(updated)
      expect(success(await repository.get(entity.id))).toEqual(updated)
      success(await repository.delete(entity.id))
      expect(success(await repository.list())).toEqual([])
    })

    it('rejects duplicate IDs without overwriting, including simultaneous creates', async () => {
      const repository = select(persistence)
      const results = await Promise.all([repository.create(entity), repository.create(entity)])
      expect(results.filter((result) => result.ok)).toHaveLength(1)
      expect(results.find((result) => !result.ok)).toEqual({ ok: false, error: { kind: 'duplicateId', id: entity.id } })
      expect(await repository.create({ ...entity, ...('name' in entity ? { name: 'Overwrite' } : { quantity: 2 }) })).toEqual({ ok: false, error: { kind: 'duplicateId', id: entity.id } })
      expect(success(await repository.get(entity.id))).toEqual(entity)
    })

    it('reports missing records and never upserts on update', async () => {
      const repository = select(persistence)
      const missing = { ok: false, error: { kind: 'notFound', id: entity.id } }
      expect(await repository.get(entity.id)).toEqual(missing)
      expect(await repository.update(entity.id, entity)).toEqual(missing)
      expect(await repository.delete(entity.id)).toEqual(missing)
      expect(success(await repository.list())).toEqual([])
    })

    it('rejects invalid records, unknown fields and changed IDs without changing data', async () => {
      const repository = select(persistence)
      for (const invalid of [null, {}, { ...entity, id: '' }, { ...entity, extra: true }]) {
        expect(await repository.create(invalid)).toMatchObject({ ok: false, error: { kind: 'invalidRecord' } })
      }
      success(await repository.create(entity))
      expect(await repository.update(entity.id, {})).toMatchObject({ ok: false, error: { kind: 'invalidRecord' } })
      expect(await repository.update(entity.id, { ...entity, id: 'different-id' })).toMatchObject({ ok: false, error: { kind: 'invalidRecord' } })
      expect(success(await repository.get(entity.id))).toEqual(entity)
    })

    it('retains records on reopening and keeps database reads independent of caller edits', async () => {
      const repository = select(persistence)
      const created = success(await repository.create(entity))
      Object.assign(created, { name: 'Caller mutation' })
      persistence.close()
      const reopened = connect()
      success(await reopened.open())
      expect(success(await select(reopened).get(entity.id))).toEqual(entity)
    })

    it('rejects corrupt stored records on get and list without deleting them', async () => {
      success(await select(persistence).create(entity))
      persistence.close()
      const rawDb = rawDatabase()
      rawDb.version(DATABASE_VERSION).stores(DATABASE_STORES)
      await rawDb.table<unknown, string>(name).put({ ...entity, extra: true })
      const reopened = connect()
      expect(await select(reopened).get(entity.id)).toMatchObject({ ok: false, error: { kind: 'invalidRecord' } })
      expect(await select(reopened).list()).toMatchObject({ ok: false, error: { kind: 'invalidRecord' } })
      expect(await rawDb.table<unknown, string>(name).count()).toBe(1)
    })
  })
}

repositoryTests('materials', materialSchema, validMaterialInput, (repositories) => repositories.materials)
repositoryTests('parts', partSchema, validPartInput, (repositories) => repositories.parts)
repositoryTests('suppliers', supplierSchema, validSupplierInput, (repositories) => repositories.suppliers)
repositoryTests('supplierProducts', supplierProductSchema, validSupplierProductInput, (repositories) => repositories.supplierProducts)
repositoryTests('stockItems', stockItemSchema, validStockItemInput, (repositories) => repositories.stockItems)

describe('physical dimensions and orientation', () => {
  const physical = [
    { input: validPartInput, repository: (repositories: Repositories) => repositories.parts },
    { input: validSupplierProductInput, repository: (repositories: Repositories) => repositories.supplierProducts },
    { input: validStockItemInput, repository: (repositories: Repositories) => repositories.stockItems },
  ]
  it.each(physical)('rejects missing and invalid dimensions for $input.id', async ({ input, repository }) => {
    for (const key of dimensionKeys) {
      expect(await repository(persistence).create(without(input, key))).toMatchObject({ ok: false, error: { kind: 'invalidRecord' } })
      for (const value of invalidDimensionValues) {
        expect(await repository(persistence).create({ ...input, [key]: value })).toMatchObject({ ok: false, error: { kind: 'invalidRecord' } })
      }
    }
    expect(await repository(persistence).create({ ...input, grainDirection: 'diagonal' })).toMatchObject({ ok: false, error: { kind: 'invalidRecord' } })
  })
  it('rejects invalid rotation, quantity and provenance', async () => {
    expect(await persistence.parts.create({ ...validPartInput, rotation: 'free' })).toMatchObject({ ok: false })
    expect(await persistence.parts.create({ ...validPartInput, quantity: 0 })).toMatchObject({ ok: false })
    expect(await persistence.stockItems.create({ ...validStockItemInput, provenance: { source: 'unknown' } })).toMatchObject({ ok: false })
  })
})

describe('atomic transactions', () => {
  it('commits changes across all five repositories', async () => {
    success(await persistence.transaction(async (repositories) => {
      success(await repositories.materials.create(validMaterialInput))
      success(await repositories.parts.create(validPartInput))
      success(await repositories.suppliers.create(validSupplierInput))
      success(await repositories.supplierProducts.create(validSupplierProductInput))
      return repositories.stockItems.create(validStockItemInput)
    }))
    for (const repository of [persistence.materials, persistence.parts, persistence.suppliers, persistence.supplierProducts, persistence.stockItems]) {
      expect(success<readonly unknown[]>(await repository.list())).toHaveLength(1)
    }
  })

  it('rolls back earlier writes even when the callback ignores a duplicate failure', async () => {
    const result = await persistence.transaction(async (repositories) => {
      await repositories.materials.create(validMaterialInput)
      await repositories.parts.create(validPartInput)
      await repositories.parts.create(validPartInput)
      return { ok: true, value: 'ignored failure' }
    })
    expect(result).toMatchObject({ ok: false, error: { kind: 'duplicateId' } })
    expect(success(await persistence.materials.list())).toEqual([])
    expect(success(await persistence.parts.list())).toEqual([])
  })

  it('rolls back replacements and deletions on invalid input', async () => {
    const material = success(await persistence.materials.create(validMaterialInput))
    const part = success(await persistence.parts.create(validPartInput))
    expect(await persistence.transaction(async (repositories) => {
      await repositories.materials.update(material.id, { ...material, name: 'Changed' })
      await repositories.parts.delete(part.id)
      return repositories.stockItems.create({ ...validStockItemInput, thicknessMm: undefined })
    })).toMatchObject({ ok: false, error: { kind: 'invalidRecord' } })
    expect(success(await persistence.materials.get(material.id))).toEqual(material)
    expect(success(await persistence.parts.get(part.id))).toEqual(part)
  })

  it('rolls back earlier writes when a required record is missing', async () => {
    expect(await persistence.transaction(async (repositories) => {
      await repositories.materials.create(validMaterialInput)
      return repositories.parts.get(partSchema.parse(validPartInput).id)
    })).toMatchObject({ ok: false, error: { kind: 'notFound' } })
    expect(success(await persistence.materials.list())).toEqual([])
  })

  it('rolls back on callback exceptions or explicit failure results', async () => {
    expect(await persistence.transaction(async (repositories) => {
      await repositories.materials.create(validMaterialInput)
      throw new Error('Callback failed')
    })).toEqual({ ok: false, error: { kind: 'storageFailure', message: 'Callback failed' } })
    expect(success(await persistence.materials.list())).toEqual([])
    expect(await persistence.transaction(async (repositories) => {
      await repositories.materials.create(validMaterialInput)
      return { ok: false, error: { kind: 'notFound', id: 'missing' } }
    })).toMatchObject({ ok: false, error: { kind: 'notFound' } })
    expect(success(await persistence.materials.list())).toEqual([])
  })

  it('rolls back earlier writes when IndexedDB rejects a later write', async () => {
    const failingAdd = vi.spyOn(IDBObjectStore.prototype, 'add')
    try {
      expect(await persistence.transaction(async (repositories) => {
        await repositories.materials.create(validMaterialInput)
        failingAdd.mockImplementation(() => { throw new DOMException('Storage quota exceeded', 'QuotaExceededError') })
        return repositories.parts.create(validPartInput)
      })).toMatchObject({ ok: false, error: { kind: 'storageFailure' } })
    } finally {
      failingAdd.mockRestore()
    }
    expect(success(await persistence.materials.list())).toEqual([])
  })

  it('rejects use of transaction repositories after completion', async () => {
    let escaped: Repositories | undefined
    success(await persistence.transaction(async (repositories) => {
      escaped = repositories
      return repositories.materials.create(validMaterialInput)
    }))
    if (escaped === undefined) throw new Error('Missing scoped repositories')
    expect(await escaped.parts.create(validPartInput)).toMatchObject({ ok: false, error: { kind: 'storageFailure' } })
    expect(success(await persistence.parts.list())).toEqual([])
  })
})

describe('storage failures and versions', () => {
  it('reports unavailable IndexedDB instead of rejecting promises', async () => {
    const unavailable = createLocalPersistence('unavailable', { indexedDB: { open() { throw new Error('IndexedDB unavailable') } }, IDBKeyRange })
    connections.push(unavailable)
    expect(await unavailable.open()).toMatchObject({ ok: false, error: { kind: 'storageFailure' } })
    expect(await unavailable.materials.create(validMaterialInput)).toMatchObject({ ok: false, error: { kind: 'storageFailure' } })
  })

  it('reports operations on a closed database and supports explicit reopening', async () => {
    success(await persistence.open())
    persistence.close()
    expect(await persistence.materials.list()).toMatchObject({ ok: false, error: { kind: 'storageFailure' } })
    success(await persistence.open())
    success(await persistence.materials.create(validMaterialInput))
  })

  it('preserves every entity when a future version adds an index', async () => {
    await persistence.materials.create(validMaterialInput)
    await persistence.parts.create(validPartInput)
    await persistence.suppliers.create(validSupplierInput)
    await persistence.supplierProducts.create(validSupplierProductInput)
    await persistence.stockItems.create(validStockItemInput)
    persistence.close()
    const upgraded = rawDatabase()
    upgraded.version(DATABASE_VERSION).stores(DATABASE_STORES)
    upgraded.version(DATABASE_VERSION + 1).stores({ ...DATABASE_STORES, parts: 'id, materialId' })
    await upgraded.open()
    for (const [table, record] of [
      ['materials', validMaterialInput], ['parts', validPartInput], ['suppliers', validSupplierInput],
      ['supplierProducts', validSupplierProductInput], ['stockItems', validStockItemInput],
    ] as const) expect(await upgraded.table<unknown, string>(table).get(record.id)).toEqual(record)
    upgraded.close()
    // An older application must report an unsupported newer version, never reset the database.
    const older = connect()
    expect(await older.open()).toMatchObject({ ok: false, error: { kind: 'storageFailure' } })
    expect(await older.open()).toMatchObject({ ok: false, error: { kind: 'storageFailure' } })
    expect(await older.materials.create(validMaterialInput)).toMatchObject({ ok: false, error: { kind: 'storageFailure' } })
  })

  it('rolls back a failed migration without losing records or advancing the version', async () => {
    success(await persistence.parts.create(validPartInput))
    persistence.close()
    const upgraded = rawDatabase()
    upgraded.version(DATABASE_VERSION).stores(DATABASE_STORES)
    upgraded.version(DATABASE_VERSION + 1).stores({ ...DATABASE_STORES, parts: 'id, materialId' }).upgrade(async (transaction) => {
      await transaction.table<unknown, string>('parts').put({ ...validPartInput, name: 'Migration changed this' })
      throw new Error('Migration failed')
    })
    await expect(upgraded.open()).rejects.toThrow('Migration failed')
    upgraded.close()
    const reopened = connect()
    success(await reopened.open())
    expect(success(await reopened.parts.get(partSchema.parse(validPartInput).id))).toEqual(validPartInput)
  })
})
