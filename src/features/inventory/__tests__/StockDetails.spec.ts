import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import StockDetails from '../StockDetails.vue'
import { stockItemSchema } from '../../../domain/model/stock-item'
import { materialSchema } from '../../../domain/model/material'
import { cuttingConfirmationSchema } from '../../../domain/model/cutting-confirmation'
import { validMaterialInput, validStockItemInput } from '../../../domain/model/__tests__/fixtures'

const stock = stockItemSchema.parse(validStockItemInput)
const material = materialSchema.parse({ ...validMaterialInput, name: 'Pine Douglas', libraryPresetId: 'pin' })
const defaults = { item: stock, material, history: [], historyLoading: false, historyError: '', writable: true, busy: false }
describe('stock details hierarchy', () => {
  it('keeps material/type above the technical preview and preserves edit/delete actions', async () => {
    const wrapper = mount(StockDetails, { props: defaults })
    expect(wrapper.get('section').element.firstElementChild?.tagName).toBe('HEADER')
    expect(wrapper.get('h3').text()).toBe('Pine Douglas')
    expect(wrapper.find('image').exists()).toBe(false)
    expect(wrapper.get('[data-panel-outline]').attributes('fill')).toBe('var(--quiet-surface)')
    expect(wrapper.get('svg').attributes('aria-label')).toContain('800 × 400.5 mm')
    expect(wrapper.findAll('[data-dimension-arrow]')).toHaveLength(4)
    expect(wrapper.text()).toContain('800 × 400.5 × 18 mm')
    expect(wrapper.text()).toContain('1 physically owned')
    expect(wrapper.text()).not.toContain(stock.id)
    await wrapper.findAll('button')[0]?.trigger('click')
    await wrapper.findAll('button')[1]?.trigger('click')
    expect(wrapper.emitted('edit')).toHaveLength(1); expect(wrapper.emitted('delete')).toHaveLength(1)
    await wrapper.setProps({ busy: true })
    expect(wrapper.findAll('button').every(button => button.attributes('disabled') !== undefined)).toBe(true)
    wrapper.unmount()
  })
  it('displays meaningful cutting provenance/history without exposing internal identifiers', () => {
    const item = stockItemSchema.parse({ ...stock, provenance: { source: 'cutting', projectId: 'internal-project-id', savedPlanId: 'internal-plan-id', sourceStockItemId: 'internal-source-id', panelIndex: 2, wasteIndex: 1 } })
    const receipt = cuttingConfirmationSchema.parse({ id: 'internal-plan-id', projectId: 'internal-project-id', confirmedAt: '2026-10-14T12:00:00.000Z', consumed: [], offcuts: [item] })
    const wrapper = mount(StockDetails, { props: { ...defaults, item, history: [receipt] } })
    expect(wrapper.text()).toContain('Panel 3, offcut 2')
    expect(wrapper.text()).toContain('From owned stock')
    expect(wrapper.text()).toContain('Retained after cutting')
    expect(wrapper.find('time').exists()).toBe(true)
    for (const id of [item.id, 'internal-project-id', 'internal-plan-id', 'internal-source-id']) expect(wrapper.text()).not.toContain(id)
    wrapper.unmount()
  })
  it('updates material and dimensions on selection with a uniform fill', async () => {
    const wrapper = mount(StockDetails, { props: defaults })
    await wrapper.setProps({ material: materialSchema.parse({ ...material, libraryPresetId: 'chene', name: 'Renamed oak' }), item: { ...stock, lengthMm: 100 } })
    expect(wrapper.find('image').exists()).toBe(false)
    expect(wrapper.get('svg').attributes('aria-label')).toContain('100 × 400.5 mm')
    expect(wrapper.get('h3').text()).toBe('Renamed oak')
    await wrapper.setProps({ material: materialSchema.parse(validMaterialInput) })
    expect(wrapper.find('image').exists()).toBe(false)
    expect(wrapper.find('[data-panel-outline]').exists()).toBe(true)
    expect(wrapper.text()).toContain('100 × 400.5 × 18 mm')
    wrapper.unmount()
  })
})
