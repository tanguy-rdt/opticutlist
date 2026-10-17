import { inject, type InjectionKey } from 'vue'
import type { ProjectTransferService } from '@/application/projects/project-transfer-service'
export const projectTransferServiceKey: InjectionKey<ProjectTransferService> = Symbol('projectTransferService')

export function useProjectTransferService(): ProjectTransferService | undefined {
  return inject(projectTransferServiceKey, undefined)
}

import { downloadJson } from '@/ui/utils/download-json'

export function downloadProject(text: string, name: string): void {
  downloadJson(text, name, 'oclproject.json')
}
