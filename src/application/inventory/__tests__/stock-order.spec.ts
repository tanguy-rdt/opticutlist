// @vitest-environment node
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { createLocalPersistence, DATABASE_V6_STORES } from '../../../infrastructure/persistence/local-database'
import { createStockRepository } from '../stock-repository'
import { orderStockItems, stockOrderSchema } from '../stock-order'
import { stockItemSchema } from '../../../domain/model/stock-item'
import { validStockItemInput, validMaterialInput } from '../../../domain/model/__tests__/fixtures'
import type { PersistenceResult } from '../../persistence/repositories'

const connections: { close(): void }[] = []
afterEach(() => { connections.forEach(connection => { connection.close() }); connections.length = 0; vi.restoreAllMocks() })
function value<T>(result: PersistenceResult<T>): T { if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.value }
const a = stockItemSchema.parse({ ...validStockItemInput, id: 'a' })
const b = stockItemSchema.parse({ ...a, id: 'b', kind: 'offcut', quantity: 4 })
const c = stockItemSchema.parse({ ...a, id: 'c' })
async function setup() {
  const indexedDB = new IDBFactory()
  const persistence = createLocalPersistence('stock-order', { indexedDB, IDBKeyRange }); connections.push(persistence)
  value(await persistence.materials.create(validMaterialInput))
  for (const item of [c, a, b]) value(await persistence.stockItems.create(item))
  return { indexedDB, persistence, repository: createStockRepository(persistence) }
}
describe('physical stock presentation order', () => {
  it('uses deterministic ID defaults, explicit ranks and ignores stale ordering identities', () => {
    expect(orderStockItems([c, a, b], []).map(item => item.id)).toEqual(['a', 'b', 'c'])
    const order = stockOrderSchema.parse({ id: a.materialId, stockItemIds: ['removed', c.id, b.id] })
    expect(orderStockItems([a, b, c], [order]).map(item => item.id)).toEqual(['c', 'b', 'a'])
    expect(stockOrderSchema.safeParse({ id: a.materialId, stockItemIds: [a.id, a.id] }).success).toBe(false)
  })
  it('persists before/after moves and leaves stock, quantities and history untouched after reopening', async () => {
    const { indexedDB, persistence, repository } = await setup()
    const before = value(await persistence.stockItems.list())
    value(await repository.move(c.id, a.id, 'before'))
    value(await repository.move(a.id, b.id, 'after'))
    expect(orderStockItems(before, value(await repository.ordering())).map(item => item.id)).toEqual(['c', 'b', 'a'])
    persistence.close()
    const reopened = createLocalPersistence('stock-order', { indexedDB, IDBKeyRange }); connections.push(reopened)
    const records = value(await reopened.stockItems.list())
    expect(records).toEqual(before)
    expect(orderStockItems(records, value(await createStockRepository(reopened).ordering())).map(item => item.id)).toEqual(['c', 'b', 'a'])
    expect(value(await reopened.projectStock.list())).toEqual([])
    expect(value(await reopened.cuttingConfirmations.list())).toEqual([])
  })
  it('rechecks group membership and rejects missing or cross-material moves without writes', async () => {
    const { persistence, repository } = await setup()
    const other = stockItemSchema.parse({ ...a, id: 'other', materialId: 'other-material' })
    value(await persistence.stockItems.create(other))
    expect(await repository.move(a.id, other.id, 'before')).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    expect(await repository.move(a.id, b.id, 'before')).toMatchObject({ ok: true })
    value(await persistence.stockItems.delete(b.id))
    const before = await repository.ordering()
    expect(await repository.move(a.id, b.id, 'after')).toMatchObject({ ok: false, error: { kind: 'notFound' } })
    expect(await repository.ordering()).toEqual(before)
  })
  it('does not change order when persistence fails', async () => {
    const { persistence, repository } = await setup()
    const transaction = persistence.transaction.bind(persistence)
    vi.spyOn(persistence, 'transaction').mockImplementation(work => transaction(repositories => work({ ...repositories, stockOrders: { ...repositories.stockOrders, create: () => Promise.resolve({ ok: false, error: { kind: 'storageFailure', message: 'Disk full' } }) } })))
    expect(await repository.move(c.id, a.id, 'before')).toMatchObject({ ok: false })
    expect(value(await repository.ordering())).toEqual([])
    expect(value(await repository.list())).toEqual([a, b, c])
  })
  it('upgrades version 6 additively without rewriting inventory or other records', async () => {
    const indexedDB = new IDBFactory()
    const old = new Dexie('order-upgrade', { indexedDB, IDBKeyRange }); old.version(6).stores(DATABASE_V6_STORES)
    await old.table('materials').add(validMaterialInput); await old.table('stockItems').add(a)
    const before = await old.table('stockItems').toArray(); old.close()
    const upgraded = createLocalPersistence('order-upgrade', { indexedDB, IDBKeyRange }); connections.push(upgraded)
    expect(value(await upgraded.stockItems.list())).toEqual(before)
    expect(value(await upgraded.materials.list())).toEqual([validMaterialInput])
    expect(value(await upgraded.stockOrders.list())).toEqual([])
  })
})
