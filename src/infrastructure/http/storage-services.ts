import type { z } from 'zod'
import { operations, responseEnvelope } from '../../application/storage/api-contract'
import type { PersistenceResult } from '../../application/persistence/repositories'
import type { StorageServices } from '../../application/storage/services'
import { prepareSavedPlan } from '../../application/plans/saved-plan-service'
import { savedCuttingPlanIdSchema } from '../../domain/model/ids'

const REQUEST_TIMEOUT_MS = 30_000

/** Remote service operations, never remote transaction callbacks or raw database writes. */
export function createHttpStorageServices(base = '/api/v1/'): StorageServices {
  async function call<A, T>(name: string, contract: { method: string; args: z.ZodType<A>; value: z.ZodType<T> }, args: NoInfer<A>): Promise<PersistenceResult<T>> {
    const controller = new AbortController()
    const timeout = setTimeout(() => { controller.abort() }, REQUEST_TIMEOUT_MS)
    try {
      const parsed = contract.args.safeParse(args)
      if (!parsed.success) {
        return { ok: false, error: { kind: 'invalidRecord', issues: parsed.error.issues } }
      }
      const values: unknown = parsed.data
      const compact: unknown = Array.isArray(values) ? Array.from<unknown>(values) : values
      if (Array.isArray(compact)) {
        while (compact.length && compact.at(-1) === undefined) {
          compact.pop()
        }
      }
      const serialized = JSON.stringify(compact)
      const url = base + name.replaceAll('.', '/')
      const response = await fetch(contract.method === 'GET' ? `${url}?args=${encodeURIComponent(serialized)}` : url, {
        method: contract.method,
        credentials: 'same-origin',
        signal: controller.signal,
        headers: contract.method === 'GET' ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), 'X-OptiCutList': '1' },
        ...(contract.method === 'GET' ? {} : { body: serialized }),
      })
      const raw: unknown = await response.json()
      const envelope = responseEnvelope.parse(raw)
      if (!envelope.ok) {
        return envelope
      }
      if (!response.ok) {
        throw new Error('Unexpected API response status')
      }
      return { ok: true, value: contract.value.parse(envelope.value ?? null) }
    } catch {
      return {
        ok: false,
        error: {
          kind: 'storageFailure',
          message: controller.signal.aborted
            ? 'Server storage request timed out. Reload before retrying a change; it may already have committed.'
            : 'Server storage is unavailable or returned invalid data. Check the connection and reload before retrying a change; it may already have committed.'
        }
      }
    } finally {
      clearTimeout(timeout)
    }
  }
  return {
    catalog: {
      materials: {
        list: () => call('catalog.materials.list', operations['catalog.materials.list'], []),
        get: (id) => call('catalog.materials.get', operations['catalog.materials.get'], [id]),
        create: (record) => call('catalog.materials.create', operations['catalog.materials.create'], [record]),
        update: (id, record) => call('catalog.materials.update', operations['catalog.materials.update'], [id, record]),
        delete: (id) => call('catalog.materials.delete', operations['catalog.materials.delete'], [id]),
      },
      suppliers: {
        list: () => call('catalog.suppliers.list', operations['catalog.suppliers.list'], []),
        get: (id) => call('catalog.suppliers.get', operations['catalog.suppliers.get'], [id]),
        create: (record) => call('catalog.suppliers.create', operations['catalog.suppliers.create'], [record]),
        update: (id, record) => call('catalog.suppliers.update', operations['catalog.suppliers.update'], [id, record]),
        delete: (id) => call('catalog.suppliers.delete', operations['catalog.suppliers.delete'], [id]),
      },
      supplierProducts: {
        list: () => call('catalog.products.list', operations['catalog.products.list'], []),
        get: (id) => call('catalog.products.get', operations['catalog.products.get'], [id]),
        create: (record) => call('catalog.products.create', operations['catalog.products.create'], [record]),
        update: (id, record) => call('catalog.products.update', operations['catalog.products.update'], [id, record]),
        delete: (id) => call('catalog.products.delete', operations['catalog.products.delete'], [id]),
        ordering: () => call('catalog.products.ordering', operations['catalog.products.ordering'], []),
        move: (id, target, position) => call('catalog.products.move', operations['catalog.products.move'], [id, target, position]),
        saveWithPreset: (record, preset, id) => call('catalog.products.saveWithPreset', operations['catalog.products.saveWithPreset'], [record, preset, id]),
      },
    },
    stock: {
      list: () => call('stock.list', operations['stock.list'], []),
      get: (id) => call('stock.get', operations['stock.get'], [id]),
      create: (record) => call('stock.create', operations['stock.create'], [record]),
      update: (id, record, previous) => call('stock.update', operations['stock.update'], [id, record, previous]),
      delete: (id, previous) => call('stock.delete', operations['stock.delete'], [id, previous]),
      ordering: () => call('stock.ordering', operations['stock.ordering'], []),
      move: (id, target, position) => call('stock.move', operations['stock.move'], [id, target, position]),
      saveWithPreset: (record, preset, previous) => call('stock.saveWithPreset', operations['stock.saveWithPreset'], [record, preset, previous]),
      addFromProduct: (product, quantity) => call('stock.addFromProduct', operations['stock.addFromProduct'], [product, quantity]),
      selectionStock: (id) => call('stock.selectionStock', operations['stock.selectionStock'], [id]),
      planningStock: (id) => call('stock.planningStock', operations['stock.planningStock'], [id]),
      history: (id) => call('stock.history', operations['stock.history'], [id]),
    },
    projects: {
      projects: {
        list: () => call('projects.records.list', operations['projects.records.list'], []),
        get: (id) => call('projects.records.get', operations['projects.records.get'], [id]),
        create: (record) => call('projects.records.create', operations['projects.records.create'], [record]),
        update: (id, record) => call('projects.records.update', operations['projects.records.update'], [id, record]),
        delete: (id) => call('projects.records.delete', operations['projects.records.delete'], [id]),
      },
      deletionPreview: (id) => call('projects.deletionPreview', operations['projects.deletionPreview'], [id]),
      deleteProject: (id, handling) => call('projects.delete', operations['projects.delete'], [id, handling]),
      listLegacyParts: () => call('projects.legacyParts', operations['projects.legacyParts'], []),
      adoptLegacyParts: (id, ids) => call('projects.adopt', operations['projects.adopt'], [id, [...ids]]),
      parts: projectId => ({
        list: () => call('parts.list', operations['parts.list'], [projectId]),
        get: (id) => call('parts.get', operations['parts.get'], [projectId, id]),
        create: (record) => call('parts.create', operations['parts.create'], [projectId, record]),
        createMany: (records) => call('parts.createMany', operations['parts.createMany'], [projectId, [...records]]),
        update: (id, record) => call('parts.update', operations['parts.update'], [projectId, id, record]),
        delete: (id) => call('parts.delete', operations['parts.delete'], [projectId, id]),
      }),
    },
    currentResults: {
      forProject: projectId => ({
        load: () => call('current.load', operations['current.load'], [projectId]),
        replace: async (input, signal) => {
          if (signal?.aborted) {
            return {
              ok: false,
              error: { kind: 'referenceConflict', message: 'The result changed before transmission.' }
            }
          }
          const prepared = prepareSavedPlan({
            id: savedCuttingPlanIdSchema.parse(crypto.randomUUID()),
            projectId,
            name: 'Transport snapshot',
            createdAt: new Date().toISOString()
          }, input)
          if (!prepared.ok) {
            return prepared
          }
          return call('current.replace', operations['current.replace'], [projectId, prepared.value.contents, [...input.editedPanelIndices]])
        },
      })
    },
    projectStock: {
      forProject: projectId => ({
        preview: () => call('projectStock.preview', operations['projectStock.preview'], [projectId]),
        sync: () => call('projectStock.sync', operations['projectStock.sync'], [projectId]),
        setKeep: (key, keep) => call('projectStock.setKeep', operations['projectStock.setKeep'], [projectId, key, keep]),
      })
    },
    confirmations: {
      forProject: projectId => ({
        list: () => call('confirmations.list', operations['confirmations.list'], [projectId]),
        preview: (id) => call('confirmations.preview', operations['confirmations.preview'], [projectId, id]),
        confirm: (id, input) => call('confirmations.confirm', operations['confirmations.confirm'], [projectId, id, input]),
      })
    },
    catalogTransfer: {
      export: () => call('catalogTransfer.export', operations['catalogTransfer.export'], []),
      preview: (text) => call('catalogTransfer.preview', operations['catalogTransfer.preview'], [text]),
      import: (file, confirmed) => call('catalogTransfer.import', operations['catalogTransfer.import'], [file, confirmed]),
    },
    stockTransfer: {
      export: () => call('stockTransfer.export', operations['stockTransfer.export'], []),
      preview: (text) => call('stockTransfer.preview', operations['stockTransfer.preview'], [text]),
      import: (file, confirmed) => call('stockTransfer.import', operations['stockTransfer.import'], [file, confirmed]),
    },
    projectTransfer: {
      export: (id) => call('projectTransfer.export', operations['projectTransfer.export'], [id]),
      preview: (text) => call('projectTransfer.preview', operations['projectTransfer.preview'], [text]),
      import: (file, confirmed) => call('projectTransfer.import', operations['projectTransfer.import'], [file, confirmed]),
    },
    partsTransfer: {
      preview: (id, text) => call('partsTransfer.preview', operations['partsTransfer.preview'], [id, text]),
      import: (id, file, materials, confirmed) => call('partsTransfer.import', operations['partsTransfer.import'], [id, file, [...materials], confirmed]),
    },
  }
}
