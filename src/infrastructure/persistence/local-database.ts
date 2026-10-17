import { catalogOrderSchema } from '../../application/catalog/catalog-order'
import { stockOrderSchema } from '../../application/inventory/stock-order'
import { projectStockSchema } from '../../domain/model/project-stock'
import { currentCuttingResultSchema } from '../../domain/model/current-cutting-result'
import { savedPlanContentsSchema, savedPlanSummarySchema } from '../../domain/model/saved-cutting-plan'
import { cuttingConfirmationSchema } from '../../domain/model/cutting-confirmation'
import { cuttingProjectIdSchema } from '../../domain/model/ids'
import Dexie, { type DexieOptions, type Table } from 'dexie'
import type { z } from 'zod'

import type { LocalPersistence, PersistenceError, PersistenceResult, Repositories, Repository } from '../../application/persistence/repositories'
import { cuttingProjectSchema } from '../../domain/model/cutting-project'
import { materialSchema } from '../../domain/model/material'
import { partSchema } from '../../domain/model/part'
import { stockItemSchema } from '../../domain/model/stock-item'
import { supplierSchema } from '../../domain/model/supplier'
import { supplierProductSchema } from '../../domain/model/supplier-product'

type Execute = <T>(mode: 'r' | 'rw', table: Table<unknown, string>, work: () => Promise<T>) => Promise<PersistenceResult<T>>


export const DATABASE_NAME = 'opticutlist'
export const DATABASE_VERSION = 8
export const DATABASE_V1_STORES = {
  materials: 'id',
  parts: 'id',
  suppliers: 'id',
  supplierProducts: 'id',
  stockItems: 'id',
} as const
export const DATABASE_V2_STORES = { ...DATABASE_V1_STORES, projects: 'id' } as const
export const DATABASE_V3_STORES = { ...DATABASE_V2_STORES, savedPlanSummaries: 'id, projectId', savedPlanContents: 'id' } as const
export const DATABASE_V4_STORES = { ...DATABASE_V3_STORES, cuttingConfirmations: 'id, projectId' } as const

export const DATABASE_V5_STORES = { ...DATABASE_V4_STORES, currentCuttingResults: 'id' } as const
export const DATABASE_V6_STORES = { ...DATABASE_V5_STORES, projectStock: 'id' } as const
export const DATABASE_V7_STORES = { ...DATABASE_V6_STORES, stockOrders: 'id' } as const
export const DATABASE_STORES = { ...DATABASE_V7_STORES, catalogOrders: 'id' } as const

class PersistenceFailure extends Error {
  constructor(readonly detail: PersistenceError) {
    super(detail.kind)
  }
}

function failure(error: unknown): PersistenceError {
  return error instanceof PersistenceFailure ? error.detail : {
    kind: 'storageFailure', message: error instanceof Error ? error.message : String(error),
  }
}

function parse<T>(schema: z.ZodType<T>, record: unknown): T {
  const result = schema.safeParse(record)
  if (!result.success) {
    throw new PersistenceFailure({ kind: 'invalidRecord', issues: result.error.issues.map(({ path, message }) => ({ path, message })) })
  }
  return result.data
}

function createRepository<Entity extends { id: string }>(
  table: Table<unknown, string>, schema: z.ZodType<Entity>, idSchema: z.ZodType, execute: Execute,
): Repository<Entity> {
  async function requireRecord(id: Entity['id']): Promise<Entity> {
    parse(idSchema, id)
    const stored = await table.get(id)
    if (stored === undefined) throw new PersistenceFailure({ kind: 'notFound', id })
    return parse(schema, stored)
  }
  return {
    create(record) {
      return execute('rw', table, async () => {
        const entity = parse(schema, record)
        try {
          // add() is insert-only, so concurrent creates cannot overwrite a record.
          await table.add(entity)
        } catch (error) {
          if (error instanceof Error && error.name === 'ConstraintError') {
            throw new PersistenceFailure({ kind: 'duplicateId', id: entity.id })
          }
          throw error
        }
        return entity
      })
    },
    get(id) {
      return execute('r', table, () => requireRecord(id))
    },
    update(id, record) {
      return execute('rw', table, async () => {
        const entity = parse(schema, record)
        parse(idSchema, id)
        if (entity.id !== id) {
          throw new PersistenceFailure({ kind: 'invalidRecord', issues: [{ path: ['id'], message: 'An update cannot change the record ID' }] })
        }
        await requireRecord(id)
        await table.put(entity)
        return entity
      })
    },
    delete(id) {
      return execute('rw', table, async () => {
        await requireRecord(id)
        await table.delete(id)
      })
    },
    list() {
      return execute('r', table, async () => {
        const records = await table.orderBy(':id').toArray()
        // Reject the entire read on corrupt data; never omit invalid stored records.
        return records.map((record) => parse(schema, record))
      })
    },
  }
}

