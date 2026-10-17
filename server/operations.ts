import type { z } from 'zod'
import { operations } from '../src/application/storage/api-contract'
import type { StorageServices } from '../src/application/storage/services'
import type { PersistenceResult } from '../src/application/persistence/repositories'
import { restoreSavedPlan } from '../src/application/plans/saved-plan-codec'

function handle<A, T>(args: z.ZodType<A>, run: (input: A) => Promise<PersistenceResult<T>>) {
  return async (input: unknown): Promise<PersistenceResult<unknown>> => {
    const parsed = args.safeParse(input)
    if (!parsed.success) {
      return {
        ok: false,
        error: { kind: 'invalidRecord', issues: parsed.error.issues.map(({ path, message }) => ({ path, message })) }
      }
    }
    return run(parsed.data)
  }
}
export function createHandlers(services: StorageServices) {
  const handlers: Record<string, { method: string; execute: (args: unknown) => Promise<PersistenceResult<unknown>> }> = {
    'catalog/materials/list': {
      method: operations['catalog.materials.list'].method,
      execute: handle(operations['catalog.materials.list'].args, () => services.catalog.materials.list())
    },
    'catalog/materials/get': {
      method: operations['catalog.materials.get'].method,
      execute: handle(operations['catalog.materials.get'].args, args => services.catalog.materials.get(args[0]))
    },
    'catalog/materials/create': {
      method: operations['catalog.materials.create'].method,
      execute: handle(operations['catalog.materials.create'].args, args => services.catalog.materials.create(args[0]))
    },
    'catalog/materials/update': {
      method: operations['catalog.materials.update'].method,
      execute: handle(operations['catalog.materials.update'].args, args => services.catalog.materials.update(args[0], args[1]))
    },
    'catalog/materials/delete': {
      method: operations['catalog.materials.delete'].method,
      execute: handle(operations['catalog.materials.delete'].args, args => services.catalog.materials.delete(args[0]))
    },
    'catalog/suppliers/list': {
      method: operations['catalog.suppliers.list'].method,
      execute: handle(operations['catalog.suppliers.list'].args, () => services.catalog.suppliers.list())
    },
    'catalog/suppliers/get': {
      method: operations['catalog.suppliers.get'].method,
      execute: handle(operations['catalog.suppliers.get'].args, args => services.catalog.suppliers.get(args[0]))
    },
    'catalog/suppliers/create': {
      method: operations['catalog.suppliers.create'].method,
      execute: handle(operations['catalog.suppliers.create'].args, args => services.catalog.suppliers.create(args[0]))
    },
    'catalog/suppliers/update': {
      method: operations['catalog.suppliers.update'].method,
      execute: handle(operations['catalog.suppliers.update'].args, args => services.catalog.suppliers.update(args[0], args[1]))
    },
    'catalog/suppliers/delete': {
      method: operations['catalog.suppliers.delete'].method,
      execute: handle(operations['catalog.suppliers.delete'].args, args => services.catalog.suppliers.delete(args[0]))
    },
    'catalog/products/list': {
      method: operations['catalog.products.list'].method,
      execute: handle(operations['catalog.products.list'].args, () => services.catalog.supplierProducts.list())
    },
    'catalog/products/get': {
      method: operations['catalog.products.get'].method,
      execute: handle(operations['catalog.products.get'].args, args => services.catalog.supplierProducts.get(args[0]))
    },
    'catalog/products/create': {
      method: operations['catalog.products.create'].method,
      execute: handle(operations['catalog.products.create'].args, args => services.catalog.supplierProducts.create(args[0]))
    },
    'catalog/products/update': {
      method: operations['catalog.products.update'].method,
      execute: handle(operations['catalog.products.update'].args, args => services.catalog.supplierProducts.update(args[0], args[1]))
    },
    'catalog/products/delete': {
      method: operations['catalog.products.delete'].method,
      execute: handle(operations['catalog.products.delete'].args, args => services.catalog.supplierProducts.delete(args[0]))
    },
    'projects/records/list': {
      method: operations['projects.records.list'].method,
      execute: handle(operations['projects.records.list'].args, () => services.projects.projects.list())
    },
    'projects/records/get': {
      method: operations['projects.records.get'].method,
      execute: handle(operations['projects.records.get'].args, args => services.projects.projects.get(args[0]))
    },
    'projects/records/create': {
      method: operations['projects.records.create'].method,
      execute: handle(operations['projects.records.create'].args, args => services.projects.projects.create(args[0]))
    },
    'projects/records/update': {
      method: operations['projects.records.update'].method,
      execute: handle(operations['projects.records.update'].args, args => services.projects.projects.update(args[0], args[1]))
    },
    'projects/records/delete': {
      method: operations['projects.records.delete'].method,
      execute: handle(operations['projects.records.delete'].args, args => services.projects.projects.delete(args[0]))
    },
    'stock/list': {
      method: operations['stock.list'].method,
      execute: handle(operations['stock.list'].args, () => services.stock.list())
    },
    'stock/get': {
      method: operations['stock.get'].method,
      execute: handle(operations['stock.get'].args, args => services.stock.get(args[0]))
    },
    'stock/create': {
      method: operations['stock.create'].method,
      execute: handle(operations['stock.create'].args, args => services.stock.create(args[0]))
    },
    'stock/update': {
      method: operations['stock.update'].method,
      execute: handle(operations['stock.update'].args, args => services.stock.update(args[0], args[1], args[2]))
    },
    'stock/delete': {
      method: operations['stock.delete'].method,
      execute: handle(operations['stock.delete'].args, args => services.stock.delete(args[0], args[1]))
    },
    'parts/list': {
      method: operations['parts.list'].method,
      execute: handle(operations['parts.list'].args, args => services.projects.parts(args[0]).list())
    },
    'parts/get': {
      method: operations['parts.get'].method,
      execute: handle(operations['parts.get'].args, args => services.projects.parts(args[0]).get(args[1]))
    },
    'parts/create': {
      method: operations['parts.create'].method,
      execute: handle(operations['parts.create'].args, args => services.projects.parts(args[0]).create(args[1]))
    },
    'parts/createMany': {
      method: operations['parts.createMany'].method,
      execute: handle(operations['parts.createMany'].args, args => services.projects.parts(args[0]).createMany(args[1]))
    },
    'parts/update': {
      method: operations['parts.update'].method,
      execute: handle(operations['parts.update'].args, args => services.projects.parts(args[0]).update(args[1], args[2]))
    },
    'parts/delete': {
      method: operations['parts.delete'].method,
      execute: handle(operations['parts.delete'].args, args => services.projects.parts(args[0]).delete(args[1]))
    },
    'projects/deletionPreview': {
      method: operations['projects.deletionPreview'].method,
      execute: handle(operations['projects.deletionPreview'].args, args => services.projects.deletionPreview(args[0]))
    },
    'projects/delete': {
      method: operations['projects.delete'].method,
      execute: handle(operations['projects.delete'].args, args => services.projects.deleteProject(args[0], args[1]))
    },
    'projects/legacyParts': {
      method: operations['projects.legacyParts'].method,
      execute: handle(operations['projects.legacyParts'].args, () => services.projects.listLegacyParts())
    },
    'projects/adopt': {
      method: operations['projects.adopt'].method,
      execute: handle(operations['projects.adopt'].args, args => services.projects.adoptLegacyParts(args[0], args[1]))
    },
    'catalog/products/ordering': {
      method: operations['catalog.products.ordering'].method,
      execute: handle(operations['catalog.products.ordering'].args, () => services.catalog.supplierProducts.ordering())
    },
    'catalog/products/move': {
      method: operations['catalog.products.move'].method,
      execute: handle(operations['catalog.products.move'].args, args => services.catalog.supplierProducts.move(args[0], args[1], args[2]))
    },
    'catalog/products/saveWithPreset': {
      method: operations['catalog.products.saveWithPreset'].method,
      execute: handle(operations['catalog.products.saveWithPreset'].args, args => services.catalog.supplierProducts.saveWithPreset(args[0], args[1], args[2]))
    },
    'stock/ordering': {
      method: operations['stock.ordering'].method,
      execute: handle(operations['stock.ordering'].args, () => services.stock.ordering())
    },
    'stock/move': {
      method: operations['stock.move'].method,
      execute: handle(operations['stock.move'].args, args => services.stock.move(args[0], args[1], args[2]))
    },
    'stock/addFromProduct': {
      method: operations['stock.addFromProduct'].method,
      execute: handle(operations['stock.addFromProduct'].args, args => services.stock.addFromProduct(args[0], args[1]))
    },
    'stock/saveWithPreset': {
      method: operations['stock.saveWithPreset'].method,
      execute: handle(operations['stock.saveWithPreset'].args, args => services.stock.saveWithPreset(args[0], args[1], args[2]))
    },
    'stock/selectionStock': {
      method: operations['stock.selectionStock'].method,
      execute: handle(operations['stock.selectionStock'].args, args => services.stock.selectionStock(args[0]))
    },
    'stock/planningStock': {
      method: operations['stock.planningStock'].method,
      execute: handle(operations['stock.planningStock'].args, args => services.stock.planningStock(args[0]))
    },
    'stock/history': {
      method: operations['stock.history'].method,
      execute: handle(operations['stock.history'].args, args => services.stock.history(args[0]))
    },
    'current/load': {
      method: operations['current.load'].method,
      execute: handle(operations['current.load'].args, args => services.currentResults.forProject(args[0]).load())
    },
    'current/replace': {
      method: operations['current.replace'].method,
      execute: handle(operations['current.replace'].args, args => {
        try {
          return services.currentResults.forProject(args[0]).replace({
            parts: args[1].parts,
            settings: args[1].settings,
            sources: args[1].sources,
            plan: restoreSavedPlan(args[1]),
            editedPanelIndices: args[2],
          })
        } catch {
          return Promise.resolve({
            ok: false,
            error: {
              kind: 'invalidRecord',
              issues: [{ path: ['plan'], message: 'The submitted cutting tree or copy accounting is invalid. Recompute the plan before saving.' }],
            },
          })
        }
      })
    },
    'projectStock/preview': {
      method: operations['projectStock.preview'].method,
      execute: handle(operations['projectStock.preview'].args, args => services.projectStock.forProject(args[0]).preview())
    },
    'projectStock/sync': {
      method: operations['projectStock.sync'].method,
      execute: handle(operations['projectStock.sync'].args, args => services.projectStock.forProject(args[0]).sync())
    },
    'projectStock/setKeep': {
      method: operations['projectStock.setKeep'].method,
      execute: handle(operations['projectStock.setKeep'].args, args => services.projectStock.forProject(args[0]).setKeep(args[1], args[2]))
    },
    'confirmations/list': {
      method: operations['confirmations.list'].method,
      execute: handle(operations['confirmations.list'].args, args => services.confirmations.forProject(args[0]).list())
    },
    'confirmations/preview': {
      method: operations['confirmations.preview'].method,
      execute: handle(operations['confirmations.preview'].args, args => services.confirmations.forProject(args[0]).preview(args[1]))
    },
    'confirmations/confirm': {
      method: operations['confirmations.confirm'].method,
      execute: handle(operations['confirmations.confirm'].args, args => services.confirmations.forProject(args[0]).confirm(args[1], args[2]))
    },
    'catalogTransfer/export': {
      method: operations['catalogTransfer.export'].method,
      execute: handle(operations['catalogTransfer.export'].args, () => services.catalogTransfer.export())
    },
    'catalogTransfer/preview': {
      method: operations['catalogTransfer.preview'].method,
      execute: handle(operations['catalogTransfer.preview'].args, args => services.catalogTransfer.preview(args[0]))
    },
    'catalogTransfer/import': {
      method: operations['catalogTransfer.import'].method,
      execute: handle(operations['catalogTransfer.import'].args, args => services.catalogTransfer.import(args[0], args[1]))
    },
    'stockTransfer/export': {
      method: operations['stockTransfer.export'].method,
      execute: handle(operations['stockTransfer.export'].args, () => services.stockTransfer.export())
    },
    'stockTransfer/preview': {
      method: operations['stockTransfer.preview'].method,
      execute: handle(operations['stockTransfer.preview'].args, args => services.stockTransfer.preview(args[0]))
    },
    'stockTransfer/import': {
      method: operations['stockTransfer.import'].method,
      execute: handle(operations['stockTransfer.import'].args, args => services.stockTransfer.import(args[0], args[1]))
    },
    'projectTransfer/export': {
      method: operations['projectTransfer.export'].method,
      execute: handle(operations['projectTransfer.export'].args, args => services.projectTransfer.export(args[0]))
    },
    'projectTransfer/preview': {
      method: operations['projectTransfer.preview'].method,
      execute: handle(operations['projectTransfer.preview'].args, args => services.projectTransfer.preview(args[0]))
    },
    'projectTransfer/import': {
      method: operations['projectTransfer.import'].method,
      execute: handle(operations['projectTransfer.import'].args, args => services.projectTransfer.import(args[0], args[1]))
    },
    'partsTransfer/preview': {
      method: operations['partsTransfer.preview'].method,
      execute: handle(operations['partsTransfer.preview'].args, args => services.partsTransfer.preview(args[0], args[1]))
    },
    'partsTransfer/import': {
      method: operations['partsTransfer.import'].method,
      execute: handle(operations['partsTransfer.import'].args, args => services.partsTransfer.import(args[0], args[1], args[2], args[3]))
    },
  }
  return handlers
}
