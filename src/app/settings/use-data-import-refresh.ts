import { inject, watch } from 'vue'
import { dataImportRevisionKey } from './data-import-revision'

export function useDataImportRefresh(refresh: () => void, ready: () => boolean): void {
  const revision = inject(dataImportRevisionKey, undefined)
  if (!revision) return
  let handledRevision = revision.value

  watch(() => ({ revision: revision.value, ready: ready() }), current => {
    if (!current.ready || current.revision === handledRevision) return
    handledRevision = current.revision
    refresh()
  })
}
