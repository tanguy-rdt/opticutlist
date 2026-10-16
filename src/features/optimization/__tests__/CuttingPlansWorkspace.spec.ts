import { createPinia, setActivePinia } from 'pinia'
import { useToastStore } from '../../../shared/ui/toast-store'
import { openPdfPrintView } from '../pdf-print-view'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as PdfExportModule from '../pdf-export-service'
import CuttingPlansWorkspace from '../CuttingPlansWorkspace.vue'
import { loadPdfPreview, type PdfPreviewDocument } from '../pdf-preview'
import { cuttingPlanPdfServiceKey, downloadCuttingPlanPdf, readCoverImage } from '../pdf-export-service'
import { createCuttingPlanPdfService, type ProjectCuttingPdfDocument } from '../../../application/export/cutting-plan-pdf-service'
import { pngCover, jpegCover } from '../../../infrastructure/pdf/__tests__/cover-image-fixtures'
import { pdfRequest, projectPdfRequest } from '../../../application/export/__tests__/pdf-fixtures'
import { rotationPlan } from '../../../domain/cutting-tree/__tests__/editing-fixtures'

vi.mock('../pdf-print-view', () => ({ openPdfPrintView: vi.fn() }))
vi.mock('../pdf-preview', () => ({ loadPdfPreview: vi.fn() }))
vi.mock('../pdf-export-service', async importOriginal => ({ ...await importOriginal<typeof PdfExportModule>(), downloadCuttingPlanPdf: vi.fn(), readCoverImage: vi.fn() }))
const wrappers: VueWrapper[] = []
function preview(): PdfPreviewDocument {
  return { pageCount: 3, render: vi.fn(() => Promise.resolve()), destroy: vi.fn(() => Promise.resolve()) }
}
beforeEach(() => { setActivePinia(createPinia()); vi.mocked(openPdfPrintView).mockReset(); vi.mocked(loadPdfPreview).mockReset(); vi.mocked(loadPdfPreview).mockResolvedValue(preview()); vi.mocked(downloadCuttingPlanPdf).mockClear() })
afterEach(() => { wrappers.forEach(wrapper => { wrapper.unmount() }); wrappers.length = 0; vi.restoreAllMocks(); vi.unstubAllGlobals() })
function setup(generate = vi.fn<(document: ProjectCuttingPdfDocument) => Promise<Uint8Array<ArrayBuffer>>>().mockResolvedValue(new Uint8Array([1, 2]))) {
  const input = projectPdfRequest()
  const before = structuredClone(input)
  const wrapper = mount(CuttingPlansWorkspace, { props: { input, title: 'Workshop project' }, global: { provide: { [cuttingPlanPdfServiceKey]: createCuttingPlanPdfService({ generate: vi.fn(), generateProject: generate }) } } })
  wrappers.push(wrapper)
  return { wrapper, generate, input, before }
}
async function click(wrapper: VueWrapper, text: string): Promise<void> {
  const button = wrapper.findAll('button').find(button => button.text() === text)
  if (!button) throw new Error(`Missing ${text}`)
  await button.trigger('click'); await flushPromises()
}
describe('Cutting Plans workspace', () => {
  it('defaults to Portrait, edits only cover metadata and clears redundant title overrides', async () => {
    const { wrapper, generate } = setup()
    await flushPromises()
    expect(generate.mock.calls.at(-1)?.[0].orientation).toBe('portrait')
    expect(wrapper.get<HTMLInputElement>('#pdf-document-title').element.value).toBe('Workshop project')
    await wrapper.get('#pdf-document-title').setValue('Fabrication package')
    await wrapper.get('#pdf-document-title').trigger('change')
    await wrapper.get('#pdf-description').setValue('Kitchen storage\nPainted finish')
    await wrapper.get('#pdf-description').trigger('change')
    await flushPromises()
    expect(generate.mock.calls.at(-1)?.[0]).toMatchObject({ title: 'Workshop project', cover: { title: 'Fabrication package', description: 'Kitchen storage\nPainted finish' } })
    expect(wrapper.emitted('settingsChange')?.at(-1)).toEqual([{ titleOverride: 'Fabrication package', description: 'Kitchen storage\nPainted finish' }])
    await wrapper.get('#pdf-document-title').setValue('')
    await wrapper.get('#pdf-document-title').trigger('change')
    await flushPromises()
    expect(wrapper.get<HTMLInputElement>('#pdf-document-title').element.value).toBe('Workshop project')
    expect(wrapper.emitted('settingsChange')?.at(-1)).toEqual([{ description: 'Kitchen storage\nPainted finish' }])
    await wrapper.setProps({ title: 'Renamed project' })
    expect(wrapper.get<HTMLInputElement>('#pdf-document-title').element.value).toBe('Renamed project')
    await wrapper.setProps({ settings: { orientation: 'landscape', pageSize: 'A3', titleOverride: 'Saved title', coverImage: pngCover } })
    await flushPromises()
    expect(generate.mock.calls.at(-1)?.[0]).toMatchObject({ orientation: 'landscape', pageSize: 'A3', cover: { title: 'Saved title', image: pngCover } })
    expect(wrapper.get('img[alt="Selected cover image"]').attributes('src')).toBe('data:image/png;base64,' + pngCover.data)
  })

  it('validates, replaces and removes cover images without persisting preview URLs', async () => {
    const { wrapper, generate } = setup()
    await flushPromises()
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.get('#pdf-description').attributes('rows')).toBe('4')
    const picker = wrapper.get<HTMLInputElement>('#pdf-cover-image')
    expect(picker.classes()).toContain('hidden')
    expect(picker.attributes('aria-hidden')).toBe('true')
    const nativeClick = vi.spyOn(picker.element, 'click').mockImplementation(() => undefined)
    await click(wrapper, 'Choose image')
    expect(nativeClick).toHaveBeenCalledOnce()
    const choose = async (name: string) => {
      const input = wrapper.get<HTMLInputElement>('#pdf-cover-image')
      Object.defineProperty(input.element, 'files', { configurable: true, value: [new File(['fixture'], name)] })
      await input.trigger('change'); await flushPromises()
    }
    vi.mocked(readCoverImage).mockResolvedValueOnce(pngCover)
    await choose('cover.png')
    expect(generate.mock.calls.at(-1)?.[0].cover?.image).toEqual(pngCover)
    expect(wrapper.get('button[aria-label="Remove cover image"]').text()).toBe('Remove')
    await click(wrapper, 'Replace')
    expect(nativeClick).toHaveBeenCalledTimes(2)
    expect(wrapper.get('button[aria-label="Replace cover image"]').attributes('aria-describedby')).toBe('pdf-cover-image-picker-error')
    vi.mocked(readCoverImage).mockResolvedValueOnce(jpegCover)
    await choose('replacement.jpg')
    expect(generate.mock.calls.at(-1)?.[0].cover?.image).toEqual(jpegCover)
    const count = generate.mock.calls.length
    vi.mocked(readCoverImage).mockRejectedValueOnce(new Error('Choose a PNG or JPEG image.'))
    await choose('invalid.gif')
    expect(wrapper.text()).toContain('Choose a PNG or JPEG image.')
    expect(generate).toHaveBeenCalledTimes(count)
    expect(wrapper.get('img').attributes('src')).toContain(jpegCover.data)
    await click(wrapper, 'Remove')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(generate.mock.calls.at(-1)?.[0].cover?.image).toBeUndefined()
    expect(wrapper.emitted('settingsChange')?.at(-1)).toEqual([{}])
  })

  it('ignores an obsolete image read after removal', async () => {
    const { wrapper } = setup()
    await wrapper.setProps({ settings: { coverImage: pngCover } })
    await flushPromises()
    let finish: ((image: typeof jpegCover) => void) | undefined
    vi.mocked(readCoverImage).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const input = wrapper.get<HTMLInputElement>('#pdf-cover-image')
    Object.defineProperty(input.element, 'files', { configurable: true, value: [new File(['fixture'], 'new.jpg')] })
    await input.trigger('change')
    await click(wrapper, 'Remove')
    finish?.(jpegCover)
    await flushPromises()
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.emitted('settingsChange')?.at(-1)).toEqual([{}])
  })

  it('automatically previews and downloads the identical generated bytes without native PDF or stock controls', async () => {
    const { wrapper, generate, input, before } = setup()
    await flushPromises()
    expect(generate).toHaveBeenCalledOnce()
    expect(loadPdfPreview).toHaveBeenCalledWith(new Uint8Array([1, 2]), expect.any(AbortSignal))
    expect(wrapper.find('canvas').exists()).toBe(true)
    expect(wrapper.find('object, iframe, select').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Preview PDF')
    expect(wrapper.text()).not.toContain('Confirm Cutting')
    expect(wrapper.text()).not.toContain('Preview the complete cutting document')
    expect(wrapper.text()).not.toContain('The preview updates automatically')
    const download = wrapper.findAll('button').find(button => button.text() === 'Download PDF')
    expect(download?.element.closest('aside')).toBe(wrapper.get('.document-settings').element)
    await click(wrapper, 'Download PDF')
    expect(downloadCuttingPlanPdf).toHaveBeenCalledWith(new Uint8Array([1, 2]))
    expect(generate).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).not.toContain('PDF download started')
    expect(useToastStore().notifications).toEqual([])
    expect(input).toEqual(before)
  })
  it('regenerates A3 and explicit landscape using the same validated result and resets page navigation', async () => {
    const { wrapper, generate } = setup()
    await flushPromises()
    expect(wrapper.get('[aria-label="Current PDF page"]').text()).toBe('1 / 3')
    await click(wrapper, 'A3')
    expect(generate.mock.calls.at(-1)?.[0]).toMatchObject({ pageSize: 'A3', orientation: 'portrait' })
    expect(wrapper.get('[aria-label="Current PDF page"]').text()).toBe('1 / 3')
    await click(wrapper, 'Landscape')
    expect(generate.mock.calls.at(-1)?.[0]).toMatchObject({ pageSize: 'A3', orientation: 'landscape' })
    await click(wrapper, 'A4')
    expect(generate.mock.calls.at(-1)?.[0].pageSize).toBe('A4')
  })
  it('renders every page in order and zooms the continuous document without regenerating it', async () => {
    const pdf = preview(); vi.mocked(loadPdfPreview).mockResolvedValue(pdf)
    const { wrapper, generate } = setup()
    await flushPromises()
    expect(vi.mocked(pdf.render).mock.calls.map(call => call[0])).toEqual([1, 2, 3])
    expect(wrapper.findAll('[data-pdf-page]').map(page => page.attributes('data-pdf-page'))).toEqual(['1', '2', '3'])
    expect(wrapper.find('[aria-label="Document pages"]').exists()).toBe(false)
    expect(wrapper.get('[aria-labelledby="document-settings-title"]').text()).toContain('Document settings')
    expect(wrapper.get('[aria-label="Preview zoom"]').element.closest('aside')).toBeNull()
    expect(pdf.render).toHaveBeenLastCalledWith(3, expect.any(HTMLCanvasElement), 800, 1, expect.any(AbortSignal))
    await wrapper.get('[aria-label="Zoom in preview"]').trigger('click'); await flushPromises()
    expect(pdf.render).toHaveBeenLastCalledWith(3, expect.any(HTMLCanvasElement), 800, 1.25, expect.any(AbortSignal))
    expect(wrapper.findAll('canvas')).toHaveLength(3)
    expect(generate).toHaveBeenCalledOnce()
    wrapper.unmount(); expect(pdf.destroy).toHaveBeenCalledOnce()
  })
  it('updates the current-page indicator from continuous scrolling without rerendering pages', async () => {
    const pdf = preview(); vi.mocked(loadPdfPreview).mockResolvedValue(pdf)
    const { wrapper } = setup()
    await flushPromises()
    const viewport = wrapper.get('[aria-label="Scrollable cutting document"]')
    Object.defineProperty(viewport.element, 'clientHeight', { value: 600 })
    vi.spyOn(viewport.element, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600))
    const sheets = wrapper.findAll('[data-pdf-page]')
    sheets.forEach((sheet, index) => { vi.spyOn(sheet.element, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, index * 820 - 850, 700, 800)) })
    await viewport.trigger('scroll')
    expect(wrapper.get('[aria-label="Current PDF page"]').text()).toBe('2 / 3')
    expect(pdf.render).toHaveBeenCalledTimes(3)
    expect(wrapper.findAll('canvas')).toHaveLength(3)
  })
  it('preserves the reading anchor on zoom and caps page width on wide screens', async () => {
    const pdf = preview(); vi.mocked(loadPdfPreview).mockResolvedValue(pdf)
    const { wrapper } = setup()
    await flushPromises()
    const viewport = wrapper.get<HTMLElement>('[aria-label="Scrollable cutting document"]')
    Object.defineProperty(viewport.element, 'clientHeight', { value: 600 })
    Object.defineProperty(viewport.element, 'clientWidth', { value: 1200 })
    viewport.element.scrollTop = 862
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const index = Number(this.dataset.pdfPage)
      return index ? new DOMRect(0, (index - 1) * 1032 - viewport.element.scrollTop, 700, 1000) : new DOMRect()
    })
    Object.defineProperty(viewport.element, 'getBoundingClientRect', { value: () => new DOMRect(0, 0, 1200, 600) })
    wrapper.findAll('[data-pdf-page]').forEach((sheet, index) => {
      Object.defineProperty(sheet.element, 'getBoundingClientRect', { value: () => new DOMRect(0, index * 832 - viewport.element.scrollTop, 700, 800) })
    })
    await viewport.trigger('scroll')
    expect(wrapper.get('[aria-label="Current PDF page"]').text()).toBe('2 / 3')
    await wrapper.get('[aria-label="Zoom in preview"]').trigger('click'); await flushPromises()
    expect(viewport.element.scrollTop).toBe(1069.5)
    expect(wrapper.get('[aria-label="Current PDF page"]').text()).toBe('2 / 3')
    expect(pdf.render).toHaveBeenLastCalledWith(3, expect.any(HTMLCanvasElement), 900, 1.25, expect.any(AbortSignal))
  })
  it.each([
    { height: 900, top: 210, expected: '670px' },
    { height: 768, top: 210, expected: '538px' },
  ])('fills the remaining viewport at $height pixels and updates on resize', async ({ height, top, expected }) => {
    vi.stubGlobal('innerHeight', height)
    const { wrapper, generate } = setup()
    await flushPromises()
    const root = wrapper.get<HTMLElement>('[aria-label="Cutting Plans document workspace"]')
    vi.spyOn(root.element, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, top, 1200, 600))
    window.dispatchEvent(new Event('resize'))
    expect(root.element.style.height).toBe(expected)
    vi.stubGlobal('innerHeight', height - 100)
    window.dispatchEvent(new Event('resize'))
    expect(root.element.style.height).toBe(`${String(height - 100 - top - 20)}px`)
    expect(generate).toHaveBeenCalledOnce()
    const remove = vi.spyOn(window, 'removeEventListener')
    wrapper.unmount()
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function))
  })
  it('rejects invalid current plans and keeps download unavailable', async () => {
    const { wrapper, generate } = setup()
    await flushPromises(); generate.mockClear()
    await wrapper.setProps({ input: projectPdfRequest({ ...pdfRequest, plan: { ...rotationPlan, tree: { ...rotationPlan.tree, region: { xMm: 6, yMm: 5, lengthMm: 90, widthMm: 70 } } } }) })
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(generate).not.toHaveBeenCalled()
    expect(wrapper.find('canvas').exists()).toBe(false)
    await click(wrapper, 'Download PDF')
    expect(downloadCuttingPlanPdf).not.toHaveBeenCalled()
    expect(useToastStore().notifications[0]?.kind).toBe('error')
  })
  it('discards stale generation and aborted render results on settings changes or exit', async () => {
    let finishGeneration: (bytes: Uint8Array<ArrayBuffer>) => void = () => { throw new Error('Not started') }
    const generate = vi.fn<(document: ProjectCuttingPdfDocument) => Promise<Uint8Array<ArrayBuffer>>>().mockImplementationOnce(() => new Promise(resolve => { finishGeneration = resolve })).mockResolvedValue(new Uint8Array([3]))
    const { wrapper } = setup(generate)
    await click(wrapper, 'A3')
    finishGeneration(new Uint8Array([1])); await flushPromises()
    expect(loadPdfPreview).toHaveBeenCalledOnce()
    expect(loadPdfPreview).toHaveBeenCalledWith(new Uint8Array([3]), expect.any(AbortSignal))
    const pdf = preview()
    let finishRender: () => void = () => { throw new Error('Not rendering') }
    let renderSignal: AbortSignal | undefined
    pdf.render = vi.fn<PdfPreviewDocument['render']>((_page, _canvas, _width, _zoom, signal) => { renderSignal = signal; return new Promise<void>(resolve => { finishRender = resolve }) })
    vi.mocked(loadPdfPreview).mockResolvedValue(pdf)
    await click(wrapper, 'Portrait')
    wrapper.unmount()
    expect(renderSignal?.aborted).toBe(true)
    finishRender(); await flushPromises()
    expect(pdf.destroy).toHaveBeenCalledOnce()
    expect(downloadCuttingPlanPdf).not.toHaveBeenCalled()
  })
  it('never attaches a stale page canvas when zoom supersedes an unfinished render', async () => {
    let finish: () => void = () => { throw new Error('Not rendering') }
    let oldSignal: AbortSignal | undefined
    const pdf = preview()
    pdf.render = vi.fn<PdfPreviewDocument['render']>().mockImplementationOnce((_page, _canvas, _width, _zoom, signal) => {
      oldSignal = signal
      return new Promise(resolve => { finish = resolve })
    }).mockResolvedValue(undefined)
    vi.mocked(loadPdfPreview).mockResolvedValue(pdf)
    const { wrapper } = setup()
    await flushPromises()
    expect(wrapper.find('canvas').exists()).toBe(false)
    await wrapper.get('[aria-label="Zoom in preview"]').trigger('click'); await flushPromises()
    expect(oldSignal?.aborted).toBe(true)
    const current = wrapper.get('canvas').element
    finish(); await flushPromises()
    expect(wrapper.findAll('canvas')).toHaveLength(3)
    expect(wrapper.get('canvas').element).toBe(current)
    expect(pdf.render).toHaveBeenCalledTimes(4)
  })
  it('shows generation or preview failures and offers retry', async () => {
    const generate = vi.fn<(document: ProjectCuttingPdfDocument) => Promise<Uint8Array<ArrayBuffer>>>().mockRejectedValueOnce(new Error('Font failure')).mockResolvedValue(new Uint8Array([4]))
    const { wrapper } = setup(generate); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Font failure')
    await click(wrapper, 'Retry')
    expect(wrapper.find('canvas').exists()).toBe(true)
    vi.mocked(loadPdfPreview).mockRejectedValueOnce(new Error('Preview failure'))
    await click(wrapper, 'A3')
    expect(wrapper.get('[role="alert"]').text()).toContain('Preview failure')
    await click(wrapper, 'Download PDF')
    expect(downloadCuttingPlanPdf).toHaveBeenCalledWith(new Uint8Array([4]))
  })
})

