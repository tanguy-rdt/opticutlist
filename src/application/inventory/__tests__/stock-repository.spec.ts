// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { createLocalPersistence } from '../../../infrastructure/persistence/local-database'
import { createStockRepository } from '../stock-repository'
import { stockItemSchema } from '../../../domain/model/stock-item'
import { validMaterialInput, validStockItemInput } from '../../../domain/model/__tests__/fixtures'
import { materialSchema } from '../../../domain/model/material'
import { cuttingConfirmationSchema } from '../../../domain/model/cutting-confirmation'

const connections: { close(): void }[] = []
afterEach(() => { connections.forEach(connection => { connection.close() }); connections.length = 0; vi.restoreAllMocks() })
const stock = stockItemSchema.parse({ ...validStockItemInput, kind: 'fullPanel', quantity: 3 })
async function setup() {
  const indexedDB = new IDBFactory()
  const persistence = createLocalPersistence('stock-test', { indexedDB, IDBKeyRange }); connections.push(persistence)
  await persistence.materials.create(validMaterialInput)
  return { indexedDB, persistence, repository: createStockRepository(persistence) }
}
describe('guarded manual inventory', () => {
  it.each(['fullPanel', 'offcut'] as const)('creates, reads, adjusts and deletes %s stock with stable IDs after reopening', async kind => {
    const { indexedDB, persistence, repository } = await setup()
    const item = { ...stock, kind }
    expect(await repository.create(item)).toEqual({ ok: true, value: item })
    expect(await repository.create(item)).toMatchObject({ ok: false, error: { kind: 'duplicateId' } })
    const edited = { ...item, quantity: 7, lengthMm: 900 }
    expect(await repository.update(stock.id, edited, item)).toEqual({ ok: true, value: edited })
    persistence.close()
    const reopened = createLocalPersistence('stock-test', { indexedDB, IDBKeyRange }); connections.push(reopened)
    const second = createStockRepository(reopened)
    expect(await second.get(stock.id)).toEqual({ ok: true, value: edited })
    expect(await second.list()).toEqual({ ok: true, value: [edited] })
    expect(await second.delete(stock.id, edited)).toEqual({ ok: true, value: undefined })
    expect(await second.get(stock.id)).toMatchObject({ ok: false, error: { kind: 'notFound' } })
  })
  it.each([{ lengthMm: 0 }, { widthMm: -1 }, { thicknessMm: undefined }, { thicknessMm: Infinity }, { quantity: 0 }, { quantity: 1.5 }, { grainDirection: 'diagonal' }])('rejects invalid physical records %j', async fields => {
    const { repository } = await setup()
    expect(await repository.create({ ...stock, ...fields })).toMatchObject({ ok: false, error: { kind: 'invalidRecord' } })
    expect(await repository.list()).toEqual({ ok: true, value: [] })
  })
  it('checks material references and rejects forged cutting or purchase provenance', async () => {
    const { repository } = await setup()
    expect(await repository.create({ ...stock, materialId: 'missing-material' })).toMatchObject({ ok: false, error: { kind: 'notFound' } })
    expect(await repository.create({ ...stock, provenance: { source: 'purchase', supplierProductId: 'product' } })).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    expect(await repository.list()).toEqual({ ok: true, value: [] })
  })
  it('resolves presets atomically without requiring suppliers and reuses only canonical identity', async () => {
    const { persistence, repository } = await setup()
    await persistence.materials.create(materialSchema.parse({ id: 'custom-pin', name: 'Pin', category: 'Softwoods' }))
    const outcomes = await Promise.all([repository.saveWithPreset(stock, 'pin'), repository.saveWithPreset({ ...stock, id: 'second' }, 'pin')])
    expect(outcomes.every(outcome => outcome.ok)).toBe(true)
    const materials = await persistence.materials.list()
    expect(materials.ok && materials.value.filter(material => material.libraryPresetId === 'pin')).toHaveLength(1)
    if (!outcomes[0].ok || !outcomes[1].ok) throw new Error('Expected stock records')
    expect(outcomes[0].value.materialId).toBe(outcomes[1].value.materialId)
    expect(outcomes[0].value.materialId).not.toBe('custom-pin')
    expect(await persistence.suppliers.list()).toEqual({ ok: true, value: [] })
    expect(await persistence.supplierProducts.list()).toEqual({ ok: true, value: [] })
  })
  it('rolls back preset creation on duplicate stock IDs or storage failure', async () => {
    const { persistence, repository } = await setup()
    await repository.create(stock)
    expect(await repository.saveWithPreset(stock, 'chene')).toMatchObject({ ok: false, error: { kind: 'duplicateId' } })
    expect(await persistence.materials.list()).toMatchObject({ ok: true, value: [validMaterialInput] })
    const transaction = persistence.transaction.bind(persistence)
    vi.spyOn(persistence, 'transaction').mockImplementation(work => transaction(repositories => work({ ...repositories, stockItems: { ...repositories.stockItems, create: () => Promise.resolve({ ok: false, error: { kind: 'storageFailure', message: 'Disk full' } }) } })))
    expect(await repository.saveWithPreset({ ...stock, id: 'new-stock' }, 'pin')).toMatchObject({ ok: false, error: { kind: 'storageFailure' } })
    expect(await persistence.materials.list()).toMatchObject({ ok: true, value: [validMaterialInput] })
    expect(await persistence.stockItems.list()).toEqual({ ok: true, value: [stock] })
  })
  it('rejects stale drafts after a concurrent deduction and never recreates a deleted item', async () => {
    const { persistence, repository } = await setup()
    await repository.create(stock)
    await persistence.stockItems.update(stock.id, { ...stock, quantity: 1 })
    expect(await repository.update(stock.id, { ...stock, quantity: 5 }, stock)).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    expect(await repository.delete(stock.id, stock)).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    await persistence.stockItems.delete(stock.id)
    expect(await repository.update(stock.id, stock, stock)).toMatchObject({ ok: false, error: { kind: 'notFound' } })
    expect(await repository.list()).toEqual({ ok: true, value: [] })
  })
  it('preserves immutable receipts and purchase provenance through manual corrections and deletion', async () => {
    const { persistence, repository } = await setup()
    const purchased = stockItemSchema.parse({ ...stock, provenance: { source: 'purchase', supplierProductId: 'old-product' } })
    await persistence.stockItems.create(purchased)
    const receipt = cuttingConfirmationSchema.parse({ id: 'historical-cut', projectId: 'project', confirmedAt: '2026-10-11T12:00:00.000Z', consumed: [{ stock: purchased, quantity: 1, panelIndices: [0] }], offcuts: [] })
    await persistence.cuttingConfirmations.create(receipt)
    expect(await repository.update(stock.id, { ...purchased, provenance: { source: 'manual' } }, purchased)).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    const edited = { ...purchased, quantity: 2 }
    expect(await repository.update(stock.id, edited, purchased)).toEqual({ ok: true, value: edited })
    expect(await repository.history(stock.id)).toEqual({ ok: true, value: [receipt] })
    await repository.delete(stock.id, edited)
    expect(await repository.history(stock.id)).toEqual({ ok: true, value: [receipt] })
    expect(await repository.create(stock)).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    expect(await persistence.cuttingConfirmations.list()).toEqual({ ok: true, value: [receipt] })
  })
})
