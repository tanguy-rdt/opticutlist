import { inject, type InjectionKey } from 'vue'
import type { ProjectTransferService } from '../../application/projects/project-transfer-service'
export const projectTransferServiceKey: InjectionKey<ProjectTransferService> = Symbol('projectTransferService')
export function useProjectTransferService(): ProjectTransferService | undefined { return inject(projectTransferServiceKey, undefined) }
export function downloadProject(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a')
  try {
    link.href = url
    link.download = `${name.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 100) || 'opticutlist-project'}.json`
    document.body.append(link); link.click()
  } finally { link.remove(); window.setTimeout(() => { URL.revokeObjectURL(url) }, 1000) }
}
