import type { InjectionKey, Ref } from 'vue'

// UI invalidation only: records remain in the existing repositories.
export const dataImportRevisionKey: InjectionKey<Ref<number>> = Symbol('dataImportRevision')