it.each(['download', 'print'] as const)('shows shared button loading and prevents duplicate %s operations', async kind => {
  const { wrapper, generate } = setup()
  await flushPromises()
  const viewer = { show: vi.fn(), close: vi.fn() }
  vi.mocked(openPdfPrintView).mockReturnValue(viewer)
  let finish: ((bytes: Uint8Array<ArrayBuffer>) => void) | undefined
  generate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const label = kind === 'download' ? 'Download PDF' : 'Print'
  const loading = kind === 'download' ? 'Generating PDF…' : 'Preparing…'
  const button = wrapper.findAll('button').find(button => button.text() === label)
  if (!button) throw new Error('Missing action')
  await button.trigger('click')
  expect(button.attributes('aria-busy')).toBe('true')
  expect(button.find('.button-spinner').exists()).toBe(true)
  expect(button.text()).toBe(loading)
  expect(button.attributes('disabled')).toBeDefined()
  expect(wrapper.get('.document-action [role="status"]').text()).toContain(kind === 'download' ? 'Generating PDF' : 'Preparing PDF')
  if (kind === 'print') expect(openPdfPrintView).toHaveBeenCalledOnce()
  await button.trigger('click')
  expect(generate).toHaveBeenCalledTimes(2) // initial preview + this action
  finish?.(new Uint8Array([9])); await flushPromises()
  expect(button.text()).toBe(label)
  expect(button.attributes('disabled')).toBeUndefined()
  expect(button.find('.button-spinner').exists()).toBe(false)
  if (kind === 'print') {
    expect(viewer.show).toHaveBeenCalledWith(new Uint8Array([9]))
    expect(downloadCuttingPlanPdf).not.toHaveBeenCalled()
    expect(viewer.close).not.toHaveBeenCalled()
    wrapper.unmount()
    expect(viewer.close).not.toHaveBeenCalled()
  } else expect(downloadCuttingPlanPdf).toHaveBeenCalledWith(new Uint8Array([9]))
  expect(useToastStore().notifications).toEqual([])
})

