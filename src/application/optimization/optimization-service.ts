import { validateCuttingTree, type CuttingTreeIssue } from '../../domain/cutting-tree/validate-cutting-tree'
import type { OptimizePanelSelection } from '../../domain/optimizer/optimize-panel'
import type { OptimizePanelInput } from '../../domain/optimizer/plan-with-strategy'
import type { OptimizeProjectInput, OptimizeProjectResult, ProjectPlanIssue } from '../../domain/optimizer/project-plan'
import { validateProjectPlan } from '../../domain/optimizer/validate-project-plan'
import { isOptimizationResponse, type OptimizationWorkerError, type OptimizationRequest, type OptimizationResponse } from './optimization-protocol'

/** The subset of `Worker` the service needs; a real `Worker` satisfies it, tests use a fake. */
export interface OptimizationWorkerPort {
  postMessage(message: OptimizationRequest): void
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
  | { readonly kind: 'invalidPlan'; readonly issues: readonly (CuttingTreeIssue | ProjectPlanIssue)[] }

export type CancellationReason = 'cancelled' | 'superseded' | 'disposed'

type RunOutcome<Selection> =
  | { readonly status: 'completed'; readonly requestId: number; readonly selection: Selection }
  | { readonly status: 'cancelled'; readonly requestId: number; readonly reason: CancellationReason }
  | { readonly status: 'failed'; readonly requestId: number; readonly error: OptimizationFailure }
export type OptimizationOutcome = RunOutcome<OptimizePanelSelection>
export type ProjectOptimizationOutcome = RunOutcome<OptimizeProjectResult>

export interface OptimizationService {
  /**
   * Runs the optimizer in the worker. At most one request is in flight: starting a new one supersedes the
   * previous request, whose promise resolves as `cancelled`. Promises never reject for expected outcomes.
   */
  optimize(input: OptimizePanelInput): Promise<OptimizationOutcome>
  optimizeProject(input: OptimizeProjectInput): Promise<ProjectOptimizationOutcome>
  /** Cancels the in-flight request, if any, by terminating the worker. */
  cancel(): void
  /** Cancels any request and releases the worker; `optimize` throws afterwards. */
  dispose(): void
}

interface PendingRequest {
  readonly requestId: number
  readonly complete: (data: OptimizationResponse) => void
  readonly fail: (error: OptimizationFailure) => void
  readonly cancel: (reason: CancellationReason) => void
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
      pending.fail(error)
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
      current.fail(data.error)
      return
    }

    current.complete(data)
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
    pending.cancel(reason)
  }

  function run<Input, Selection>(input: Input, request: (requestId: number, snapshot: Input) => OptimizationRequest,
    receive: (data: OptimizationResponse) => Selection | null,
    validate: (selection: Selection, snapshot: Input) => { valid: true } | { valid: false; issues: readonly (CuttingTreeIssue | ProjectPlanIssue)[] },
  ): Promise<RunOutcome<Selection>> {
    if (disposed) throw new Error('Optimization service has been disposed')
    cancelPending('superseded')
    const requestId = nextRequestId++
    return new Promise(resolve => {
      function settle(outcome: RunOutcome<Selection>): void {
        if (pending?.requestId !== requestId) return
        pending = null; resolve(outcome)
      }
      const fail = (error: OptimizationFailure) => { settle({ status: 'failed', requestId, error }) }
      pending = { requestId, fail, cancel: reason => { settle({ status: 'cancelled', requestId, reason }) }, complete: () => {} }
      try {
        const snapshot = structuredClone(input)
        pending = { ...pending, complete: data => {
          const selection = receive(data)
          if (selection === null) { if (worker) failWorker(worker, { kind: 'invalidResponse', message: 'Worker returned the wrong result type' }); return }
          try {
            const validation = validate(selection, snapshot)
            if (!validation.valid) { fail({ kind: 'invalidPlan', issues: validation.issues }); return }
            settle({ status: 'completed', requestId, selection })
          } catch (cause) { if (worker) failWorker(worker, { kind: 'invalidResponse', message: cause instanceof Error ? cause.message : String(cause) }) }
        } }
        ensureWorker().postMessage(request(requestId, snapshot))
      } catch (cause) {
        destroyWorker()
        fail({ kind: 'workerError', message: cause instanceof Error ? cause.message : String(cause) })
      }
    })
  }

  return {
    optimize(input) {
      return run(input, (requestId, snapshot) => ({ type: 'optimize', requestId, input: snapshot }), data => data.type === 'result' ? data.selection : null,
        (selection, snapshot) => selection.ok ? validateCuttingTree(selection.plan.tree, snapshot) : { valid: true })
    },
    optimizeProject(input) {
      return run(input, (requestId, snapshot) => ({ type: 'optimizeProject', requestId, input: snapshot }), data => data.type === 'projectResult' ? data.selection : null,
        (selection, snapshot) => selection.ok ? validateProjectPlan(selection.plan, snapshot) : { valid: true })
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
