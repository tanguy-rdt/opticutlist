import { inject, type InjectionKey } from 'vue'
import type { OptimizationService } from '../../application/optimization/optimization-service'

/** Each mounted workspace tool owns and disposes its service. */
export const optimizationServiceFactoryKey: InjectionKey<() => OptimizationService> = Symbol('optimizationServiceFactory')

export function useOptimizationService(): OptimizationService {
  const factory = inject(optimizationServiceFactoryKey)
  if (factory === undefined) {
    throw new Error('Optimization service was not provided')
  }
  return factory()
}
