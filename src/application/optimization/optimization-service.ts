import { validateCuttingTree, type CuttingTreeIssue } from '../../domain/cutting-tree/validate-cutting-tree'
import type { OptimizePanelSelection } from '../../domain/optimizer/optimize-panel'
import type { OptimizePanelInput } from '../../domain/optimizer/plan-with-strategy'
import { isOptimizationResponse, type OptimizationWorkerError, type OptimizeRequest } from './optimization-protocol'

/** The subset of `Worker` the service needs; a real `Worker` satisfies it, tests use a fake. */
export interface OptimizationWorkerPort {
  postMessage(message: OptimizeRequest): void
  terminate(): void
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null
}

export type OptimizationFailure =
  | OptimizationWorkerError
  /** The worker crashed, could not start, or the request could not be sent. */
  | { readonly kind: 'workerError'; readonly message: string }
  /** The worker sent something that is not a protocol response. */
  | { readonly kind: 'invalidResponse'; readonly message: string }
  /** The received plan failed independent re-validation on the main thread. */
  | { readonly kind: 'invalidPlan'; readonly issues: readonly CuttingTreeIssue[] }

export type CancellationReason = 'cancelled' | 'superseded' | 'disposed'

export type OptimizationOutcome =
  | { readonly status: 'completed'; readonly requestId: number; readonly selection: OptimizePanelSelection }
  | { readonly status: 'cancelled'; readonly requestId: number; readonly reason: CancellationReason }
  | { readonly status: 'failed'; readonly requestId: number; readonly error: OptimizationFailure }

export interface OptimizationService {
  /**
   * Runs the optimizer in the worker. At most one request is in flight: starting a new one supersedes the
   * previous request, whose promise resolves as `cancelled`. Promises never reject for expected outcomes.
   */
  optimize(input: OptimizePanelInput): Promise<OptimizationOutcome>
  /** Cancels the in-flight request, if any, by terminating the worker. */
  cancel(): void
  /** Cancels any request and releases the worker; `optimize` throws afterwards. */
  dispose(): void
}

interface PendingRequest {
  readonly requestId: number
  readonly input: OptimizePanelInput
  readonly resolve: (outcome: OptimizationOutcome) => void
}

/**
 * Creates the application-side optimization service.
 * The worker is created lazily, reused while idle, and terminated (then recreated on demand) on
 * cancellation, supersession, failure or disposal. Messages from a terminated worker and responses
 * whose `requestId` is not the in-flight request are ignored, so stale results are never applied.
 */
export function createOptimizationService(createWorker: () => OptimizationWorkerPort): OptimizationService {
  let worker: OptimizationWorkerPort | null = null
  let pending: PendingRequest | null = null
  let nextRequestId = 1
  let disposed = false

  function settle(outcome: OptimizationOutcome): void {
    const current = pending
    if (current?.requestId !== outcome.requestId) {
      return
    }
    pending = null
    current.resolve(outcome)
  }

  function destroyWorker(): void {
    if (worker === null) {
      return
    }
    worker.onmessage = null
    worker.onerror = null
    worker.onmessageerror = null
    worker.terminate()
    worker = null
  }

  /** Fails the in-flight request and discards the worker, which may be in an unknown state. */
  function failWorker(source: OptimizationWorkerPort, error: OptimizationFailure): void {
    if (source !== worker) {
      return
    }
    destroyWorker()
    if (pending !== null) {
      settle({ status: 'failed', requestId: pending.requestId, error })
    }
  }

  function handleMessage(source: OptimizationWorkerPort, data: unknown): void {
    if (source !== worker) {
      return
    }
    if (!isOptimizationResponse(data)) {
      failWorker(source, { kind: 'invalidResponse', message: 'Worker sent an unrecognized message' })
      return
    }
    const current = pending
    if (current === null || (data.requestId !== null && data.requestId !== current.requestId)) {
      return // Stale response for a request that is no longer in flight.
    }
    if (data.type === 'error') {
      settle({ status: 'failed', requestId: current.requestId, error: data.error })
      return
    }

    const { selection } = data
    if (selection.ok) {
      let validation
      try {
        validation = validateCuttingTree(selection.plan.tree, current.input)
      } catch (error) {
        failWorker(source, { kind: 'invalidResponse', message: error instanceof Error ? error.message : String(error) })
        return
      }
      if (!validation.valid) {
        settle({ status: 'failed', requestId: current.requestId, error: { kind: 'invalidPlan', issues: validation.issues } })
        return
      }
    }
    settle({ status: 'completed', requestId: current.requestId, selection })
  }

  function ensureWorker(): OptimizationWorkerPort {
    if (worker !== null) {
      return worker
    }
    const created = createWorker()
    created.onmessage = (event) => {
      handleMessage(created, event.data)
    }
    created.onerror = (event) => {
      event.preventDefault()
      failWorker(created, { kind: 'workerError', message: event.message || 'Optimization worker failed' })
    }
    created.onmessageerror = () => {
      failWorker(created, { kind: 'invalidResponse', message: 'Worker message could not be deserialized' })
    }
    worker = created
    return created
  }

  function cancelPending(reason: CancellationReason): void {
    if (pending === null) {
      return
    }
    // The worker cannot be interrupted mid-computation, so it is replaced.
    destroyWorker()
    settle({ status: 'cancelled', requestId: pending.requestId, reason })
  }

  return {
    optimize(input) {
      if (disposed) {
        throw new Error('Optimization service has been disposed')
      }
      cancelPending('superseded')

      const requestId = nextRequestId
      nextRequestId += 1

      return new Promise<OptimizationOutcome>((resolve) => {
        pending = { requestId, input, resolve }
        try {
          const snapshot = structuredClone(input)
          pending = { requestId, input: snapshot, resolve }
          ensureWorker().postMessage({ type: 'optimize', requestId, input: snapshot })
        } catch (error) {
          destroyWorker()
          settle({
            status: 'failed',
            requestId,
            error: { kind: 'workerError', message: error instanceof Error ? error.message : String(error) },
          })
        }
      })
    },

    cancel() {
      cancelPending('cancelled')
    },

    dispose() {
      cancelPending('disposed')
      destroyWorker()
      disposed = true
    },
  }
}
