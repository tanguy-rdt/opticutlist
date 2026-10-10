import { createApp } from 'vue'

import { partRepositoryKey } from './features/parts/part-repository'
import { materialRepositoryKey } from './features/materials/material-repository'
import { createLocalPersistence } from './infrastructure/persistence/local-database'

import App from './app/App.vue'
import { createAppPinia } from './app/pinia'
import { createAppRouter } from './app/router'
import './app/styles.css'

const app = createApp(App)
const persistence = createLocalPersistence()
app.provide(materialRepositoryKey, persistence.materials)
app.provide(partRepositoryKey, persistence.parts)
app.onUnmount(() => { persistence.close() })

app.use(createAppPinia())
app.use(createAppRouter())

app.mount('#app')
