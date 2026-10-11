import { inject, type InjectionKey } from 'vue'
import type { SavedPlanService } from '../../application/plans/saved-plan-service'
export const savedPlanServiceKey: InjectionKey<SavedPlanService> = Symbol('savedPlanService')
export function useSavedPlanService(): SavedPlanService | undefined { return inject(savedPlanServiceKey, undefined) }
