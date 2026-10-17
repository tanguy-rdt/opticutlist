import { defineConfig } from 'vite'

export default defineConfig({
  build: { ssr: 'server/main.ts', outDir: 'server-dist', emptyOutDir: true },
})
