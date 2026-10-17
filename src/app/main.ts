import { stockTransferServiceKey } from '@/ui/composables/use-stock-transfer-service'
import { partsTransferServiceKey } from '@/ui/composables/use-parts-transfer-service'
import { projectStockServiceKey } from '@/ui/composables/use-project-stock-service'
import { stockRepositoryKey } from '@/ui/composables/use-stock-repository'
import { catalogTransferServiceKey } from '@/ui/composables/use-catalog-transfer-service'
import { currentResultServiceKey } from '@/ui/composables/use-current-result-service'
import { projectTransferServiceKey } from '@/ui/composables/use-project-transfer-service'
import { cuttingConfirmationServiceKey } from '@/ui/composables/use-cutting-confirmation-service'
import { createApp } from 'vue'
import { createOptimizationService } from '@/application/optimization/optimization-service'
import { optimizationServiceFactoryKey } from '@/ui/composables/use-optimization-service'
import { createOptimizationWorker } from '@/infrastructure/optimization/create-optimization-worker'
import { catalogStockRepositoryKey, supplierRepositoryKey, supplierProductRepositoryKey } from '@/ui/composables/use-catalog-repositories'

import { projectServiceKey } from '@/ui/composables/use-project-service'
import { materialRepositoryKey } from '@/ui/composables/use-material-repository'
import { createConfiguredStorage } from './persistence'
import { createCuttingPlanPdfService } from '@/application/export/cutting-plan-pdf-service'
import { cuttingPlanPdfServiceKey } from '@/ui/composables/use-pdf-export-service'

import App from '@/ui/layouts/App.vue'
import { createAppPinia } from './pinia'
import { createAppRouter } from './router'
import '@/ui/styles.css'

const app = createApp(App)
const storage = createConfiguredStorage(import.meta.env.VITE_STORAGE_MODE)
const services = storage.services
const catalog = services.catalog
app.provide(stockTransferServiceKey, services.stockTransfer)
app.provide(catalogStockRepositoryKey, storage.stockRead)
app.provide(projectStockServiceKey, services.projectStock)
app.provide(stockRepositoryKey, services.stock)
app.provide(materialRepositoryKey, catalog.materials)
app.provide(supplierRepositoryKey, catalog.suppliers)
app.provide(supplierProductRepositoryKey, catalog.supplierProducts)
app.provide(currentResultServiceKey, services.currentResults)
app.provide(catalogTransferServiceKey, services.catalogTransfer)
app.provide(projectTransferServiceKey, services.projectTransfer)
app.provide(cuttingConfirmationServiceKey, services.confirmations)
app.provide(projectServiceKey, services.projects)
app.provide(partsTransferServiceKey, services.partsTransfer)
app.provide(optimizationServiceFactoryKey, () => createOptimizationService(createOptimizationWorker))
app.provide(cuttingPlanPdfServiceKey, createCuttingPlanPdfService({
  readCoverImage: async file => {
    const { prepareCoverImage } = await import('@/infrastructure/pdf/cover-image')
    return prepareCoverImage(file)
  },
  generate: async document => {
    const { generateCuttingPlanPdf } = await import('@/infrastructure/pdf/cutting-plan-pdf')
    return generateCuttingPlanPdf(document)
  }, generateProject: async document => {
    const { generateProjectCuttingPdf } = await import('@/infrastructure/pdf/cutting-plan-pdf')
    return generateProjectCuttingPdf(document)
  }
}, storage.pricing))
app.onUnmount(() => {
  storage.close()
})

app.use(createAppPinia())
app.use(createAppRouter())

app.mount('#app')
