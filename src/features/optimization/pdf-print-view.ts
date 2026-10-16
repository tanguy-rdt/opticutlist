export interface PdfPrintView {
  show(bytes: Uint8Array<ArrayBuffer>): void
  close(): void
}

/** Open synchronously from a user gesture. The viewer owns its Blob URL until it closes. */
export function openPdfPrintView(): PdfPrintView {
  const viewer = window.open('', '_blank')
  if (!viewer) throw new Error('Allow popups for OptiCutList, then try Print again.')
  viewer.opener = null
  let release: (() => void) | undefined
  const close = () => { release?.(); if (!viewer.closed) viewer.close() }
  try {
    viewer.document.title = 'Preparing PDF…'
    viewer.document.body.textContent = 'Preparing PDF…'
    return {
      close,
      show(bytes) {
        if (viewer.closed) throw new Error('The print tab was closed. Click Print to open it again.')
        // Creating the URL in the viewer's realm also gives it browser-managed unload cleanup.
        const urls = viewer.document.defaultView?.URL
        if (!urls) throw new Error('The browser could not open the PDF viewer. Try Print again.')
        const url = urls.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
        let released = false
        release = () => {
          if (released) return
          released = true; urls.revokeObjectURL(url)
          viewer.removeEventListener('pagehide', releaseUrl)
        }
        const releaseUrl = () => { release?.() }
        viewer.addEventListener('pagehide', releaseUrl, { once: true })
        try {
          const frame = viewer.document.createElement('iframe')
          frame.title = 'Cutting plan PDF — use the PDF viewer Print control'
          frame.src = url
          frame.style.cssText = 'display:block;width:100%;height:100dvh;border:0'
          viewer.document.title = 'Print cutting plans'
          viewer.document.body.style.margin = '0'
          viewer.document.body.replaceChildren(frame)
        } catch (cause) { close(); throw cause }
      },
    }
  } catch (cause) { close(); throw cause }
}
