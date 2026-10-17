import { inject, type InjectionKey } from 'vue'
import type { ProjectStockService } from '@/application/inventory/project-stock-service'
export const projectStockServiceKey: InjectionKey<ProjectStockService> = Symbol('projectStockService')

export function useProjectStockService(): ProjectStockService {
  const service = inject(projectStockServiceKey)
  if (!service) {
    throw new Error('Project stock service was not provided')
  }
  return service
}
