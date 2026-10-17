import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PdfExportControls from '@/ui/components/optimization/PdfExportControls.vue'
import { cuttingPlanPdfServiceKey, downloadCuttingPlanPdf } from '@/ui/composables/use-pdf-export-service'
import { createCuttingPlanPdfService, type ProjectCuttingPdfDocument } from '../../../application/export/cutting-plan-pdf-service'
import { pdfRequest, projectPdfRequest } from '../../../application/export/__tests__/pdf-fixtures'
import { applyPlanEdit, createPlanEditingSession, currentEditingPlan } from '../../../application/optimization/plan-editing-session'
import { rotationInput, rotationPlan } from '../../../domain/cutting-tree/__tests__/editing-fixtures'
import { viewerPart } from '../../../domain/cutting-tree/__tests__/viewer-fixtures'

const createUrl = vi.fn<(blob: Blob) => string>(() => 'blob:pdf-export')
const revokeUrl = vi.fn()
const click = vi.fn<() => void>()
const wrappers: VueWrapper[] = []
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  createUrl.mockClear(); revokeUrl.mockClear(); click.mockReset()
  vi.stubGlobal('URL', { createObjectURL: createUrl, revokeObjectURL: revokeUrl })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click)
})
afterEach(() => {
  wrappers.forEach(wrapper => { wrapper.unmount() }); wrappers.length = 0
  vi.runAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})
