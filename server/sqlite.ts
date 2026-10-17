import { AsyncLocalStorage } from 'node:async_hooks'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, chmodSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'
import { cuttingProjectIdSchema } from '../src/domain/model/ids'
import type { Persistence, PersistenceResult, PersistenceError, Repositories, Repository } from '../src/application/persistence/repositories'
import { materialSchema } from '../src/domain/model/material'
import { partSchema } from '../src/domain/model/part'
import { supplierSchema } from '../src/domain/model/supplier'
import { supplierProductSchema } from '../src/domain/model/supplier-product'
import { stockItemSchema } from '../src/domain/model/stock-item'
import { cuttingProjectSchema } from '../src/domain/model/cutting-project'
import { savedPlanSummarySchema, savedPlanContentsSchema } from '../src/domain/model/saved-cutting-plan'
import { cuttingConfirmationSchema } from '../src/domain/model/cutting-confirmation'
import { currentCuttingResultSchema } from '../src/domain/model/current-cutting-result'
import { projectStockSchema } from '../src/domain/model/project-stock'
import { stockOrderSchema } from '../src/application/inventory/stock-order'
import { catalogOrderSchema } from '../src/application/catalog/catalog-order'

const schemas = {
  materials: materialSchema,
  parts: partSchema,
  suppliers: supplierSchema,
  supplierProducts: supplierProductSchema,
  stockItems: stockItemSchema,
  projects: cuttingProjectSchema,
  savedPlanSummaries: savedPlanSummarySchema,
  savedPlanContents: savedPlanContentsSchema,
  cuttingConfirmations: cuttingConfirmationSchema,
  currentCuttingResults: currentCuttingResultSchema,
  projectStock: projectStockSchema,
  stockOrders: stockOrderSchema,
  catalogOrders: catalogOrderSchema,
}
const recordRow = z.strictObject({ record: z.string() })
const cacheRow = z.strictObject({ hash: z.string(), response: z.string() })
const versionRow = z.strictObject({ user_version: z.number() })
const namesRow = z.strictObject({ name: z.string() })
const applicationId = 0x4f434c31

class Failure extends Error {
  constructor(readonly detail: PersistenceError) {
    super(detail.kind)
  }
}
function failure(error: unknown): PersistenceError {
  return error instanceof Failure ? error.detail : {
    kind: 'storageFailure',
    message: 'Server storage failed. Check database availability and server logs.'
  }
}
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success) {
    throw new Failure({
      kind: 'invalidRecord',
      issues: result.error.issues.map(({ path, message }) => ({ path, message }))
    })
  }
  return result.data
}

