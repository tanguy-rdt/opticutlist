import { inject, type InjectionKey } from 'vue'
import type { CurrentResultService } from '@/application/plans/current-result-service'
export const currentResultServiceKey: InjectionKey<CurrentResultService> = Symbol('currentResultService')

export function useCurrentResultService(): CurrentResultService | undefined {
  return inject(currentResultServiceKey, undefined)
}
