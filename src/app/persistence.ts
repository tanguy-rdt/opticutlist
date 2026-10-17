import type { Persistence } from '../application/persistence/repositories'
import { createLocalPersistence } from '../infrastructure/persistence/local-database'

/** Select storage once at startup, without hostname inference or fallback. */
export function createConfiguredPersistence(mode = 'browser'): Persistence {
  if (mode === 'browser') {
    return createLocalPersistence()
  }
  if (mode === 'server') {
    throw new Error('Server storage is not implemented. Leave VITE_STORAGE_MODE unset or set it to browser.')
  }
  throw new Error('Unsupported VITE_STORAGE_MODE. Only browser storage is currently available.')
}
