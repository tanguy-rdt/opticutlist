import { createApp } from 'vue'

import App from './app/App.vue'
import { createAppPinia } from './app/pinia'
import { createAppRouter } from './app/router'
import './app/styles.css'

const app = createApp(App)

app.use(createAppPinia())
app.use(createAppRouter())

app.mount('#app')
