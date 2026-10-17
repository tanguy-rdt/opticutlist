/// <reference types="vite/client" />

// Fallback for tools that cannot resolve SFCs (e.g. typescript-eslint).
// vue-tsc resolves real component types and ignores this declaration.
declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent
  export default component
}

interface ImportMetaEnv {
  /** Explicit deployment configuration; currently only browser storage is implemented. */
  readonly VITE_STORAGE_MODE?: string
}
