import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// Served from https://<owner>.github.io/opticutlist/ on GitHub Pages.
const base = '/opticutlist/'

export default defineConfig({
  base,
  plugins: [vue(), tailwindcss()],
  // Module workers (`new Worker(url, { type: 'module' })`) are emitted as ES chunks.
  worker: {
    format: 'es',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
