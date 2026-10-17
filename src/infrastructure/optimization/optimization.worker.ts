import { handleOptimizationRequest } from './handle-optimization-request'

// Dedicated worker entry: all logic lives in `handleOptimizationRequest` and the pure domain optimizer.
self.addEventListener('message', (event: MessageEvent<unknown>) => {
  self.postMessage(handleOptimizationRequest(event.data))
})
