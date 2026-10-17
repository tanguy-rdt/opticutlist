import type { Persistence } from '../persistence/repositories'
import type { ProjectJsonPort } from '../projects/project-transfer-format'
import { createCatalogRepositories } from '../catalog/catalog-repositories'
import { createCatalogTransferService } from '../catalog/catalog-transfer-service'
import { createStockRepository } from '../inventory/stock-repository'
import { createStockTransferService } from '../inventory/stock-transfer-service'
import { createProjectStockService } from '../inventory/project-stock-service'
import { createCuttingConfirmationService } from '../inventory/cutting-confirmation-service'
import { createCurrentResultService } from '../plans/current-result-service'
import { createProjectService } from '../projects/project-service'
import { createProjectTransferService } from '../projects/project-transfer-service'
import { createPartsTransferService } from '../projects/parts-transfer-service'

/** The same guarded operations run in the browser or beside the server database. */
export function createStorageServices(persistence: Persistence, json: ProjectJsonPort) {
  return {
    catalog: createCatalogRepositories(persistence),
    stock: createStockRepository(persistence),
    projects: createProjectService(persistence),
    currentResults: createCurrentResultService(persistence),
    projectStock: createProjectStockService(persistence),
    confirmations: createCuttingConfirmationService(persistence),
    catalogTransfer: createCatalogTransferService(persistence, json),
    stockTransfer: createStockTransferService(persistence, json),
    projectTransfer: createProjectTransferService(persistence, json),
    partsTransfer: createPartsTransferService(persistence, json),
  }
}
export type StorageServices = ReturnType<typeof createStorageServices>
