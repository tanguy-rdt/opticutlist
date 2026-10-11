import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppRouter } from '../../../app/router'
import ProjectImport from '../ProjectImport.vue'
import ProjectExport from '../ProjectExport.vue'
import { projectTransferServiceKey } from '../project-transfer-service'
import { projectTransferSchema } from '../../../application/projects/project-transfer-format'
import type { ProjectTransferService } from '../../../application/projects/project-transfer-service'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => { wrapper.unmount() }); wrappers.length = 0; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
const file = projectTransferSchema.parse({ format: 'opticutlist-project', schemaVersion: 1, project: { id: 'import-ui', name: 'Workshop', partIds: [], materialIds: [], supplierProductIds: [] }, parts: [], catalog: { materials: [], suppliers: [], products: [] }, savedPlans: [] })
function service() {
  return { preview: vi.fn<ProjectTransferService['preview']>().mockResolvedValue({ ok: true, value: { file, projectIdCollision: true, catalogConflicts: 2, reusedCatalogRecords: 1 } }), import: vi.fn<ProjectTransferService['import']>().mockResolvedValue({ ok: true, value: file.project }), export: vi.fn<ProjectTransferService['export']>().mockResolvedValue({ ok: true, value: { text: JSON.stringify(file), name: 'Workshop' } }) }
}
async function setup() {
  const port = service()
  const router = createAppRouter(createMemoryHistory()); await router.push('/import'); await router.isReady()
  const wrapper = mount(ProjectImport, { global: { plugins: [router], provide: { [projectTransferServiceKey]: port } } }); wrappers.push(wrapper)
  return { wrapper, port, router }
}
async function choose(wrapper: VueWrapper, text: string | Promise<string> = JSON.stringify(file), filename = 'project.pocl') {
  const input = wrapper.get('#project-import-file')
  const selected = new File([''], filename, { type: 'application/json' })
  Object.defineProperty(selected, 'text', { value: () => Promise.resolve(text) })
  Object.defineProperty(input.element, 'files', { configurable: true, value: [selected] })
  await input.trigger('change')
  await flushPromises()
}
describe('project import and export controls', () => {
  it('reads a JSON file, previews counts/conflicts, requires explicit consent and links to the imported project', async () => {
    const { wrapper, port, router } = await setup()
    expect(wrapper.get('input[type=file]').attributes('accept')).toBe('.pocl,.json,application/json')
    await choose(wrapper)
    expect(port.preview).toHaveBeenCalledWith(JSON.stringify(file)); expect(port.import).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Import preview: Workshop')
    expect(wrapper.text()).toContain('0 Parts'); expect(wrapper.text()).toContain('new project ID')
    expect(wrapper.text()).toContain('2 catalog conflicts'); expect(wrapper.text()).toContain('Stock and physical cutting confirmations are excluded')
    const consent = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await wrapper.get('button').trigger('click'); expect(port.import).not.toHaveBeenCalled()
    consent.mockReturnValue(true)
    await wrapper.get('button').trigger('click'); await flushPromises()
    expect(port.import).toHaveBeenCalledExactlyOnceWith(file, true)
    expect(wrapper.text()).toContain('imported successfully')
    await wrapper.get('a[href="/projects/import-ui/parts"]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/projects/import-ui/parts')
  })
  it('continues importing legacy .json project files', async () => {
    const { wrapper, port } = await setup(); await choose(wrapper, JSON.stringify(file), 'legacy.json')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await wrapper.get('button').trigger('click'); await flushPromises()
    expect(port.import).toHaveBeenCalledExactlyOnceWith(file, true)
  })
  it('shows malformed-file errors without a preview or a write and permits choosing a new file', async () => {
    const { wrapper, port } = await setup()
    port.preview.mockResolvedValueOnce({ ok: false, error: { kind: 'invalidRecord', issues: [{ path: ['schemaVersion'], message: 'Unsupported version' }] } })
    await choose(wrapper, '{bad')
    expect(wrapper.get('[role="alert"]').text()).toContain('Unsupported version')
    expect(wrapper.find('button').exists()).toBe(false); expect(port.import).not.toHaveBeenCalled()
    await choose(wrapper)
    expect(wrapper.text()).toContain('Import preview'); expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })
  it('retains the validated preview after a failed atomic import and allows retry', async () => {
    const { wrapper, port } = await setup(); await choose(wrapper)
    port.import.mockResolvedValueOnce({ ok: false, error: { kind: 'storageFailure', message: 'Disk full' } })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await wrapper.get('button').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('Import preview'); expect(wrapper.get('[role="alert"]').text()).toContain('Could not access local storage')
    await wrapper.get('button').trigger('click'); await flushPromises(); expect(wrapper.text()).toContain('imported successfully')
  })
  it('discards late file reads after replacement or unmount', async () => {
    const { wrapper, port } = await setup()
    let resolve: ((text: string) => void) | undefined
    const pending = new Promise<string>(done => { resolve = done })
    await choose(wrapper, pending)
    expect(wrapper.get('[role="status"]').text()).toContain('Reading')
    wrapper.unmount(); resolve?.(JSON.stringify(file)); await flushPromises()
    expect(port.import).not.toHaveBeenCalled()
  })
  it('downloads readable UTF-8 JSON and releases temporary links and URLs', async () => {
    const port = service()
    const create = vi.fn<(blob: Blob) => string>(() => 'blob:project-json'); const revoke = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
    let filename = ''
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filename = this.download })
    const wrapper = mount(ProjectExport, { props: { projectId: file.project.id }, global: { provide: { [projectTransferServiceKey]: port } } }); wrappers.push(wrapper)
    vi.useFakeTimers()
    await wrapper.get('button').trigger('click'); await flushPromises()
    expect(port.export).toHaveBeenCalledWith(file.project.id); expect(click).toHaveBeenCalledOnce(); expect(filename).toBe('Workshop.pocl')
    const blob: unknown = create.mock.calls[0]?.[0]
    expect(blob).toBeInstanceOf(Blob)
    if (!(blob instanceof Blob)) throw new Error('Blob')
    expect(blob.type).toBe('application/json;charset=utf-8')
    expect(document.querySelector('a[download]')).toBeNull()
    expect(wrapper.text()).toContain('download started')
    vi.advanceTimersByTime(1000); expect(revoke).toHaveBeenCalledWith('blob:project-json')
  })
  it('shows export failures and never creates a download', async () => {
    const port = service(); port.export.mockResolvedValueOnce({ ok: false, error: { kind: 'notFound', id: file.project.id } })
    const wrapper = mount(ProjectExport, { props: { projectId: file.project.id }, global: { provide: { [projectTransferServiceKey]: port } } }); wrappers.push(wrapper)
    await wrapper.get('button').trigger('click'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('no longer exists')
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })
})
