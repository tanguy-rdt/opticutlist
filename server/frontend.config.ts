import { defineConfig, mergeConfig, type Plugin } from 'vite'
import browserConfig from '../vite.config.ts'

const storageMarker: Plugin = {
  name: 'self-hosted-storage-marker',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'storage-mode.txt', source: 'server\n' })
  },
}

export default defineConfig(mergeConfig(browserConfig, {
  define: { 'import.meta.env.VITE_STORAGE_MODE': JSON.stringify('server') },
  build: { outDir: 'dist-self-hosted' },
  plugins: [storageMarker],
}))
