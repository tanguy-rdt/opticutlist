import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHttpStorageServices } from '../storage-services'
import { supplierProductSchema } from '../../../domain/model/supplier-product'
import { persistenceErrorMessage } from '../../../ui/utils/persistence-error-message'

const product = supplierProductSchema.parse({
  id: 'product', supplierId: 'supplier', materialId: 'material', name: 'Panel',
  lengthMm: 800, widthMm: 600, thicknessMm: 15, grainDirection: 'none',
  currency: 'EUR', availability: 'available',
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('server storage transport failures', () => {
  it('reports invalid outgoing records as validation errors without contacting the server', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const result = await createHttpStorageServices().stock.addFromProduct({ ...product, widthMm: 0 }, 1)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected validation failure')
    expect(result.error.kind).toBe('invalidRecord')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['read', 'purchase'])('ends stalled %s requests with an actionable timeout, without retrying', async operation => {
    vi.useFakeTimers()
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
    }))
    vi.stubGlobal('fetch', fetch)
    const client = createHttpStorageServices()
    const pending = operation === 'read' ? client.stock.list() : client.stock.addFromProduct(product, 1)
    await vi.advanceTimersByTimeAsync(30_000)
    // Settle a broken implementation too, so this regression test cannot hang indefinitely.
    const result = await Promise.race([pending, Promise.resolve(null)])
    expect(result).not.toBeNull()
    if (!result || result.ok) throw new Error('Expected a storage timeout')
    expect(result.error.kind).toBe('storageFailure')
    expect(persistenceErrorMessage(result.error, 'Stock item')).toMatch(/timed out.*reload/i)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    new Response('<html>Service unavailable</html>', { status: 503 }),
    Response.json({ ok: true, value: [{ id: 'corrupt' }] }),
    Response.json({ ok: true, value: [] }, { status: 500 }),
  ])('rejects invalid responses without falling back or retrying', async response => {
    const fetch = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetch)
    const result = await createHttpStorageServices().stock.list()
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected storage failure')
    expect(persistenceErrorMessage(result.error, 'Stock item')).toMatch(/Server storage.*reload/i)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
