import {
  isOptimizeRequest,
  isOptimizeProjectRequest,
  isRequestId,
  type OptimizationResponse,
} from '../../application/optimization/optimization-protocol'
import { optimizePanel } from '../../domain/optimizer/optimize-panel'
import { optimizeProject } from '../../domain/optimizer/optimize-project'

/** Worker-side handling of one message: delegates to the pure optimizer and never throws. */
export function handleOptimizationRequest(data: unknown): OptimizationResponse {
  if (!isOptimizeRequest(data) && !isOptimizeProjectRequest(data)) {
    const requestId = typeof data === 'object' && data !== null && 'requestId' in data ? data.requestId : null
    return {
      type: 'error',
      requestId: isRequestId(requestId) ? requestId : null,
      error: { kind: 'invalidRequest', message: 'Message is not a valid optimization request' },
    }
  }

  try {
    if (data.type === 'optimizeProject') return { type: 'projectResult', requestId: data.requestId, selection: optimizeProject(data.input) }
    return { type: 'result', requestId: data.requestId, selection: optimizePanel(data.input) }
  } catch (error) {
    return {
      type: 'error',
      requestId: data.requestId,
      error: { kind: 'optimizerError', message: error instanceof Error ? error.message : String(error) },
    }
  }
}