/** One serialized connection; async application callbacks never share an open transaction. */
export function createSqlitePersistence(filename: string) {
  if (filename === ':memory:' || filename.trim() === '') {
    throw new Error('Configure a persistent SQLite file path.')
  }
  mkdirSync(dirname(filename), { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(filename, { timeout: 5000 })
  chmodSync(filename, 0o600)
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;')
    db.exec('BEGIN IMMEDIATE')
    const version = versionRow.parse(db.prepare('PRAGMA user_version').get()).user_version
    if (version > 1) {
      throw new Error('SQLite schema is newer than this server; the database was preserved.')
    }
    if (version === 0) {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => namesRow.parse(row).name)
      if (tables.length) {
        throw new Error('Refusing to initialize an unrelated SQLite database.')
      }
      // Migration 1. JSON remains schema-validated; generated columns enforce live references.
      for (const name of Object.keys(schemas)) {
        let relation = ''
        if (['parts', 'supplierProducts', 'stockItems'].includes(name)) {
          relation += ", materialId TEXT GENERATED ALWAYS AS (json_extract(record, '$.materialId')) STORED REFERENCES materials(id) DEFERRABLE INITIALLY DEFERRED"
        }
        if (name === 'supplierProducts') {
          relation += ", supplierId TEXT GENERATED ALWAYS AS (json_extract(record, '$.supplierId')) STORED REFERENCES suppliers(id) DEFERRABLE INITIALLY DEFERRED"
        }
        if (name === 'savedPlanContents') {
          relation += ', FOREIGN KEY(id) REFERENCES savedPlanSummaries(id) DEFERRABLE INITIALLY DEFERRED'
        }
        if (name === 'currentCuttingResults') {
          relation += ", planId TEXT GENERATED ALWAYS AS (json_extract(record, '$.planId')) STORED REFERENCES savedPlanSummaries(id) DEFERRABLE INITIALLY DEFERRED, FOREIGN KEY(id) REFERENCES projects(id) DEFERRABLE INITIALLY DEFERRED"
        }
        // Names come exclusively from the fixed schema registry, never from a request.
        db.exec(`CREATE TABLE "${name}" (id TEXT PRIMARY KEY NOT NULL, record TEXT NOT NULL CHECK(json_valid(record) AND json_extract(record, '$.id') = id)${relation}) STRICT`)
      }
      db.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, appliedAt TEXT NOT NULL) STRICT;
        INSERT INTO schema_migrations VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
        CREATE TABLE request_receipts (id TEXT PRIMARY KEY, hash TEXT NOT NULL, response TEXT NOT NULL, createdAt INTEGER NOT NULL) STRICT;
        CREATE INDEX request_receipts_age ON request_receipts(createdAt);
        CREATE INDEX saved_plans_project ON savedPlanSummaries(json_extract(record, '$.projectId'));
        CREATE INDEX confirmations_project ON cuttingConfirmations(json_extract(record, '$.projectId'));
        PRAGMA application_id = ${String(applicationId)}; PRAGMA user_version = 1;`)
    }
    const identity = db.prepare('PRAGMA application_id').get()
    if (!identity || identity.application_id !== applicationId) {
      throw new Error('This SQLite file is not an OptiCutList database.')
    }
    const migration = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()
    if (migration.length !== 1 || migration[0]?.version !== 1) {
      throw new Error('Inconsistent SQLite migration history.')
    }
    db.exec('COMMIT')
  } catch (error) {
    if (db.isTransaction) {
      db.exec('ROLLBACK')
    }
    db.close()
    throw error
  }

  type Scope = { active: boolean; firstFailure?: PersistenceError }
  const context = new AsyncLocalStorage<Scope>()
  let queue: Promise<void> = Promise.resolve()
  let closed = false
  async function transaction<T>(work: (repositories: Repositories) => Promise<PersistenceResult<T>>): Promise<PersistenceResult<T>> {
    const inherited = context.getStore()
    if (inherited) {
      if (!inherited.active) {
        return { ok: false, error: { kind: 'storageFailure', message: 'Expired server transaction.' } }
      }
      const result = await work(makeRepositories(inherited))
      if (!result.ok) {
        inherited.firstFailure ??= result.error
      }
      return result
    }
    const previous = queue
    let release: () => void = () => { }
    queue = new Promise<void>(resolve => {
      release = resolve
    })
    await previous
    try {
      if (closed) {
        throw new Error('Database closed')
      }
      db.exec('BEGIN IMMEDIATE')
      return await context.run({ active: true }, async () => {
        const scope = context.getStore()
        if (!scope) {
          throw new Error('Missing transaction context')
        }
        try {
          const result = await work(makeRepositories(scope))
          if (scope.firstFailure) {
            throw new Failure(scope.firstFailure)
          }
          if (!result.ok) {
            throw new Failure(result.error)
          }
          db.exec('COMMIT')
          return result
        } finally {
          scope.active = false
        }
      })
    } catch (error) {
      if (db.isTransaction) {
        db.exec('ROLLBACK')
      }
      return { ok: false, error: failure(error) }
    } finally {
      release()
    }
  }
  function run<T>(operation: () => T, boundScope?: Scope): Promise<PersistenceResult<T>> {
    if (boundScope && (!boundScope.active || context.getStore() !== boundScope)) {
      return Promise.resolve({ ok: false, error: { kind: 'storageFailure', message: 'Expired server transaction.' } })
    }
    const scope = context.getStore()
    if (!scope) {
      return transaction(async () => run(operation))
    }
    try {
      if (!scope.active) {
        throw new Error('Expired transaction')
      }
      if (scope.firstFailure) {
        throw new Failure(scope.firstFailure)
      }
      return Promise.resolve({ ok: true, value: operation() })
    } catch (error) {
      const detail = failure(error)
      scope.firstFailure ??= detail
      return Promise.resolve({ ok: false, error: detail })
    }
  }
  function repository<T extends { id: string }>(name: keyof typeof schemas, schema: z.ZodType<T>, idSchema: z.ZodType, scope?: Scope): Repository<T> {
    const execute = <V>(operation: () => V) => run(operation, scope)
    function get(id: T['id']): T {
      parse(idSchema, id)
      const row = db.prepare(`SELECT record FROM "${name}" WHERE id = ?`).get(id)
      if (!row) {
        throw new Failure({ kind: 'notFound', id })
      }
      return parse(schema, JSON.parse(recordRow.parse(row).record))
    }
    return {
      create: record => execute(() => {
        const entity = parse(schema, record)
        if (db.prepare(`SELECT id FROM "${name}" WHERE id = ?`).get(entity.id)) {
          throw new Failure({ kind: 'duplicateId', id: entity.id })
        }
        db.prepare(`INSERT INTO "${name}" (id, record) VALUES (?, ?)`).run(entity.id, JSON.stringify(entity))
        return entity
      }),
      get: id => execute(() => get(id)),
      update: (id, record) => execute(() => {
        const entity = parse(schema, record)
        if (entity.id !== parse(idSchema, id)) {
          throw new Failure({
            kind: 'invalidRecord',
            issues: [{ path: ['id'], message: 'An update cannot change the record ID' }]
          })
        }
        get(id)
        db.prepare(`UPDATE "${name}" SET record = ? WHERE id = ?`).run(JSON.stringify(entity), id)
        return entity
      }),
      delete: id => execute(() => {
        get(id)
        db.prepare(`DELETE FROM "${name}" WHERE id = ?`).run(id)
      }),
      list: () => execute(() => db.prepare(`SELECT record FROM "${name}"`)
        .all()
        .map(row => parse(schema, JSON.parse(recordRow.parse(row).record)))
        // Match IndexedDB string-key ordering, including non-ASCII IDs.
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    }
  }
  function optional<T extends { id: string }>(name: keyof typeof schemas, schema: z.ZodType<T>, repo: Repository<T>, idSchema: z.ZodType, scope?: Scope) {
    return {
      ...repo,
      find: (id: T['id']) => run(() => {
        parse(idSchema, id)
        const row = db.prepare(`SELECT record FROM "${name}" WHERE id = ?`).get(id)
        return row ? parse(schema, JSON.parse(recordRow.parse(row).record)) : null
      }, scope)
    }
  }
  function makeRepositories(scope?: Scope): Repositories {
    const summaries = repository('savedPlanSummaries', savedPlanSummarySchema, savedPlanSummarySchema.shape.id, scope)
    const confirmations = repository('cuttingConfirmations', cuttingConfirmationSchema, cuttingConfirmationSchema.shape.id, scope)
    return {
      materials: repository('materials', materialSchema, materialSchema.shape.id, scope),
      parts: repository('parts', partSchema, partSchema.shape.id, scope),
      suppliers: repository('suppliers', supplierSchema, supplierSchema.shape.id, scope),
      supplierProducts: repository('supplierProducts', supplierProductSchema, supplierProductSchema.shape.id, scope),
      stockItems: repository('stockItems', stockItemSchema, stockItemSchema.shape.id, scope),
      projects: repository('projects', cuttingProjectSchema, cuttingProjectSchema.shape.id, scope),
      savedPlanContents: repository('savedPlanContents', savedPlanContentsSchema, savedPlanContentsSchema.shape.id, scope),
      savedPlanSummaries: {
        ...summaries,
        listForProject: projectId => run(() => {
          parse(cuttingProjectIdSchema, projectId)
          return db.prepare("SELECT record FROM savedPlanSummaries WHERE json_extract(record, '$.projectId') = ?")
            .all(projectId)
            .map(row => parse(savedPlanSummarySchema, JSON.parse(recordRow.parse(row).record)))
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
        }, scope),
      },
      cuttingConfirmations: {
        ...optional('cuttingConfirmations', cuttingConfirmationSchema, confirmations, cuttingConfirmationSchema.shape.id, scope),
        listForProject: projectId => run(() => {
          parse(cuttingProjectIdSchema, projectId)
          return db.prepare("SELECT record FROM cuttingConfirmations WHERE json_extract(record, '$.projectId') = ?")
            .all(projectId)
            .map(row => parse(cuttingConfirmationSchema, JSON.parse(recordRow.parse(row).record)))
            .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
        }, scope),
      },
      currentCuttingResults: optional(
        'currentCuttingResults', currentCuttingResultSchema,
        repository('currentCuttingResults', currentCuttingResultSchema, currentCuttingResultSchema.shape.id, scope),
        currentCuttingResultSchema.shape.id, scope,
      ),
      projectStock: optional(
        'projectStock', projectStockSchema,
        repository('projectStock', projectStockSchema, projectStockSchema.shape.id, scope),
        projectStockSchema.shape.id, scope,
      ),
      stockOrders: repository('stockOrders', stockOrderSchema, stockOrderSchema.shape.id, scope),
      catalogOrders: repository('catalogOrders', catalogOrderSchema, catalogOrderSchema.shape.id, scope),
    }
  }
  const repositories = makeRepositories()
  const persistence: Persistence = {
    ...repositories,
    transaction,
    open: () => {
      if (closed) {
        return Promise.resolve({ ok: false, error: { kind: 'storageFailure', message: 'Server database is closed.' } })
      }
      return run(() => {
        if (db.prepare('SELECT version FROM schema_migrations WHERE version = 1').get()?.version !== 1) {
          throw new Error('SQLite migration metadata is unavailable.')
        }
      })
    },
    close: () => {
      closed = true
      db.close()
    },
  }
  async function command(id: string, hash: string, work: () => Promise<PersistenceResult<unknown>>): Promise<PersistenceResult<unknown>> {
    return transaction(async () => {
      const cached = db.prepare('SELECT hash, response FROM request_receipts WHERE id = ?').get(id)
      if (cached) {
        const receipt = cacheRow.parse(cached)
        if (receipt.hash !== hash) {
          return {
            ok: false,
            error: {
              kind: 'referenceConflict',
              message: 'This request identity was already used with different arguments.'
            }
          }
        }
        const value: unknown = JSON.parse(receipt.response)
        return { ok: true, value }
      }
      const result = await work()
      if (!result.ok) {
        return result
      }
      db.prepare('INSERT INTO request_receipts VALUES (?, ?, ?, ?)').run(id, hash, JSON.stringify(result.value ?? null), Date.now())
      db.prepare('DELETE FROM request_receipts WHERE createdAt < ?').run(Date.now() - 30 * 24 * 60 * 60 * 1000)
      return result
    })
  }
  return { persistence, command }
}
