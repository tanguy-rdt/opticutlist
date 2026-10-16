import { afterEach, describe, expect, it, vi } from 'vitest'
import { openPdfPrintView } from '../pdf-print-view'

let host: HTMLIFrameElement | undefined
afterEach(() => { host?.remove(); host = undefined; vi.restoreAllMocks() })
function setup() {
  host = document.createElement('iframe'); document.body.append(host)
  const viewer = host.contentWindow
  if (!viewer) throw new Error('Missing print view window')
  const urls = viewer.document.defaultView?.URL
  if (!urls) throw new Error('Missing viewer URL API')
  const create = vi.fn<(blob: Blob) => string>(() => 'blob:print-pdf')
  const revoke = vi.fn()
  Object.defineProperty(urls, 'createObjectURL', { configurable: true, value: create })
  Object.defineProperty(urls, 'revokeObjectURL', { configurable: true, value: revoke })
  const open = vi.spyOn(window, 'open').mockReturnValue(viewer)
  let closed = false
  Object.defineProperty(viewer, 'closed', { configurable: true, get: () => closed })
  const close = vi.spyOn(viewer, 'close').mockImplementation(() => { closed = true; viewer.dispatchEvent(new Event('pagehide')) })
  return { viewer, create, revoke, open, close }
}
describe('Browser PDF print view', () => {
  it('opens synchronously, displays a PDF without downloading, and retains its URL until the viewer exits', () => {
    const { viewer, open, create, revoke } = setup()
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click')
    const view = openPdfPrintView()
    expect(open).toHaveBeenCalledWith('', '_blank')
    expect(viewer.opener).toBeNull()
    expect(create).not.toHaveBeenCalled()
    expect(viewer.document.body.textContent).toContain('Preparing PDF')
    view.show(new Uint8Array([1, 2]))
    const blob = create.mock.calls[0]?.[0]
    expect(blob).toBeInstanceOf(Blob)
    expect(blob?.type).toBe('application/pdf')
    expect(viewer.document.querySelector('iframe')?.getAttribute('src')).toBe('blob:print-pdf')
    expect(viewer.document.querySelector('iframe')?.title).toContain('PDF viewer Print control')
    expect(download).not.toHaveBeenCalled()
    expect(revoke).not.toHaveBeenCalled()
    viewer.dispatchEvent(new Event('pagehide'))
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:print-pdf')
    view.close()
    expect(revoke).toHaveBeenCalledOnce()
  })
  it('reports a blocked popup', () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    expect(() => openPdfPrintView()).toThrow('Allow popups for OptiCutList')
  })
  it('can cancel a pending view and rejects a closed print tab', () => {
    const { close, create } = setup()
    const view = openPdfPrintView()
    view.close(); view.close()
    expect(close).toHaveBeenCalledOnce()
    expect(() => { view.show(new Uint8Array([1])) }).toThrow('print tab was closed')
    expect(create).not.toHaveBeenCalled()
  })
  it('releases resources if constructing the PDF view fails', () => {
    const { viewer, revoke, close } = setup()
    const view = openPdfPrintView()
    vi.spyOn(viewer.document.body, 'replaceChildren').mockImplementationOnce(() => { throw new Error('Viewer unavailable') })
    expect(() => { view.show(new Uint8Array([1])) }).toThrow('Viewer unavailable')
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:print-pdf')
    expect(close).toHaveBeenCalledOnce()
  })
})
