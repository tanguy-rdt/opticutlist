import { inject, reactive, type InjectionKey } from 'vue'
import type { CuttingProjectId } from '../../domain/model/ids'
export function createProjectNavigation() {
  return reactive<{ activeId: CuttingProjectId | null; tabs: Map<CuttingProjectId, string> }>({ activeId: null, tabs: new Map() })
}
export type ProjectNavigation = ReturnType<typeof createProjectNavigation>
export const projectNavigationKey: InjectionKey<ProjectNavigation> = Symbol('projectNavigation')
export function useProjectNavigation() { return inject(projectNavigationKey, undefined) }
