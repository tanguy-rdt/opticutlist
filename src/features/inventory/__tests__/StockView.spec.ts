import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { createLocalPersistence } from '../../../infrastructure/persistence/local-database'
import { createStockRepository } from '../../../application/inventory/stock-repository'
import { stockRepositoryKey } from '../stock-repository'
import StockView from '../StockView.vue'
import { catalogStockRepositoryKey } from '../../suppliers/catalog-repositories'
import { materialRepositoryKey } from '../../materials/material-repository'
import { materialSchema } from '../../../domain/model/material'
import { stockItemSchema } from '../../../domain/model/stock-item'
import { cuttingConfirmationSchema } from '../../../domain/model/cutting-confirmation'
import type { PersistenceResult, Repository } from '../../../application/persistence/repositories'
import { validMaterialInput, validStockItemInput } from '../../../domain/model/__tests__/fixtures'
const connections: { close(): void }[] = []
const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => { wrapper.unmount() }); wrappers.length = 0; connections.forEach(connection => { connection.close() }); connections.length = 0; vi.restoreAllMocks() })
const item = stockItemSchema.parse(validStockItemInput)
const material = materialSchema.parse(validMaterialInput)
function setup() {
  const inventory = { list: vi.fn<Repository<typeof item>['list']>().mockResolvedValue({ ok: true, value: [item] }) }
  const materials = { list: vi.fn<Repository<typeof material>['list']>().mockResolvedValue({ ok: true, value: [material] }) }
  const wrapper = mount(StockView, { global: { provide: { [catalogStockRepositoryKey]: inventory, [materialRepositoryKey]: materials } } }); wrappers.push(wrapper)
  return { wrapper, inventory, materials }
}
describe('existing stock record presentation', () => {
  it('reads owned panels/offcuts with real quantities, dimensions, grain and provenance without offering writes', async () => {
    const { wrapper, inventory } = setup()
    expect(wrapper.text()).toContain('Loading owned stock'); await flushPromises()
    for (const text of [material.name, item.id, 'Offcut', '800 × 400.5', 'manual']) expect(wrapper.get('table').text()).toContain(text)
    expect(wrapper.get('[aria-label="Stock item details"]').text()).toContain('Along length')
    expect(wrapper.get('table tbody').findAll('td')[2]?.text()).toBe('1')
    expect(wrapper.findAll('button').filter(button => ['Add to stock', 'Edit stock item', 'Delete stock item'].includes(button.text())).every(button => button.attributes('disabled') !== undefined)).toBe(true)
    window.dispatchEvent(new Event('focus')); await flushPromises(); expect(inventory.list).toHaveBeenCalledTimes(2)
  })
  it('refreshes changed stock on focus, coalesces pending reads and removes its listener on exit', async () => {
    const { wrapper, inventory } = setup(); await flushPromises()
    expect(wrapper.text()).not.toContain('Refresh stock')
    inventory.list.mockResolvedValue({ ok: true, value: [{ ...item, quantity: 7 }] })
    window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(wrapper.get('[aria-label="Stock summary"]').findAll('dd').map(value => value.text())).toEqual(['0', '7', '1', '1'])
    expect(inventory.list).toHaveBeenCalledTimes(2)
    wrapper.unmount()
    window.dispatchEvent(new Event('focus')); await flushPromises()
    expect(inventory.list).toHaveBeenCalledTimes(2)
  })
  it('handles empty inventory and missing material labels without inventing quantities', async () => {
    const { wrapper, inventory, materials } = setup(); await flushPromises()
    materials.list.mockResolvedValue({ ok: true, value: [] }); window.dispatchEvent(new Event('focus')); await flushPromises()
    expect(wrapper.text()).toContain('Missing material')
    inventory.list.mockResolvedValue({ ok: true, value: [] }); window.dispatchEvent(new Event('focus')); await flushPromises()
    expect(wrapper.text()).toContain('No physical stock items yet'); expect(wrapper.find('table').exists()).toBe(false)
  })
  it('reports storage failures and permits retry without displaying stale stock', async () => {
    const { wrapper, inventory } = setup(); await flushPromises()
    inventory.list.mockResolvedValueOnce({ ok: false, error: { kind: 'storageFailure', message: 'Blocked' } })
    window.dispatchEvent(new Event('focus')); await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('Could not access local storage'); expect(wrapper.find('table').exists()).toBe(false)
    window.dispatchEvent(new Event('focus')); await flushPromises(); expect(wrapper.find('table').exists()).toBe(true)
  })
})

