import { inject, type InjectionKey, type Ref } from 'vue'

/** Transient navigation readiness only; cutting data remains in the current-result service. */
export interface CuttingWorkspaceState {
  available: Ref<boolean>
  invalidated: Ref<boolean>
}
export const cuttingWorkspaceStateKey: InjectionKey<CuttingWorkspaceState> = Symbol('cuttingWorkspaceState')

export function useCuttingWorkspaceState(): CuttingWorkspaceState | undefined {
  return inject(cuttingWorkspaceStateKey, undefined)
}
