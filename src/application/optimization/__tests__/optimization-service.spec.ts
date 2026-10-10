import { describe, expect, it } from 'vitest'

import { partSchema } from '../../../domain/model/part'
import { supplierProductSchema } from '../../../domain/model/supplier-product'
import { validPartInput, validSupplierProductInput } from '../../../domain/model/__tests__/fixtures'
import { optimizePanel } from '../../../domain/optimizer/optimize-panel'
import { handleOptimizationRequest } from '../../../workers/optimization/handle-optimization-request'
import type { OptimizationResponse, OptimizeRequest } from '../optimization-protocol'
import { createOptimizationService, type OptimizationWorkerPort } from '../optimization-service'

const input = {
  panel: supplierProductSchema.parse(validSupplierProductInput),
  parts: [partSchema.parse(validPartInput)],
  settings: { kerfMm: 3.2, edgeMarginMm: 10 },
}
const selection = optimizePanel(input)

/** In-memory stand-in for `Worker`; jsdom has no worker support. */
class FakeWorker implements OptimizationWorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null
  readonly posted: OptimizeRequest[] = []
  terminated = false

  postMessage(message: OptimizeRequest): void {
    if (this.terminated) {
      throw new Error('postMessage after terminate')
    }
    this.posted.push(structuredClone(message))
  }

  terminate(): void {
    this.terminated = true
  }

  get lastRequestId(): number {
    const last = this.posted.at(-1)
    if (last === undefined) {
      throw new Error('No request posted')
    }
    return last.requestId
  }

  respond(data: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data: structuredClone(data) }))
  }

  /** Answers the last request using the real worker handler. */
  respondWithHandler(): void {
    const last = this.posted.at(-1)
    this.respond(handleOptimizationRequest(last))
  }

  crash(message: string): void {
    this.onerror?.(new ErrorEvent('error', { message, cancelable: true }))
  }
}

function setup() {
  const workers: FakeWorker[] = []
  const service = createOptimizationService(() => {
    const worker = new FakeWorker()
    workers.push(worker)
    return worker
  })
  const current = (): FakeWorker => {
    const worker = workers.at(-1)
    if (worker === undefined) {
      throw new Error('No worker created')
    }
    return worker
  }
  return { service, workers, current }
}

function result(requestId: number): OptimizationResponse {
  return { type: 'result', requestId, selection }
}

