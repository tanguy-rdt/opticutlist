import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

export interface PdfPreviewDocument {
  readonly pageCount: number
  render: (page: number, canvas: HTMLCanvasElement, width: number, zoom: number, signal: AbortSignal) => Promise<void>
  destroy: () => Promise<void>
}

/** PDF.js is loaded only for document preview, with a local Vite worker and detached bytes. */
export async function loadPdfPreview(bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<PdfPreviewDocument> {
  const pdfjs = await import('pdfjs-dist')
  signal.throwIfAborted()
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const loading = pdfjs.getDocument({ data: bytes.slice() })
  let destruction: Promise<void> | undefined
  const destroy = () => {
    destruction ??= loading.destroy();
    return destruction
  }
  const abort = () => {
    void destroy().catch(() => { /* obsolete load */ })
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    const document = await loading.promise
    signal.throwIfAborted()
    return {
      pageCount: document.numPages,
      async render(pageNumber, canvas, width, zoom, renderSignal) {
        const page = await document.getPage(pageNumber)
        renderSignal.throwIfAborted()
        const natural = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: Math.max(1, width - 40) / natural.width * zoom })
        const ratio = Math.min(window.devicePixelRatio || 1, 2)
        canvas.width = Math.ceil(viewport.width * ratio);
        canvas.height = Math.ceil(viewport.height * ratio)
        canvas.style.width = `${String(viewport.width)}px`;
        canvas.style.height = `${String(viewport.height)}px`
        const task = page.render({ canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0] })
        const cancel = () => {
          task.cancel()
        }
        renderSignal.addEventListener('abort', cancel, { once: true })
        try {
          await task.promise;
          renderSignal.throwIfAborted()
        }
        finally {
          renderSignal.removeEventListener('abort', cancel);
          page.cleanup()
        }
      },
      async destroy() {
        signal.removeEventListener('abort', abort);
        await destroy()
      },
    }
  } catch (error) {
    signal.removeEventListener('abort', abort)
    await destroy().catch(() => { /* preserve the original failure */ })
    throw error
  }
}