/** Independent instances, no singleton or business-data cache. Options inject IndexedDB in tests. */
export function createLocalPersistence(name = DATABASE_NAME, options?: DexieOptions): LocalPersistence {
  const database = new Dexie(name, options)
  // Keep this declaration immutable. Append versions with transactional upgrade callbacks when
  // records need transformation; a failed migration must abort, never clear or recreate the DB.
  database.version(1).stores(DATABASE_V1_STORES)
  // Additive upgrade: existing records are untouched. Legacy parts remain unassigned
  // until the user explicitly adopts them through the project application service.
  database.version(2).stores(DATABASE_V2_STORES)
  // Add plan summaries and payloads without rewriting any existing records.
  database.version(3).stores(DATABASE_V3_STORES)
  database.version(4).stores(DATABASE_V4_STORES)
  // Add only a project-keyed reference; never select or delete legacy layouts during upgrade.
  database.version(5).stores(DATABASE_V5_STORES)
  database.version(6).stores(DATABASE_V6_STORES)
  // Presentation order is additive; inventory and audit records remain byte-for-byte unchanged.
  database.version(7).stores(DATABASE_V7_STORES)
  database.version(DATABASE_VERSION).stores(DATABASE_STORES)
  database.on('ready', () => {
    // Dexie versions are multiplied by ten in the native IndexedDB version.
    if (database.backendDB().version > DATABASE_VERSION * 10) {
      throw new Error(`Database version ${String(database.backendDB().version / 10)} is newer than supported version ${String(DATABASE_VERSION)}`)
    }
  }, true)

  const execute: Execute = async (mode, table, work) => {
    try {
      return { ok: true, value: await database.transaction(mode, table, work) }
    } catch (error) {
      return { ok: false, error: failure(error) }
    }
  }

  function repositories(tableFor: (name: string) => Table<unknown, string>, run: Execute): Repositories {
    const summaries = tableFor('savedPlanSummaries')
    const confirmations = tableFor('cuttingConfirmations')
    const current = tableFor('currentCuttingResults')
    const projectStock = tableFor('projectStock')
    return {
      projectStock: {
        ...createRepository(projectStock, projectStockSchema, cuttingProjectIdSchema, run),
        find(id) {
          return run('r', projectStock, async () => {
            parse(cuttingProjectIdSchema, id)
            const record = await projectStock.get(id)
            return record === undefined ? null : parse(projectStockSchema, record)
          })
        },
      },
      currentCuttingResults: {
        ...createRepository(current, currentCuttingResultSchema, cuttingProjectIdSchema, run),
        find(id) {
          return run('r', current, async () => {
            parse(cuttingProjectIdSchema, id)
            const record = await current.get(id)
            return record === undefined ? null : parse(currentCuttingResultSchema, record)
          })
        },
      },
      cuttingConfirmations: {
        ...createRepository(confirmations, cuttingConfirmationSchema, cuttingConfirmationSchema.shape.id, run),
        find(id) {
          return run('r', confirmations, async () => {
            parse(cuttingConfirmationSchema.shape.id, id)
            const record = await confirmations.get(id)
            return record === undefined ? null : parse(cuttingConfirmationSchema, record)
          })
        },
        listForProject(projectId) {
          return run('r', confirmations, async () => {
            parse(cuttingProjectIdSchema, projectId)
            const records = await confirmations.where('projectId').equals(projectId).toArray()
            return records.map(record => parse(cuttingConfirmationSchema, record))
          })
        },
      },
      savedPlanSummaries: {
        ...createRepository(summaries, savedPlanSummarySchema, savedPlanSummarySchema.shape.id, run),
        listForProject(projectId) {
          return run('r', summaries, async () => {
            parse(cuttingProjectIdSchema, projectId)
            const records = await summaries.where('projectId').equals(projectId).toArray()
            return records.map(record => parse(savedPlanSummarySchema, record)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
          })
        },
      },
      savedPlanContents: createRepository(tableFor('savedPlanContents'), savedPlanContentsSchema, savedPlanContentsSchema.shape.id, run),
      projects: createRepository(tableFor('projects'), cuttingProjectSchema, cuttingProjectSchema.shape.id, run),
      materials: createRepository(tableFor('materials'), materialSchema, materialSchema.shape.id, run),
      parts: createRepository(tableFor('parts'), partSchema, partSchema.shape.id, run),
      suppliers: createRepository(tableFor('suppliers'), supplierSchema, supplierSchema.shape.id, run),
      supplierProducts: createRepository(tableFor('supplierProducts'), supplierProductSchema, supplierProductSchema.shape.id, run),
      catalogOrders: createRepository(tableFor('catalogOrders'), catalogOrderSchema, catalogOrderSchema.shape.id, run),
      stockOrders: createRepository(tableFor('stockOrders'), stockOrderSchema, stockOrderSchema.shape.id, run),
      stockItems: createRepository(tableFor('stockItems'), stockItemSchema, stockItemSchema.shape.id, run),
    }
  }

  return {
    ...repositories((tableName) => database.table<unknown, string>(tableName), execute),
    async open() {
      try {
        await database.open()
        return { ok: true, value: undefined }
      } catch (error) {
        return { ok: false, error: failure(error) }
      }
    },
    close() {
      database.close()
    },
    async transaction(work) {
      try {
        const value = await database.transaction('rw', database.tables, async (transaction) => {
          let firstFailure: PersistenceError | undefined
          let active = true
          const safeExecute: Execute = async (_mode, _table, operation) => {
            try {
              if (!active) throw new Error('Transaction repositories are no longer active')
              if (firstFailure !== undefined) throw new PersistenceFailure(firstFailure)
              return { ok: true, value: await operation() }
            } catch (error) {
              const detail = failure(error)
              firstFailure ??= detail
              return { ok: false, error: detail }
            }
          }
          try {
            const result = await work(repositories((tableName) => transaction.table<unknown, string>(tableName), safeExecute))
            if (firstFailure !== undefined) throw new PersistenceFailure(firstFailure)
            if (!result.ok) throw new PersistenceFailure(result.error)
            return result.value
          } finally {
            active = false
          }
        })
        return { ok: true, value }
      } catch (error) {
        return { ok: false, error: failure(error) }
      }
    },
  }
}
