import type { OptimizePanelSelection } from '../../domain/optimizer/optimize-panel'
import type { OptimizePanelInput } from '../../domain/optimizer/plan-with-strategy'

/**
 * Messages exchanged with the optimization worker. Values cross the thread boundary by structured clone,
 * so they must stay plain data (no functions or class instances).
 */
export interface OptimizeRequest {
  readonly type: 'optimize'
  /** Positive safe integer, unique per service instance. */
  readonly requestId: number
  readonly input: OptimizePanelInput
}

export type OptimizationWorkerError =
  /** The optimizer threw (e.g. duplicate part IDs or out-of-range geometry input). */
  | { readonly kind: 'optimizerError'; readonly message: string }
  /** The worker received a message that is not an `OptimizeRequest`. */
  | { readonly kind: 'invalidRequest'; readonly message: string }

export type OptimizationResponse =
  /** The optimizer ran; `selection` may itself be a domain failure such as `noUsableArea`. */
  | { readonly type: 'result'; readonly requestId: number; readonly selection: OptimizePanelSelection }
  /** `requestId` is `null` only when the request was unreadable. */
  | { readonly type: 'error'; readonly requestId: number | null; readonly error: OptimizationWorkerError }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isRequestId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/**
 * Checks the message envelope. The payload is produced by this application from schema-validated domain
 * values and is not re-parsed here; the optimizer still rejects out-of-range numbers.
 */
export function isOptimizeRequest(data: unknown): data is OptimizeRequest {
  return (
    isRecord(data) &&
    data.type === 'optimize' &&
    isRequestId(data.requestId) &&
    isRecord(data.input) &&
    isRecord(data.input.panel) &&
    Array.isArray(data.input.parts) &&
    isRecord(data.input.settings)
  )
}

/** Checks the message envelope; plans in successful results are re-validated by the service. */
export function isOptimizationResponse(data: unknown): data is OptimizationResponse {
  if (!isRecord(data)) {
    return false
  }
  if (data.type === 'result') {
    return isRequestId(data.requestId) && isRecord(data.selection) && typeof data.selection.ok === 'boolean'
  }
  return (
    data.type === 'error' &&
    (data.requestId === null || isRequestId(data.requestId)) &&
    isRecord(data.error) &&
    (data.error.kind === 'optimizerError' || data.error.kind === 'invalidRequest') &&
    typeof data.error.message === 'string'
  )
}