it.each(['Download PDF', 'Print'])('uses current cover and orientation settings for %s and restores controls on failure', async label => {
  const { wrapper, generate } = setup()
  const viewer = { show: vi.fn(), close: vi.fn() }
  vi.mocked(openPdfPrintView).mockReturnValue(viewer)
  await wrapper.setProps({ settings: { pageSize: 'A3', orientation: 'landscape', titleOverride: 'Fabrication', description: 'Notes', coverImage: pngCover } })
  await flushPromises()
  generate.mockRejectedValueOnce(new Error('Cannot prepare fonts. Please retry.'))
  await click(wrapper, label)
  expect(generate.mock.calls.at(-1)?.[0]).toMatchObject({ pageSize: 'A3', orientation: 'landscape', cover: { title: 'Fabrication', description: 'Notes', image: pngCover } })
  const button = wrapper.findAll('button').find(button => button.text() === label)
  expect(button?.attributes('disabled')).toBeUndefined()
  expect(button?.find('.button-spinner').exists()).toBe(false)
  expect(useToastStore().notifications).toMatchObject([{ kind: 'error', description: 'Cannot prepare fonts. Please retry.', duration: 0 }])
  expect(downloadCuttingPlanPdf).not.toHaveBeenCalled()
  expect(viewer.show).not.toHaveBeenCalled()
  if (label === 'Print') expect(viewer.close).toHaveBeenCalledOnce()
})