function setup(generate = vi.fn<(document: ProjectCuttingPdfDocument) => Promise<Uint8Array<ArrayBuffer>>>().mockResolvedValue(new Uint8Array([1, 2]))) {
  const props = { input: projectPdfRequest(), title: 'Workshop project' }
  const wrapper = mount(PdfExportControls, { props, global: { provide: { [cuttingPlanPdfServiceKey]: createCuttingPlanPdfService({ generate: vi.fn(), generateProject: generate }) } } })
  wrappers.push(wrapper)
  return { wrapper, generate }
}
describe('PDF export controls', () => {
  it('supports both A4 orientations and downloads a validated optimized plan', async () => {
    const { wrapper, generate } = setup()
    expect(wrapper.get<HTMLSelectElement>('select').element.value).toBe('portrait')
    await wrapper.get('button[aria-describedby="pdf-export-help"]').trigger('click'); await flushPromises()
    expect(generate.mock.calls[0]?.[0].orientation).toBe('portrait')
    expect(generate.mock.calls[0]?.[0].panels[0]?.edited).toBe(false)
    expect(wrapper.text()).not.toContain('PDF download started')
    await wrapper.get('select').setValue('landscape')
    await wrapper.get('button[aria-describedby="pdf-export-help"]').trigger('click'); await flushPromises()
    expect(generate.mock.calls[1]?.[0].orientation).toBe('landscape')
    expect(createUrl).toHaveBeenCalledTimes(4)
    expect(click).toHaveBeenCalledTimes(2)
    expect(document.querySelector('a[download]')).toBeNull()
    vi.advanceTimersByTime(60_000)
    expect(revokeUrl).toHaveBeenCalledTimes(3)
  })
  it('exports accepted edits, undo and reset snapshots rather than mutating the baseline', async () => {
    const { wrapper, generate } = setup()
    const original = structuredClone(rotationPlan)
    const session = createPlanEditingSession(rotationPlan, rotationInput)
    if (!session.ok) throw new Error(session.error.message)
    const edit = applyPlanEdit(session.session, { kind: 'rotate', copy: { partId: viewerPart.id, copyIndex: 0 } })
    if (!edit.ok) throw new Error(edit.error.message)
    await wrapper.setProps({ input: projectPdfRequest({ ...pdfRequest, plan: currentEditingPlan(edit.session), edited: true }) })
    await wrapper.get('button[aria-describedby="pdf-export-help"]').trigger('click'); await flushPromises()
    expect(generate.mock.calls[0]?.[0].panels[0]).toMatchObject({ edited: true, scene: { parts: [{ orientation: 'normal', region: { xMm: 5, yMm: 5, lengthMm: 50, widthMm: 30 } }] } })
    await wrapper.setProps({ input: projectPdfRequest({ ...pdfRequest, plan: rotationPlan, edited: false }) })
    await wrapper.get('button[aria-describedby="pdf-export-help"]').trigger('click'); await flushPromises()
    expect(generate.mock.calls[1]?.[0].panels[0]).toMatchObject({ edited: false, scene: { parts: [{ orientation: 'rotated' }] } })
    expect(rotationPlan).toEqual(original)
  })
  it('shows clear invalid-tree errors and never calls generation or download', async () => {
    const { wrapper, generate } = setup()
    await wrapper.setProps({ input: projectPdfRequest({ ...pdfRequest, plan: { ...rotationPlan, tree: { ...rotationPlan.tree, region: { xMm: 6, yMm: 5, lengthMm: 90, widthMm: 70 } } } }) })
    await wrapper.get('button[aria-describedby="pdf-export-help"]').trigger('click'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('PDF export failed')
    expect(generate).not.toHaveBeenCalled()
    expect(createUrl).not.toHaveBeenCalled()
  })
  it('preserves the plan on generation failure and permits retry', async () => {
    const { wrapper, generate } = setup(vi.fn<(document: ProjectCuttingPdfDocument) => Promise<Uint8Array<ArrayBuffer>>>().mockRejectedValueOnce(new Error('Font unavailable')).mockResolvedValue(new Uint8Array([1])))
    await wrapper.get('button[aria-describedby="pdf-export-help"]').trigger('click'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Font unavailable')
    expect(wrapper.get('button[aria-describedby="pdf-export-help"]').attributes('disabled')).toBeUndefined()
    expect(createUrl).not.toHaveBeenCalled()
    await wrapper.get('button[aria-describedby="pdf-export-help"]').trigger('click'); await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(createUrl).toHaveBeenCalledTimes(2)
    expect(generate.mock.calls[0]?.[0].panels[0]?.scene).toEqual(generate.mock.calls[1]?.[0].panels[0]?.scene)
  })
  it.each(['plan replacement', 'unmount'] as const)('discards pending exports after %s', async change => {
    let resolve: ((bytes: Uint8Array<ArrayBuffer>) => void) | undefined
    const generate = vi.fn<(document: ProjectCuttingPdfDocument) => Promise<Uint8Array<ArrayBuffer>>>(() => new Promise(done => { resolve = done }))
    const { wrapper } = setup(generate)
    await wrapper.get('button[aria-describedby="pdf-export-help"]').trigger('click')
    expect(wrapper.text()).toContain('Generating PDF')
    expect(wrapper.get('button[aria-describedby="pdf-export-help"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('select').attributes('disabled')).toBeDefined()
    if (change === 'unmount') wrapper.unmount()
    else await wrapper.setProps({ input: projectPdfRequest({ ...pdfRequest, plan: structuredClone(rotationPlan) }) })
    resolve?.(new Uint8Array([1])); await flushPromises()
    expect(createUrl).not.toHaveBeenCalled()
  })
  it('reports download failures and releases temporary URLs even when clicking fails', async () => {
    const { wrapper } = setup()
    click.mockImplementationOnce(() => { throw new Error('Downloads blocked') })
    await wrapper.get('button[aria-describedby="pdf-export-help"]').trigger('click'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Downloads blocked')
    expect(document.querySelector('a[download]')).toBeNull()
    vi.advanceTimersByTime(60_000)
    expect(revokeUrl).toHaveBeenCalledOnce()
  })
  it('creates a PDF Blob and a named native download link', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('opticutlist-cutting-plan.pdf')
      expect(this.href).toBe('blob:pdf-export')
      expect(this.isConnected).toBe(true)
    })
    downloadCuttingPlanPdf(new Uint8Array([1, 2]))
    const blob = createUrl.mock.calls[0]?.[0]
    expect(blob).toBeInstanceOf(Blob)
    expect(click).toHaveBeenCalledOnce()
  })
})

it('cleans download URLs on document exit without waiting for the grace timer', () => {
  downloadCuttingPlanPdf(new Uint8Array([1]))
  expect(revokeUrl).not.toHaveBeenCalled()
  window.dispatchEvent(new Event('pagehide'))
  expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:pdf-export')
  vi.advanceTimersByTime(60_000)
  expect(revokeUrl).toHaveBeenCalledOnce()
  expect(document.querySelector('a[download]')).toBeNull()
})