describe('createOptimizationService', () => {
  describe('successful execution', () => {
    it('posts a request and resolves with the worker result', async () => {
      const { service, current } = setup()
      const outcome = service.optimize(input)

      expect(current().posted).toEqual([{ type: 'optimize', requestId: 1, input: structuredClone(input) }])
      current().respondWithHandler()

      await expect(outcome).resolves.toEqual({ status: 'completed', requestId: 1, selection })
    })

    it('creates the worker lazily and reuses it while idle', async () => {
      const { service, workers, current } = setup()

      expect(workers).toHaveLength(0)
      const first = service.optimize(input)
      current().respondWithHandler()
      await first
      const second = service.optimize(input)
      current().respondWithHandler()

      await expect(second).resolves.toMatchObject({ status: 'completed', requestId: 2 })
      expect(workers).toHaveLength(1)
      expect(current().terminated).toBe(false)
    })

    it('passes domain failures through as completed outcomes', async () => {
      const { service, current } = setup()
      const outcome = service.optimize({ ...input, settings: { kerfMm: 3, edgeMarginMm: 700 } })
      current().respondWithHandler()

      await expect(outcome).resolves.toEqual({
        status: 'completed',
        requestId: 1,
        selection: { ok: false, error: { kind: 'noUsableArea' } },
      })
    })
  })

  describe('independent validation', () => {
    it('rejects a received plan that fails re-validation on the main thread', async () => {
      const { service, current } = setup()
      const outcome = service.optimize(input)
      const tree = selection.ok ? selection.plan.tree : null
      if (!selection.ok || tree?.kind !== 'cut') {
        throw new Error('fixture: expected a plan with a cut at the root')
      }
      const tampered = { ...selection, plan: { ...selection.plan, tree: { ...tree, cut: { ...tree.cut, offsetMm: 0 } } } }
      current().respond({ type: 'result', requestId: 1, selection: tampered })

      await expect(outcome).resolves.toMatchObject({
        status: 'failed',
        requestId: 1,
        error: { kind: 'invalidPlan', issues: [{ kind: 'cutOutOfBounds' }] },
      })
    })
  })

  describe('errors', () => {
    it('reports optimizer errors from the worker', async () => {
      const { service, current } = setup()
      const part = partSchema.parse(validPartInput)
      const outcome = service.optimize({ ...input, parts: [part, part] })
      current().respondWithHandler()

      await expect(outcome).resolves.toEqual({
        status: 'failed',
        requestId: 1,
        error: { kind: 'optimizerError', message: 'Duplicate part ID part-side-panel in optimizer input' },
      })
      expect(current().terminated).toBe(false)
    })

    it('applies an error with a null request ID to the in-flight request', async () => {
      const { service, current } = setup()
      const outcome = service.optimize(input)
      current().respond({ type: 'error', requestId: null, error: { kind: 'invalidRequest', message: 'bad' } })

      await expect(outcome).resolves.toMatchObject({ status: 'failed', requestId: 1, error: { kind: 'invalidRequest' } })
    })

    it('fails and discards the worker on an unrecognized message', async () => {
      const { service, current } = setup()
      const outcome = service.optimize(input)
      current().respond({ hello: 'world' })

      await expect(outcome).resolves.toMatchObject({ status: 'failed', error: { kind: 'invalidResponse' } })
      expect(current().terminated).toBe(true)
    })

    it('fails and discards the worker when a message cannot be deserialized', async () => {
      const { service, current } = setup()
      const outcome = service.optimize(input)
      current().onmessageerror?.(new MessageEvent('messageerror'))

      await expect(outcome).resolves.toMatchObject({ status: 'failed', error: { kind: 'invalidResponse' } })
      expect(current().terminated).toBe(true)
    })

    it('fails on a worker crash and recreates the worker for the next request', async () => {
      const { service, workers, current } = setup()
      const outcome = service.optimize(input)
      const crashed = current()
      crashed.crash('Script error')

      await expect(outcome).resolves.toEqual({ status: 'failed', requestId: 1, error: { kind: 'workerError', message: 'Script error' } })
      expect(crashed.terminated).toBe(true)
      expect(crashed.onmessage).toBeNull()

      const next = service.optimize(input)
      current().respondWithHandler()
      await expect(next).resolves.toMatchObject({ status: 'completed', requestId: 2 })
      expect(workers).toHaveLength(2)
    })

    it('uses a fallback message for errors without one', async () => {
      const { service, current } = setup()
      const outcome = service.optimize(input)
      current().crash('')

      await expect(outcome).resolves.toMatchObject({ error: { kind: 'workerError', message: 'Optimization worker failed' } })
    })

    it('discards a worker that crashes while idle', async () => {
      const { service, workers, current } = setup()
      const first = service.optimize(input)
      current().respondWithHandler()
      await first
      current().crash('Out of memory')

      expect(current().terminated).toBe(true)
      void service.optimize(input)
      expect(workers).toHaveLength(2)
    })

    it('fails when the worker cannot be created', async () => {
      const service = createOptimizationService(() => {
        throw new Error('Workers are not supported')
      })

      await expect(service.optimize(input)).resolves.toEqual({
        status: 'failed',
        requestId: 1,
        error: { kind: 'workerError', message: 'Workers are not supported' },
      })
    })

    it('fails and discards the worker when the request cannot be posted', async () => {
      const { service, current } = setup()
      // Functions cannot be structured-cloned, so posting this input throws a DataCloneError.
      const uncloneable = { ...input, settings: Object.assign({ ...input.settings }, { extra: () => 0 }) }
      const outcome = service.optimize(uncloneable)

      await expect(outcome).resolves.toMatchObject({ status: 'failed', error: { kind: 'workerError' } })
      expect(current().terminated).toBe(true)
    })
  })

  describe('cancellation', () => {
    it('cancels the in-flight request by terminating the worker', async () => {
      const { service, current } = setup()
      const outcome = service.optimize(input)
      const busy = current()
      service.cancel()

      await expect(outcome).resolves.toEqual({ status: 'cancelled', requestId: 1, reason: 'cancelled' })
      expect(busy.terminated).toBe(true)
      expect(busy.onmessage).toBeNull()
    })

    it('recreates the worker after cancellation', async () => {
      const { service, workers, current } = setup()
      void service.optimize(input)
      service.cancel()
      const next = service.optimize(input)
      current().respondWithHandler()

      await expect(next).resolves.toMatchObject({ status: 'completed', requestId: 2 })
      expect(workers).toHaveLength(2)
    })

    it('does nothing when idle and keeps the worker', async () => {
      const { service, current } = setup()
      const first = service.optimize(input)
      current().respondWithHandler()
      await first
      service.cancel()

      expect(current().terminated).toBe(false)
    })

    it('supersedes the previous request when a new one starts', async () => {
      const { service, workers, current } = setup()
      const first = service.optimize(input)
      const second = service.optimize(input)

      await expect(first).resolves.toEqual({ status: 'cancelled', requestId: 1, reason: 'superseded' })
      expect(workers[0]?.terminated).toBe(true)
      expect(current().posted.map((request) => request.requestId)).toEqual([2])

      current().respondWithHandler()
      await expect(second).resolves.toMatchObject({ status: 'completed', requestId: 2 })
    })

    it('settles each promise exactly once', async () => {
      const { service, current } = setup()
      const outcome = service.optimize(input)
      service.cancel()
      service.cancel()
      current().respond(result(1))

      await expect(outcome).resolves.toMatchObject({ status: 'cancelled' })
    })
  })

  describe('stale responses', () => {
    it('ignores a response for an older request ID', async () => {
      const { service, current } = setup()
      const first = service.optimize(input)
      current().respondWithHandler()
      await first

      const second = service.optimize(input)
      current().respond(result(1)) // Late duplicate for request 1.
      let settled = false
      void second.then(() => {
        settled = true
      })
      await Promise.resolve()
      expect(settled).toBe(false)

      current().respondWithHandler()
      await expect(second).resolves.toMatchObject({ status: 'completed', requestId: 2 })
    })

    it('ignores messages from a terminated worker', async () => {
      const { service, workers, current } = setup()
      void service.optimize(input)
      const oldHandler = workers[0]?.onmessage
      const newer = service.optimize(input)
      let settled = false
      void newer.then(() => {
        settled = true
      })

      // A result racing with termination, even one carrying the current request ID, is not applied.
      oldHandler?.(new MessageEvent('message', { data: result(2) }))
      await Promise.resolve()
      expect(settled).toBe(false)

      current().respondWithHandler()
      await expect(newer).resolves.toMatchObject({ status: 'completed', requestId: 2 })
    })

    it('ignores errors from a replaced worker', async () => {
      const { service, workers, current } = setup()
      void service.optimize(input)
      const oldHandler = workers[0]?.onerror
      const newer = service.optimize(input)
      oldHandler?.(new ErrorEvent('error', { message: 'late crash', cancelable: true }))

      expect(current().terminated).toBe(false)
      current().respondWithHandler()
      await expect(newer).resolves.toMatchObject({ status: 'completed', requestId: 2 })
    })

    it('ignores results that arrive when nothing is in flight', async () => {
      const { service, current } = setup()
      const first = service.optimize(input)
      current().respondWithHandler()
      await first
      current().respond(result(1))

      expect(current().terminated).toBe(false)
    })

    it('assigns unique, increasing request IDs', () => {
      const { service, workers } = setup()
      for (let i = 0; i < 3; i += 1) {
        void service.optimize(input)
      }

      expect(workers.flatMap((worker) => worker.posted.map((request) => request.requestId))).toEqual([1, 2, 3])
    })
  })

  describe('cleanup', () => {
    it('cancels the in-flight request and terminates the worker on dispose', async () => {
      const { service, current } = setup()
      const outcome = service.optimize(input)
      service.dispose()

      await expect(outcome).resolves.toEqual({ status: 'cancelled', requestId: 1, reason: 'disposed' })
      expect(current().terminated).toBe(true)
    })

    it('terminates an idle worker on dispose', async () => {
      const { service, current } = setup()
      const first = service.optimize(input)
      current().respondWithHandler()
      await first
      service.dispose()

      expect(current().terminated).toBe(true)
      expect(current().onmessage).toBeNull()
    })

    it('rejects new requests after dispose', () => {
      const { service } = setup()
      service.dispose()

      expect(() => service.optimize(input)).toThrow(/disposed/)
    })

    it('can be disposed twice', () => {
      const { service } = setup()
      service.dispose()

      expect(() => {
        service.dispose()
      }).not.toThrow()
    })
  })
})