it('reports blocked print popups without generating another document', async () => {
  const { wrapper, generate } = setup(); await flushPromises()
  vi.mocked(openPdfPrintView).mockImplementation(() => { throw new Error('Allow popups for OptiCutList, then try Print again.') })
  await click(wrapper, 'Print')
  expect(generate).toHaveBeenCalledOnce()
  expect(useToastStore().notifications[0]?.description).toContain('Allow popups')
  expect(wrapper.findAll('button').find(button => button.text() === 'Print')?.attributes('disabled')).toBeUndefined()
})

it('closes a pending print tab and discards output when leaving the workspace', async () => {
  const { wrapper, generate } = setup(); await flushPromises()
  const viewer = { show: vi.fn(), close: vi.fn() }
  vi.mocked(openPdfPrintView).mockReturnValue(viewer)
  let finish: ((bytes: Uint8Array<ArrayBuffer>) => void) | undefined
  generate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await click(wrapper, 'Print')
  wrapper.unmount()
  expect(viewer.close).toHaveBeenCalled()
  finish?.(new Uint8Array([9])); await flushPromises()
  expect(viewer.show).not.toHaveBeenCalled()
  expect(useToastStore().notifications).toEqual([])
})

it('reports browser download failures without success feedback and permits another attempt', async () => {
  const { wrapper } = setup(); await flushPromises()
  vi.mocked(downloadCuttingPlanPdf).mockImplementationOnce(() => { throw new Error('Downloads blocked. Check browser download permissions and retry.') })
  await click(wrapper, 'Download PDF')
  expect(useToastStore().notifications).toMatchObject([{ kind: 'error', title: 'Could not download PDF' }])
  expect(useToastStore().notifications[0]?.description).toContain('download permissions')
  expect(wrapper.findAll('button').find(button => button.text() === 'Download PDF')?.attributes('disabled')).toBeUndefined()
  expect(wrapper.text()).not.toContain('PDF download started')
  await click(wrapper, 'Download PDF')
  expect(downloadCuttingPlanPdf).toHaveBeenCalledTimes(2)
})
