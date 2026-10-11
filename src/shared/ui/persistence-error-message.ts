import type { PersistenceError } from '../../application/persistence/repositories'

export function persistenceErrorMessage(error: PersistenceError, entity: 'Material' | 'Part' | 'Supplier' | 'Product' | 'Project' | 'Saved plan' | 'Current cutting result' | 'Cutting confirmation'): string {
  const noun = entity.toLowerCase()
  switch (error.kind) {
    case 'invalidRecord': return `${entity} data is invalid. No records were changed.${['Saved plan', 'Current cutting result'].includes(entity) ? ` ${error.issues.map(issue => issue.message).join('; ')}` : ''}`
    case 'duplicateId': return `A ${noun} with this ID already exists. Start a new ${noun} and try again.`
    case 'notFound': return `This ${noun} no longer exists. Refresh the library and try again.`
    case 'storageFailure': return 'Could not access local storage. Try again. Your browser may be blocking storage or out of space.'
    case 'referenceConflict': return error.message
  }
}
