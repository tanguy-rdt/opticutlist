/// <reference types="vite/client" />

// Fallback for tools that cannot resolve SFCs (e.g. typescript-eslint).
// vue-tsc resolves real component types and ignores this declaration.
declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent
  export default component
}
