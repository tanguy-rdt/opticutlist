import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CatalogTransfer from '../CatalogTransfer.vue'
import { catalogTransferServiceKey } from '../catalog-transfer-service'
import type { CatalogTransferService } from '../../../application/catalog/catalog-transfer-service'
import { catalogTransferSchema } from '../../../application/catalog/catalog-transfer-format'
import { validMaterialInput, validSupplierInput, validSupplierProductInput } from '../../../domain/model/__tests__/fixtures'
const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => { wrapper.unmount() }); wrappers.length = 0; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
const file = catalogTransferSchema.parse({ format: 'opticutlist-catalog', schemaVersion: 1, catalog: { materials: [validMaterialInput], suppliers: [validSupplierInput], products: [validSupplierProductInput] } })
function setup() {
  const port = { preview: vi.fn<CatalogTransferService['preview']>().mockResolvedValue({ ok: true, value: { file, conflicts: 2, reused: 1 } }), import: vi.fn<CatalogTransferService['import']>().mockResolvedValue({ ok: true, value: file }), export: vi.fn<CatalogTransferService['export']>().mockResolvedValue({ ok: true, value: JSON.stringify(file) }) }
  const wrapper = mount(CatalogTransfer, { props: { disabled: false }, global: { provide: { [catalogTransferServiceKey]: port } } }); wrappers.push(wrapper)
  return { wrapper, port }
}
async function choose(wrapper: VueWrapper, filename = 'catalog.cocl', text: string | Promise<string> = JSON.stringify(file)) {
  if (!wrapper.find('input').exists()) await wrapper.get('button[aria-controls]').trigger('click')
  const input = wrapper.get('input')
  const selected = new File([''], filename, { type: 'application/json' }); Object.defineProperty(selected, 'text', { value: () => Promise.resolve(text) })
  Object.defineProperty(input.element, 'files', { configurable: true, value: [selected] })
  await input.trigger('change'); await flushPromises()
}
describe('catalog transfer controls', () => {
  it('previews counts and conflicts, requires explicit consent and refreshes catalog only after success', async () => {
    const { wrapper, port } = setup(); await choose(wrapper)
    expect(wrapper.get('input').attributes('accept')).toBe('.cocl')
    expect(wrapper.text()).toContain('1 materials · 1 suppliers · 1 products'); expect(wrapper.text()).toContain('2 conflicts')
    expect(port.import).not.toHaveBeenCalled()
    const consent = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const confirm = wrapper.get('button.button-primary'); await confirm.trigger('click'); expect(port.import).not.toHaveBeenCalled()
    consent.mockReturnValue(true); await confirm.trigger('click'); await flushPromises()
    expect(port.import).toHaveBeenCalledExactlyOnceWith(file, true); expect(wrapper.emitted('imported')).toHaveLength(1)
    expect(wrapper.text()).toContain('imported successfully'); expect(wrapper.text()).not.toContain('Catalog import preview')
  })
  it('rejects the wrong extension and malformed files, then allows retry', async () => {
    const { wrapper, port } = setup(); await choose(wrapper, 'project.pocl')
    expect(port.preview).not.toHaveBeenCalled(); expect(wrapper.get('[role=alert]').text()).toContain('.cocl')
    port.preview.mockResolvedValueOnce({ ok: false, error: { kind: 'invalidRecord', issues: [{ path: ['schemaVersion'], message: 'Unsupported version' }] } })
    await choose(wrapper); expect(wrapper.get('[role=alert]').text()).toContain('Unsupported version'); expect(port.import).not.toHaveBeenCalled()
    await choose(wrapper); expect(wrapper.find('[role=alert]').exists()).toBe(false)
  })
  it('retains preview after storage failures and does not emit a successful import', async () => {
    const { wrapper, port } = setup(); await choose(wrapper)
    port.import.mockResolvedValueOnce({ ok: false, error: { kind: 'storageFailure', message: 'Disk full' } })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await wrapper.get('button.button-primary').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('Catalog import preview'); expect(wrapper.get('[role=alert]').text()).toContain('Could not access local storage')
    expect(wrapper.emitted('imported')).toBeUndefined()
  })
  it('downloads a .cocl UTF-8 JSON file and releases temporary resources', async () => {
    const { wrapper, port } = setup(); vi.useFakeTimers()
    const create = vi.fn<(blob: Blob) => string>(() => 'blob:catalog'); const revoke = vi.fn(); vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
    let filename = ''; vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filename = this.download })
    await wrapper.get('button').trigger('click'); await flushPromises()
    expect(port.export).toHaveBeenCalledOnce(); expect(filename).toBe('opticutlist-catalog.cocl')
    expect(create.mock.calls[0]?.[0].type).toBe('application/json;charset=utf-8'); expect(document.querySelector('a[download]')).toBeNull()
    vi.advanceTimersByTime(1000); expect(revoke).toHaveBeenCalledWith('blob:catalog')
  })
  it('shows export errors without downloading', async () => {
    const { wrapper, port } = setup(); port.export.mockResolvedValueOnce({ ok: false, error: { kind: 'storageFailure', message: 'Blocked' } })
    await wrapper.get('button').trigger('click'); await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('Could not access local storage')
  })
  it('ignores pending file reads on unmount and disables actions while processing', async () => {
    const { wrapper, port } = setup(); let resolve: ((value: string) => void) | undefined
    const pending = new Promise<string>(done => { resolve = done }); await choose(wrapper, 'catalog.cocl', pending)
    expect(wrapper.get('input').attributes('disabled')).toBeDefined(); expect(wrapper.get('button').attributes('disabled')).toBeDefined()
    wrapper.unmount(); resolve?.(JSON.stringify(file)); await flushPromises(); expect(port.preview).not.toHaveBeenCalled(); expect(port.import).not.toHaveBeenCalled()
  })
})
