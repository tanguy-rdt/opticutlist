import { createLocalPersistence } from '../infrastructure/persistence/local-database'
import { createHttpStorageServices } from '../infrastructure/http/storage-services'
import { createStorageServices } from '../application/storage/services'
import { projectJson } from '../infrastructure/projects/project-json'

/** Choose service execution beside its storage, not a remote callback-based repository. */
export function createConfiguredStorage(mode = 'browser') {
  if (mode === 'server') {
    const services = createHttpStorageServices()
    return {
      services,
      pricing: { supplierProducts: services.catalog.supplierProducts, stockItems: services.stock },
      stockRead: services.stock,
      close: () => { }
    }
  }
  if (mode !== 'browser') {
    throw new Error('Unsupported VITE_STORAGE_MODE. Choose browser or server.')
  }
  const persistence = createLocalPersistence()
  return {
    services: createStorageServices(persistence, projectJson),
    pricing: persistence,
    stockRead: persistence.stockItems,
    close: () => {
      persistence.close()
    }
  }
}
