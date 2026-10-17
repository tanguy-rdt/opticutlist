import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import * as database from '../../infrastructure/persistence/local-database'
import { createConfiguredStorage } from '../persistence'
import { materialSchema } from '../../domain/model/material'

const createBrowserPersistence = database.createLocalPersistence

beforeEach(() => {
  const indexedDB = new IDBFactory()
  // Preserve real repository behavior while isolating the browser database between tests.
  vi.spyOn(database, 'createLocalPersistence').mockImplementation(name =>
    createBrowserPersistence(name, { indexedDB, IDBKeyRange }))
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Server unavailable')))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('deployment storage selection', () => {
  it.each([undefined, 'browser'])('uses browser persistence without contacting a backend for mode %s', async mode => {
    const storage = createConfiguredStorage(mode)
    try {
      const material = materialSchema.parse({ id: 'm', name: 'MDF', category: 'Panels' })
      expect(await storage.services.catalog.materials.create(material)).toEqual({ ok: true, value: material })
      expect(await storage.services.catalog.materials.list()).toEqual({ ok: true, value: [material] })
      expect(database.createLocalPersistence).toHaveBeenCalledWith()
      expect(fetch).not.toHaveBeenCalled()
      expect(database.DATABASE_NAME).toBe('opticutlist')
      expect(database.DATABASE_VERSION).toBe(8)
    } finally {
      storage.close()
    }
  })

  it('reports a server failure without opening browser storage', async () => {
    const storage = createConfiguredStorage('server')
    try {
      const result = await storage.services.stock.list()
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('Expected unavailable storage')
      expect(result.error.kind).toBe('storageFailure')
      expect(database.createLocalPersistence).not.toHaveBeenCalled()
      expect(fetch).toHaveBeenCalledTimes(1)
    } finally {
      storage.close()
    }
  })

  it('rejects unsupported configuration before opening either backend', () => {
    expect(() => createConfiguredStorage('automatic')).toThrow('Unsupported VITE_STORAGE_MODE')
    expect(database.createLocalPersistence).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})
