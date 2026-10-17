import { stockTransferServiceKey } from '@/ui/composables/use-stock-transfer-service'
import type { StockTransferService } from '../../../application/inventory/stock-transfer-service'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SettingsDialog from '@/ui/components/settings/SettingsDialog.vue'
import { catalogTransferServiceKey } from '@/ui/composables/use-catalog-transfer-service'
import type { CatalogTransferService } from '../../../application/catalog/catalog-transfer-service'
import { catalogTransferSchema } from '../../../application/catalog/catalog-transfer-format'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach(wrapper => { wrapper.unmount() }); wrappers.length = 0
  vi.restoreAllMocks(); localStorage.removeItem('opticutlist.theme')
  document.documentElement.removeAttribute('data-theme')
})
const file = catalogTransferSchema.parse({ format: 'opticutlist-catalog', schemaVersion: 1, catalog: { materials: [], suppliers: [], products: [] } })
function setup() {
  const service = {
    preview: vi.fn<CatalogTransferService['preview']>().mockResolvedValue({ ok: true, value: { file, reused: 0, conflicts: 0 } }),
    import: vi.fn<CatalogTransferService['import']>().mockResolvedValue({ ok: true, value: file }),
    export: vi.fn<CatalogTransferService['export']>().mockResolvedValue({ ok: true, value: JSON.stringify(file) }),
  }
  const stockFile = { format: 'opticutlist-stock' as const, schemaVersion: 1 as const, materials: [], stockItems: [] }
  const stockService = {
    preview: vi.fn<StockTransferService['preview']>().mockResolvedValue({ ok: true, value: { file: stockFile, added: 0, reused: 0 } }),
    import: vi.fn<StockTransferService['import']>().mockResolvedValue({ ok: true, value: stockFile }),
    export: vi.fn<StockTransferService['export']>().mockResolvedValue({ ok: true, value: JSON.stringify(stockFile) }),
  }
  const wrapper = mount(SettingsDialog, { props: { open: true }, global: { provide: { [catalogTransferServiceKey]: service, [stockTransferServiceKey]: stockService } }, attachTo: document.body })
  wrappers.push(wrapper); return { wrapper, service, stockService }
}
async function choose(wrapper: VueWrapper, text: Promise<string> = Promise.resolve(JSON.stringify(file))) {
  await wrapper.get('button[aria-controls="catalog-import"]').trigger('click')
  const input = wrapper.get('input[type="file"]')
  const selected = new File([''], 'catalog.cocl')
  Object.defineProperty(selected, 'text', { value: () => text })
  Object.defineProperty(input.element, 'files', { value: [selected] })
  await input.trigger('change'); await flushPromises()
}
describe('Settings dialog', () => {
  it('groups real Catalog and Stock actions in aligned sections', () => {
    const { wrapper, service, stockService } = setup()
    expect(wrapper.findAll('h3').map(heading => heading.text())).toEqual(['Appearance', 'Catalog', 'Stock'])
    for (const section of ['settings-catalog', 'settings-stock']) {
      const actions = wrapper.get(`section[aria-labelledby="${section}"]`).findAll('button')
      expect(actions.map(button => button.text())).toEqual(['Export', 'Import'])
      expect(actions.every(button => button.attributes('disabled') === undefined)).toBe(true)
    }
    expect(wrapper.text()).not.toContain('not available yet')
    expect(service.import).not.toHaveBeenCalled()
    expect(stockService.import).not.toHaveBeenCalled()
  })
  it('previews and confirms Stock import without nesting modals, then notifies the shell', async () => {
    const { wrapper, stockService } = setup()
    await wrapper.get('button[aria-controls="stock-import"]').trigger('click')
    const input = wrapper.get('#stock-import-file')
    const selected = new File([''], 'stock.oclstock.json')
    Object.defineProperty(selected, 'text', { value: () => Promise.resolve('{}') })
    Object.defineProperty(input.element, 'files', { value: [selected] })
    await input.trigger('change'); await flushPromises()
    expect(wrapper.findAll('dialog')).toHaveLength(1)
    expect(wrapper.text()).toContain('0 new references')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await wrapper.get('button.button-primary').trigger('click'); await flushPromises()
    expect(stockService.import).toHaveBeenCalledOnce()
    expect(wrapper.emitted('stockImported')).toHaveLength(1)
  })
  it('switches themes without closing and still dismisses through the close button', async () => {
    const { wrapper } = setup()
    await wrapper.get('#theme-preference').setValue('dark')
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.get('dialog').attributes('open')).toBeDefined()
    await wrapper.get('button[aria-label="Close Settings"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
  it('keeps the theme mounted when hidden, applies preferences immediately and restores persistence', async () => {
    localStorage.setItem('opticutlist.theme', 'dark')
    const { wrapper } = setup()
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(wrapper.findAll('option').map(option => option.text())).toEqual(['Light', 'Dark', 'System'])
    await wrapper.get('#theme-preference').setValue('light')
    expect(localStorage.getItem('opticutlist.theme')).toBe('light')
    await wrapper.setProps({ open: false })
    expect(wrapper.get('dialog').attributes('open')).toBeUndefined()
    expect(wrapper.find('#theme-preference').exists()).toBe(true)
    expect(document.documentElement.dataset.theme).toBe('light')
  })
  it('guards close and Escape during pending file validation, using just one modal', async () => {
    const { wrapper, service } = setup()
    let finish: ((value: string) => void) | undefined
    await choose(wrapper, new Promise(resolve => { finish = resolve }))
    expect(wrapper.findAll('dialog')).toHaveLength(1)
    expect(wrapper.get('button[aria-label="Close Settings"]').attributes('disabled')).toBeDefined()
    await wrapper.get('dialog').trigger('cancel')
    expect(wrapper.emitted('close')).toBeUndefined()
    finish?.(JSON.stringify(file)); await flushPromises()
    expect(service.preview).toHaveBeenCalledOnce()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await wrapper.get('dialog').trigger('cancel')
    expect(wrapper.emitted('close')).toBeUndefined()
    confirm.mockReturnValue(true)
    await wrapper.get('dialog').trigger('cancel')
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(service.import).not.toHaveBeenCalled()
  })
  it('preserves invalid-file feedback and allows retry without dismissing Settings', async () => {
    const { wrapper, service } = setup()
    service.preview.mockResolvedValueOnce({ ok: false, error: { kind: 'invalidRecord', issues: [{ path: ['schemaVersion'], message: 'Unsupported version' }] } })
    await choose(wrapper)
    expect(wrapper.get('[role="alert"]').text()).toContain('Unsupported version')
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(service.import).not.toHaveBeenCalled()
  })
})
