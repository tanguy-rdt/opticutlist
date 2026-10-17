import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadPdfPreview } from '@/ui/pdf/pdf-preview'

const fake = vi.hoisted(() => {
  const cancel = vi.fn()
  const cleanup = vi.fn()
  const render = vi.fn(() => ({ promise: Promise.resolve(), cancel }))
  const getPage = vi.fn(() => Promise.resolve({ getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }), render, cleanup }))
  const destroy = vi.fn(() => Promise.resolve())
  const getDocument = vi.fn<(options: { data: Uint8Array<ArrayBuffer> }) => { promise: Promise<{ numPages: number; getPage: typeof getPage }>; destroy: typeof destroy }>(() => ({ promise: Promise.resolve({ numPages: 4, getPage }), destroy }))
  return { cancel, cleanup, render, getPage, destroy, getDocument, GlobalWorkerOptions: { workerSrc: '' } }
})
vi.mock('pdfjs-dist', () => fake)
afterEach(() => { vi.clearAllMocks() })
describe('local PDF.js preview adapter', () => {
  it('loads detached bytes through the local worker and renders one uniformly scaled page', async () => {
    const bytes = new Uint8Array([1, 2])
    const preview = await loadPdfPreview(bytes, new AbortController().signal)
    expect(preview.pageCount).toBe(4)
    expect(fake.getDocument).toHaveBeenCalledWith({ data: bytes })
    const sent = vi.mocked(fake.getDocument).mock.calls[0]
    expect(sent?.[0].data).not.toBe(bytes)
    expect(fake.GlobalWorkerOptions.workerSrc).toContain('pdf.worker')
    const canvas = document.createElement('canvas')
    await preview.render(2, canvas, 640, 1, new AbortController().signal)
    expect(fake.getPage).toHaveBeenCalledWith(2)
    expect(canvas.style.width).toBe('600px')
    expect(canvas.style.height).toBe('800px')
    expect(fake.cleanup).toHaveBeenCalledOnce()
    await preview.destroy()
    expect(fake.destroy).toHaveBeenCalledOnce()
    expect(bytes).toEqual(new Uint8Array([1, 2]))
  })
  it('cancels obsolete rendering and destroys an aborted loading task', async () => {
    let finish: () => void = () => { throw new Error('Not rendering') }
    fake.render.mockImplementationOnce(() => ({ promise: new Promise<void>(resolve => { finish = resolve }), cancel: fake.cancel }))
    const loading = new AbortController()
    const preview = await loadPdfPreview(new Uint8Array([1]), loading.signal)
    const rendering = new AbortController()
    const result = preview.render(1, document.createElement('canvas'), 640, 1, rendering.signal)
    await vi.waitFor(() => { expect(fake.render).toHaveBeenCalledOnce() })
    rendering.abort(); finish()
    await expect(result).rejects.toThrow()
    expect(fake.cancel).toHaveBeenCalledOnce()
    expect(fake.cleanup).toHaveBeenCalledOnce()
    loading.abort()
    await preview.destroy()
    expect(fake.destroy).toHaveBeenCalledOnce()
  })
})
