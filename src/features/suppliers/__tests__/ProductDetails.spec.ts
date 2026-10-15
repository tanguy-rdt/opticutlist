import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { materialSchema } from '../../../domain/model/material'
import { supplierProductSchema } from '../../../domain/model/supplier-product'
import { validMaterialInput, validSupplierProductInput, validStockItemInput } from '../../../domain/model/__tests__/fixtures'
import { stockItemSchema } from '../../../domain/model/stock-item'
import { materialPresets } from '../../materials/material-library'
import ProductDetails from '../ProductDetails.vue'
const material = materialSchema.parse(validMaterialInput)
const product = supplierProductSchema.parse(validSupplierProductInput)
const props = { product, materials: [material], suppliers: [], stock: [], stockAvailable: true, stockError: '', disabled: false }

describe('product technical preview', () => {
  it.each(materialPresets)('uses the same neutral fill for $name without a material texture', preset => {
    const associated = materialSchema.parse({ ...material, name: preset.name, libraryPresetId: preset.id })
    const wrapper = mount(ProductDetails, { props: { ...props, materials: [associated] } })
    const preview = wrapper.get('figure[aria-label="Catalog panel preview"]')
    expect(preview.find('image').exists()).toBe(false)
    expect(preview.get('[data-panel-outline]').attributes('fill')).toBe('var(--quiet-surface)')
    expect(preview.get('svg').attributes('aria-label')).toContain(`${String(product.lengthMm)} × ${String(product.widthMm)} mm`)
    expect(preview.element.compareDocumentPosition(wrapper.get('[aria-label="Product specifications"]').element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    wrapper.unmount()
  })
  it('orders the preview, identity, key values, specifications, stock and accessible actions', async () => {
    const stock = stockItemSchema.parse({ ...validStockItemInput, quantity: 4 })
    const wrapper = mount(ProductDetails, { props: { ...props, stock: [stock], materials: [materialSchema.parse({ ...material, libraryPresetId: 'pin' })] } })
    const sections = ['figure', '.catalog-product-header', '.catalog-product-overview', '[aria-label="Product specifications"]', '[aria-label="Owned inventory"]', '[aria-label="Product actions"]']
    for (let index = 1; index < sections.length; index += 1) {
      const previous = sections[index - 1]; const current = sections[index]
      if (!previous || !current) throw new Error('Missing section')
      expect(wrapper.get(previous).element.compareDocumentPosition(wrapper.get(current).element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    expect(wrapper.get('.catalog-product-overview').text()).toContain(`${String(product.lengthMm)} × ${String(product.widthMm)} × ${String(product.thicknessMm)} mm`)
    expect(wrapper.get('.catalog-product-overview').text()).toContain(String(product.price))
    expect(wrapper.get('.catalog-product-overview').text()).toContain(product.currency)
    expect(wrapper.get('[aria-label="Product specifications"]').text()).toContain('Along length')
    expect(wrapper.get('[aria-label="Owned inventory"]').text()).toContain('4 owned units')
    expect(wrapper.get('[aria-label="Owned inventory"]').text()).toContain(`${String(stock.lengthMm)} × ${String(stock.widthMm)} × ${String(stock.thicknessMm)} mm`)
    await wrapper.get('button[aria-label^="Edit product"]').trigger('click')
    await wrapper.get('button[aria-label^="Delete product"]').trigger('click')
    expect(wrapper.emitted('edit')).toEqual([[product]]); expect(wrapper.emitted('delete')).toEqual([[product]])
    await wrapper.setProps({ stock: [], product: supplierProductSchema.parse({ ...product, availability: 'available' }) })
    expect(wrapper.get('[aria-label="Owned inventory"]').text()).toContain('0 owned units')
    wrapper.unmount()
  })
  it('retains material identity and a uniform fill when changing selected products', async () => {
    const pine = materialSchema.parse({ ...material, name: 'Pin Douglas', libraryPresetId: 'pin' })
    const oak = materialSchema.parse({ ...material, id: 'oak-material', name: 'Custom oak', libraryPresetId: 'chene' })
    const second = supplierProductSchema.parse({ ...product, id: 'second-product', materialId: oak.id, name: product.name })
    const wrapper = mount(ProductDetails, { props: { ...props, materials: [pine, oak] } })
    expect(wrapper.find('figure image').exists()).toBe(false)
    const fill = wrapper.get('[data-panel-outline]').attributes('fill')
    expect(wrapper.get('.catalog-product-header').text()).toContain('Pin Douglas')
    await wrapper.setProps({ product: second })
    expect(wrapper.find('figure image').exists()).toBe(false)
    expect(wrapper.get('[data-panel-outline]').attributes('fill')).toBe(fill)
    expect(wrapper.get('.catalog-product-header').text()).toContain('Custom oak')
    wrapper.unmount()
  })
  it.each([undefined, 'unknown-preset'])('shows a neutral drawing for a custom/unknown material (%s)', libraryPresetId => {
    const custom = materialSchema.parse({ ...material, name: 'Pin', libraryPresetId })
    const wrapper = mount(ProductDetails, { props: { ...props, materials: [custom], product: supplierProductSchema.parse({ ...product, name: 'Chêne' }) } })
    expect(wrapper.find('figure [data-panel-outline]').exists()).toBe(true)
    expect(wrapper.find('figure image').exists()).toBe(false)
    wrapper.unmount()
  })
  it('handles missing material references and empty product selection', async () => {
    const associated = materialSchema.parse({ ...material, libraryPresetId: 'pin' })
    const wrapper = mount(ProductDetails, { props: { ...props, materials: [associated] } })
    expect(wrapper.find('figure image').exists()).toBe(false)
    expect(wrapper.find('figure [data-panel-outline]').exists()).toBe(true)
    await wrapper.setProps({ materials: [] })
    expect(wrapper.get('.catalog-product-header').text()).toContain('Missing material')
    await wrapper.setProps({ product: undefined })
    expect(wrapper.find('figure').exists()).toBe(false)
    wrapper.unmount()
  })
})