function button(wrapper: VueWrapper, label: string) {
  const found = wrapper.findAll('button').find(button => button.text() === label || button.attributes('aria-label') === label)
  if (!found) throw new Error(`Missing button ${label}`)
  return found
}
async function editable(items: readonly typeof item[] = [], names: readonly typeof material[] = [material]) {
  const indexedDB = new IDBFactory()
  const persistence = createLocalPersistence('stock-ui', { indexedDB, IDBKeyRange }); connections.push(persistence)
  for (const name of names) await persistence.materials.create(name)
  for (const record of items) await persistence.stockItems.create(record)
  const repository = createStockRepository(persistence)
  function mountView() {
    const wrapper = mount(StockView, { attachTo: document.body, global: { provide: { [stockRepositoryKey]: repository, [materialRepositoryKey]: persistence.materials } } }); wrappers.push(wrapper)
    return wrapper
  }
  const wrapper = mountView(); await vi.waitFor(() => { expect(wrapper.text()).not.toContain('Loading owned stock') })
  return { wrapper, persistence, repository, mountView }
}
async function fillStock(wrapper: VueWrapper, value: string = material.id) {
  await button(wrapper, 'Add to stock').trigger('click')
  await wrapper.get('#stock-material').trigger('click')
  const choice = wrapper.findAll('[role="option"]').find(option => option.attributes('data-value') === value)
  if (!choice) throw new Error(`Missing material ${value}`)
  await choice.trigger('click')
  await wrapper.get('#stock-lengthMm').setValue('800')
  await wrapper.get('#stock-widthMm').setValue('400.5')
  await wrapper.get('#stock-thicknessMm').setValue('18')
  await wrapper.get('#stock-quantity').setValue('3')
  await wrapper.get('#stock-grain').setValue('length')
}
async function submitStock(wrapper: VueWrapper) {
  await wrapper.get('form').trigger('submit')
  await vi.waitFor(() => {
    const submit = wrapper.find('form button[type="submit"]')
    expect(submit.exists() ? submit.attributes('disabled') : button(wrapper, 'Add to stock').attributes('disabled')).toBeUndefined()
  })
  await flushPromises()
}
describe('editable physical inventory workspace', () => {
  it('offers first-stock creation in a clean empty state without an empty table', async () => {
    const { wrapper } = await editable()
    expect(wrapper.get('[aria-label="Empty inventory"]').text()).toContain('No physical inventory is recorded')
    expect(wrapper.find('table').exists()).toBe(false)
    expect(wrapper.get('[aria-label="Stock summary"]').findAll('dd').map(value => value.text())).toEqual(['0', '0', '0', '0'])
    await button(wrapper, 'Add first stock item').trigger('click')
    expect(wrapper.get('dialog').attributes('open')).toBeDefined()
    expect(document.activeElement).toBe(wrapper.get('#stock-material').element)
    await button(wrapper, 'Close form').trigger('click')
    expect(wrapper.find('dialog').exists()).toBe(false)
  })
  it.each(['fullPanel', 'offcut'])('creates manual %s stock, adjusts quantity and retains persistence after remount', async kind => {
    const { wrapper, persistence, mountView } = await editable()
    await fillStock(wrapper)
    await wrapper.get('#stock-kind').setValue(kind)
    await submitStock(wrapper)
    const records = await persistence.stockItems.list()
    expect(records).toMatchObject({ ok: true, value: [{ kind, quantity: 3, lengthMm: 800, widthMm: 400.5, thicknessMm: 18, grainDirection: 'length', materialId: material.id, provenance: { source: 'manual' } }] })
    expect(wrapper.text()).toContain('Stock item added.')
    await button(wrapper, 'Edit stock item').trigger('click')
    expect(wrapper.get<HTMLInputElement>('#stock-thicknessMm').element.value).toBe('18')
    await wrapper.get('#stock-quantity').setValue('5')
    await submitStock(wrapper)
    wrapper.unmount()
    const reopened = mountView(); await vi.waitFor(() => { expect(reopened.text()).not.toContain('Loading owned stock') })
    expect(reopened.get('[aria-label="Stock summary"]').findAll('dd').map(value => value.text())).toEqual(kind === 'fullPanel' ? ['5', '0', '1', '1'] : ['0', '5', '1', '1'])
    expect(reopened.get('[aria-label="Stock item details"]').text()).toContain('5 physically owned')
    const updated = await persistence.stockItems.list()
    expect(updated.ok && updated.value[0]?.id).toBe(records.ok ? records.value[0]?.id : undefined)
  })
  it('selects presets in an empty catalog and saves without any supplier or product requirement', async () => {
    const { wrapper, persistence } = await editable([], [])
    await fillStock(wrapper, 'preset:pin')
    expect(wrapper.find('#inline-material-fields').exists()).toBe(false)
    await submitStock(wrapper)
    expect(await persistence.materials.list()).toMatchObject({ ok: true, value: [{ name: 'Pin', libraryPresetId: 'pin' }] })
    expect(await persistence.supplierProducts.list()).toEqual({ ok: true, value: [] })
    expect(wrapper.find('[aria-label="Stock item details"] image').exists()).toBe(false)
    expect(wrapper.get('[aria-label="Stock item details"] [data-panel-outline]').attributes('fill')).toBe('var(--quiet-surface)')
  })
  it('uses perspective samples only in material navigation, not inventory group headers', async () => {
    const textured = materialSchema.parse({ ...material, libraryPresetId: 'chene' })
    const { wrapper } = await editable([item], [textured])
    const sample = wrapper.get('[aria-label="Stock materials"] img')
    expect(sample.attributes('src')).toContain('/previews/chene.webp')
    expect(sample.classes()).toContain('object-contain')
    const table = wrapper.get('table').element
    expect(table.closest('section')?.querySelector('header img')).toBeNull()
    expect(wrapper.find('[aria-label="Stock item details"] image').exists()).toBe(false)
    expect(wrapper.get('[aria-label="Stock item details"] [data-panel-outline]').attributes('fill')).toBe('var(--quiet-surface)')
  })
  it('requires confirmation before deletion and preserves the item on refusal', async () => {
    const { wrapper, persistence } = await editable([item])
    const consent = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await button(wrapper, 'Delete stock item').trigger('click'); await flushPromises()
    expect(await persistence.stockItems.get(item.id)).toEqual({ ok: true, value: item })
    consent.mockReturnValue(true)
    await button(wrapper, 'Delete stock item').trigger('click'); await vi.waitFor(() => { expect(wrapper.text()).toContain('Stock item deleted.') })
    expect(await persistence.stockItems.list()).toEqual({ ok: true, value: [] })
    expect(wrapper.text()).toContain('Stock item deleted.')
    expect(wrapper.find('table').exists()).toBe(false)
  })
  it('calculates persisted quantities and groups/filters by material, type, grain and search', async () => {
    const oak = materialSchema.parse({ ...material, id: 'oak', name: 'Oak', libraryPresetId: 'chene' })
    const panel = stockItemSchema.parse({ ...item, id: 'oak-panels', materialId: oak.id, kind: 'fullPanel', quantity: 4, grainDirection: 'none' })
    const { wrapper } = await editable([{ ...item, quantity: 2 }, panel], [material, oak])
    expect(wrapper.get('[aria-label="Stock summary"]').findAll('dd').map(value => value.text())).toEqual(['4', '2', '2', '2'])
    expect(wrapper.findAll('table')).toHaveLength(2)
    const materialButton = wrapper.get('[aria-label="Stock materials"]').findAll('button').find(button => button.text().includes('Oak'))
    if (!materialButton) throw new Error('Missing Oak navigation')
    await materialButton.trigger('click'); await flushPromises()
    expect(wrapper.findAll('table')).toHaveLength(1)
    expect(wrapper.get('table').text()).toContain('oak-panels')
    expect(wrapper.find('[aria-label="Stock item details"] image').exists()).toBe(false)
    expect(wrapper.get('[aria-label="Stock item details"] [data-panel-outline]').attributes('fill')).toBe('var(--quiet-surface)')
    await wrapper.get('#stock-type-filter').setValue('offcut')
    expect(wrapper.text()).toContain('No stock matches these filters.')
    await button(wrapper, 'All materials6').trigger('click')
    expect(wrapper.get('table').text()).toContain(item.id)
    await wrapper.get('#stock-grain-filter').setValue('none')
    expect(wrapper.find('table').exists()).toBe(false)
    await wrapper.get('#stock-grain-filter').setValue('')
    await wrapper.get('#stock-search').setValue('800')
    expect(wrapper.get('table').text()).toContain(item.id)
  })
  it.each([['lengthMm', '0'], ['widthMm', '-2'], ['thicknessMm', ''], ['quantity', '0'], ['quantity', '1.5']])('rejects invalid %s without losing drafts or writing stock', async (field, value) => {
    const { wrapper, persistence } = await editable()
    await fillStock(wrapper)
    await wrapper.get(`#stock-${field}`).setValue(value)
    await submitStock(wrapper)
    expect(wrapper.get(`#stock-${field}`).attributes('aria-invalid')).toBe('true')
    expect(wrapper.get(`#stock-${field}-error`).attributes('role')).toBe('alert')
    expect(await persistence.stockItems.list()).toEqual({ ok: true, value: [] })
    expect(wrapper.get<HTMLInputElement>('#stock-quantity').element.value).toBe(field === 'quantity' ? value : '3')
  })
  it('shows missing material validation and keeps the editor intact on storage failure', async () => {
    const { wrapper, repository, persistence } = await editable()
    await fillStock(wrapper)
    vi.spyOn(repository, 'create').mockResolvedValueOnce({ ok: false, error: { kind: 'storageFailure', message: 'Disk full' } })
    await submitStock(wrapper)
    expect(wrapper.get('dialog [role="alert"]').text()).toContain('Could not access local storage')
    expect(wrapper.get<HTMLInputElement>('#stock-lengthMm').element.value).toBe('800')
    expect(await persistence.stockItems.list()).toEqual({ ok: true, value: [] })
    await submitStock(wrapper)
    expect(wrapper.text()).toContain('Stock item added.')
  })
  it('requires a material selection and refuses empty dimensions without writing records', async () => {
    const { wrapper, persistence } = await editable([], [])
    await button(wrapper, 'Add to stock').trigger('click')
    await submitStock(wrapper)
    expect(wrapper.get('#stock-material-error').text()).toContain('Choose a material or built-in preset')
    expect(document.activeElement).toBe(wrapper.get('#stock-material').element)
    expect(await persistence.materials.list()).toEqual({ ok: true, value: [] })
    expect(await persistence.stockItems.list()).toEqual({ ok: true, value: [] })
  })
  it('shows actual historical deductions with timestamps without inventing modification dates', async () => {
    const { wrapper, persistence } = await editable([item])
    const receipt = cuttingConfirmationSchema.parse({ id: 'past-cut', projectId: 'project', confirmedAt: '2026-10-11T12:00:00.000Z', consumed: [{ stock: { ...item, quantity: 3 }, quantity: 2, panelIndices: [0, 1] }], offcuts: [] })
    await persistence.cuttingConfirmations.create(receipt)
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => { expect(wrapper.get('[aria-label="Cutting movement history"]').text()).toContain('Consumed 2') })
    expect(wrapper.get('time').attributes('datetime')).toBe(receipt.confirmedAt)
    expect(wrapper.get('[aria-label="Cutting movement history"]').text()).toContain('800 × 400.5 × 18 mm')
    expect(wrapper.get('[aria-label="Stock item details"]').text()).toContain('1 physically owned')
    expect(await persistence.cuttingConfirmations.list()).toEqual({ ok: true, value: [receipt] })
  })
  it('supports the small-screen details dialog and keeps editing fields accessible', async () => {
    const { wrapper } = await editable([item])
    await button(wrapper, 'View stock details').trigger('click')
    expect(wrapper.get('dialog').attributes('aria-labelledby')).toBe(wrapper.get('dialog h2').attributes('id'))
    await button(wrapper, 'Close details').trigger('click')
    expect(wrapper.find('dialog').exists()).toBe(false)
    await button(wrapper, 'Edit stock item').trigger('click')
    expect(wrapper.find('form[aria-label="Stock editor"]').exists()).toBe(true)
    await button(wrapper, 'Close form').trigger('click')
    expect(wrapper.find('dialog').exists()).toBe(false)
  })
  it('blocks repeated submissions and form closing while a stock write is pending', async () => {
    const { wrapper, repository } = await editable()
    await fillStock(wrapper)
    let release: ((result: PersistenceResult<typeof item>) => void) | undefined
    const create = vi.spyOn(repository, 'create').mockImplementation(() => new Promise(resolve => { release = resolve }))
    await wrapper.get('form').trigger('submit')
    expect(button(wrapper, 'Close form').attributes('disabled')).toBeDefined()
    await wrapper.get('dialog').trigger('cancel')
    expect(wrapper.find('dialog').exists()).toBe(true)
    await wrapper.get('form').trigger('submit')
    expect(create).toHaveBeenCalledOnce()
    if (!release) throw new Error('Expected pending write')
    release({ ok: false, error: { kind: 'storageFailure', message: 'Blocked' } })
    await flushPromises()
    expect(button(wrapper, 'Close form').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('dialog [role="alert"]').text()).toContain('Could not access local storage')
  })
  it('rejects a stale quantity draft rather than overwriting a cutting deduction', async () => {
    const { wrapper, persistence } = await editable([item])
    await button(wrapper, 'Edit stock item').trigger('click')
    await wrapper.get('#stock-quantity').setValue('5')
    await persistence.stockItems.update(item.id, { ...item, quantity: 2 })
    await submitStock(wrapper)
    expect(wrapper.get('dialog [role="alert"]').text()).toContain('Stock changed since this form opened')
    expect(await persistence.stockItems.get(item.id)).toEqual({ ok: true, value: { ...item, quantity: 2 } })
  })
})
