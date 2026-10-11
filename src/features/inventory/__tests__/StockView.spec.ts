import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import StockView from '../StockView.vue'
import { catalogStockRepositoryKey } from '../../suppliers/catalog-repositories'
import { materialRepositoryKey } from '../../materials/material-repository'
import { materialSchema } from '../../../domain/model/material'
import { stockItemSchema } from '../../../domain/model/stock-item'
import type { Repository } from '../../../application/persistence/repositories'
import { validMaterialInput, validStockItemInput } from '../../../domain/model/__tests__/fixtures'
const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => { wrapper.unmount() }); wrappers.length = 0; vi.restoreAllMocks() })
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
    for (const text of [material.name, item.id, 'Offcut', '800 × 400.5 × 18', 'length', 'manual']) expect(wrapper.get('table').text()).toContain(text)
    expect(wrapper.get('table tbody').findAll('td')[2]?.text()).toBe('1')
    expect(wrapper.findAll('button').map(button => button.text())).toEqual(['Refresh stock'])
    await wrapper.get('button').trigger('click'); await flushPromises(); expect(inventory.list).toHaveBeenCalledTimes(2)
  })
  it('handles empty inventory and missing material labels without inventing quantities', async () => {
    const { wrapper, inventory, materials } = setup(); await flushPromises()
    materials.list.mockResolvedValue({ ok: true, value: [] }); await wrapper.get('button').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('Missing material')
    inventory.list.mockResolvedValue({ ok: true, value: [] }); await wrapper.get('button').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('No physical stock items yet'); expect(wrapper.find('table').exists()).toBe(false)
  })
  it('reports storage failures and permits retry without displaying stale stock', async () => {
    const { wrapper, inventory } = setup(); await flushPromises()
    inventory.list.mockResolvedValueOnce({ ok: false, error: { kind: 'storageFailure', message: 'Blocked' } })
    await wrapper.get('button').trigger('click'); await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('Could not access local storage'); expect(wrapper.find('table').exists()).toBe(false)
    await wrapper.get('button').trigger('click'); await flushPromises(); expect(wrapper.find('table').exists()).toBe(true)
  })
})
