import { inject, type InjectionKey } from 'vue'
import type { ProjectService } from '../../application/projects/project-service'
import type { CuttingProjectId } from '../../domain/model/ids'

export const projectServiceKey: InjectionKey<ProjectService> = Symbol('projectService')
export const projectIdKey: InjectionKey<CuttingProjectId> = Symbol('projectId')

export function useProjectService(): ProjectService {
  const service = inject(projectServiceKey)
  if (service === undefined) {
    throw new Error('Project service was not provided')
  }
  return service
}

export function useProjectId(): CuttingProjectId {
  const id = inject(projectIdKey)
  if (id === undefined) {
    throw new Error('An open project was not provided')
  }
  return id
}
