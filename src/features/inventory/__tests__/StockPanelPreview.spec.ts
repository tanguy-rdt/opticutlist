import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import StockPanelPreview from '../StockPanelPreview.vue'
import { stockItemSchema } from '../../../domain/model/stock-item'
import { validStockItemInput } from '../../../domain/model/__tests__/fixtures'
import { materialPreview, materialThumbnail } from '../../materials/material-library'

const stock = stockItemSchema.parse(validStockItemInput)
describe('physical stock technical preview', () => {
  it.each([[800, 400], [100, 900], [10000, 1], [1, 10000]])('fits %s × %s mm without changing proportions', (lengthMm, widthMm) => {
    const item = { ...stock, lengthMm, widthMm }
    const before = structuredClone(item)
    const wrapper = mount(StockPanelPreview, { props: { item, presetId: 'chene' } })
    const rect = wrapper.get('[data-panel-outline]')
    const width = Number(rect.attributes('width')); const height = Number(rect.attributes('height'))
    expect(width / height).toBeCloseTo(lengthMm / widthMm)
    expect(width).toBeLessThanOrEqual(220); expect(height).toBeLessThanOrEqual(130)
    expect(Number(rect.attributes('x'))).toBeGreaterThanOrEqual(40)
    expect(Number(rect.attributes('y'))).toBeGreaterThanOrEqual(40)
    expect(wrapper.findAll('text').map(label => label.text())).toEqual([`${String(lengthMm)} mm`, `${String(widthMm)} mm`])
    expect(wrapper.get('image').attributes('href')).toBe(materialPreview('chene'))
    expect(wrapper.get('image').attributes('href')).not.toBe(materialThumbnail('chene'))
    expect(wrapper.get('image').attributes('preserveAspectRatio')).toBe('xMidYMid slice')
    expect(wrapper.get('image').attributes('clip-path')).toContain(wrapper.get('clipPath').attributes('id'))
    expect(item).toEqual(before)
    wrapper.unmount()
  })
  it.each([undefined, 'missing-preset'])('keeps a neutral proportional panel when texture is missing: %s', presetId => {
    const wrapper = mount(StockPanelPreview, { props: { item: stock, presetId } })
    expect(wrapper.find('image').exists()).toBe(false)
    expect(wrapper.find('[data-panel-outline]').exists()).toBe(true)
    expect(wrapper.text()).toContain('800 mm')
    wrapper.unmount()
  })
  it('falls back after a failed texture load and updates image/geometry on selection', async () => {
    const wrapper = mount(StockPanelPreview, { props: { item: stock, presetId: 'pin' } })
    const previousImage = wrapper.get('image')
    await previousImage.trigger('error')
    expect(wrapper.find('image').exists()).toBe(false)
    await wrapper.setProps({ item: { ...stock, lengthMm: 100, widthMm: 600 }, presetId: 'chene' })
    expect(wrapper.get('image').attributes('href')).toBe(materialPreview('chene'))
    await previousImage.trigger('error')
    expect(wrapper.find('image').exists()).toBe(true)
    expect(wrapper.get('svg').attributes('aria-label')).toContain('100 × 600')
    wrapper.unmount()
  })
  it('shows an unavailable state for unsupported geometry rather than distorting dimensions', () => {
    const wrapper = mount(StockPanelPreview, { props: { item: { ...stock, lengthMm: Number.MAX_VALUE }, presetId: 'pin' } })
    expect(wrapper.find('svg').exists()).toBe(false)
    expect(wrapper.text()).toContain('Preview unavailable')
    wrapper.unmount()
  })
})
