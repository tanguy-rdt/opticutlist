import { createApp } from 'vue'
import { createCatalogRepositories } from './application/catalog/catalog-repositories'
import { supplierRepositoryKey, supplierProductRepositoryKey } from './features/suppliers/catalog-repositories'

import { createProjectService } from './application/projects/project-service'
import { projectServiceKey } from './features/projects/project-service'
import { materialRepositoryKey } from './features/materials/material-repository'
import { createLocalPersistence } from './infrastructure/persistence/local-database'

import App from './app/App.vue'
import { createAppPinia } from './app/pinia'
import { createAppRouter } from './app/router'
import './app/styles.css'

const app = createApp(App)
const persistence = createLocalPersistence()
const catalog = createCatalogRepositories(persistence)
app.provide(materialRepositoryKey, catalog.materials)
app.provide(supplierRepositoryKey, catalog.suppliers)
app.provide(supplierProductRepositoryKey, catalog.supplierProducts)
app.provide(projectServiceKey, createProjectService(persistence))
app.onUnmount(() => { persistence.close() })

app.use(createAppPinia())
app.use(createAppRouter())

app.mount('#app')
