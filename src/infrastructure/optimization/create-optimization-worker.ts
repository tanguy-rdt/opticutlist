import type { OptimizationWorkerPort } from '@/application/optimization/optimization-service'

/** Creates the optimization worker; Vite bundles it as a separate module chunk. */
export function createOptimizationWorker(): OptimizationWorkerPort {
  return new Worker(new URL('./optimization.worker.ts', import.meta.url), { type: 'module', name: 'optimization' })
}
