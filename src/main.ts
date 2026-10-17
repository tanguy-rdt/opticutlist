import { createStockTransferService } from './application/inventory/stock-transfer-service'
import { stockTransferServiceKey } from './features/inventory/stock-transfer-service'
import { createPartsTransferService } from './application/projects/parts-transfer-service'
import { partsTransferServiceKey } from './features/parts/parts-transfer-service'
import { createProjectStockService } from './application/inventory/project-stock-service'
import { projectStockServiceKey } from './features/projects/project-stock-service'
import { createStockRepository } from './application/inventory/stock-repository'
import { stockRepositoryKey } from './features/inventory/stock-repository'
import { createCatalogTransferService } from './application/catalog/catalog-transfer-service'
import { catalogTransferServiceKey } from './features/suppliers/catalog-transfer-service'
import { createCurrentResultService } from './application/plans/current-result-service'
import { currentResultServiceKey } from './features/optimization/current-result-service'
import { createProjectTransferService } from './application/projects/project-transfer-service'
import { projectJson } from './infrastructure/projects/project-json'
import { projectTransferServiceKey } from './features/projects/project-transfer-service'
import { createCuttingConfirmationService } from './application/inventory/cutting-confirmation-service'
import { cuttingConfirmationServiceKey } from './features/inventory/cutting-confirmation-service'
import { createApp } from 'vue'
import { createOptimizationService } from './application/optimization/optimization-service'
import { optimizationServiceFactoryKey } from './features/optimization/optimization-service'
import { createOptimizationWorker } from './workers/optimization/create-optimization-worker'
import { createCatalogRepositories } from './application/catalog/catalog-repositories'
import { catalogStockRepositoryKey, supplierRepositoryKey, supplierProductRepositoryKey } from './features/suppliers/catalog-repositories'

import { createProjectService } from './application/projects/project-service'
import { projectServiceKey } from './features/projects/project-service'
import { materialRepositoryKey } from './features/materials/material-repository'
import { createConfiguredPersistence } from './app/persistence'
import { createCuttingPlanPdfService } from './application/export/cutting-plan-pdf-service'
import { cuttingPlanPdfServiceKey } from './features/optimization/pdf-export-service'

import App from './app/App.vue'
import { createAppPinia } from './app/pinia'
import { createAppRouter } from './app/router'
import './app/styles.css'

const app = createApp(App)
const persistence = createConfiguredPersistence(import.meta.env.VITE_STORAGE_MODE)
const catalog = createCatalogRepositories(persistence)
app.provide(stockTransferServiceKey, createStockTransferService(persistence, projectJson))
app.provide(catalogStockRepositoryKey, persistence.stockItems)
app.provide(projectStockServiceKey, createProjectStockService(persistence))
app.provide(stockRepositoryKey, createStockRepository(persistence))
app.provide(materialRepositoryKey, catalog.materials)
app.provide(supplierRepositoryKey, catalog.suppliers)
app.provide(supplierProductRepositoryKey, catalog.supplierProducts)
app.provide(currentResultServiceKey, createCurrentResultService(persistence))
app.provide(catalogTransferServiceKey, createCatalogTransferService(persistence, projectJson))
app.provide(projectTransferServiceKey, createProjectTransferService(persistence, projectJson))
app.provide(cuttingConfirmationServiceKey, createCuttingConfirmationService(persistence))
app.provide(projectServiceKey, createProjectService(persistence))
app.provide(partsTransferServiceKey, createPartsTransferService(persistence, projectJson))
app.provide(optimizationServiceFactoryKey, () => createOptimizationService(createOptimizationWorker))
app.provide(cuttingPlanPdfServiceKey, createCuttingPlanPdfService({
  generate: async document => {
    const { generateCuttingPlanPdf } = await import('./infrastructure/pdf/cutting-plan-pdf')
    return generateCuttingPlanPdf(document)
  }, generateProject: async document => {
    const { generateProjectCuttingPdf } = await import('./infrastructure/pdf/cutting-plan-pdf')
    return generateProjectCuttingPdf(document)
  }
}, persistence))
app.onUnmount(() => {
  persistence.close()
})

app.use(createAppPinia())
app.use(createAppRouter())

app.mount('#app')
