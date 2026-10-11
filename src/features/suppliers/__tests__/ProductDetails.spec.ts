import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { materialSchema } from '../../../domain/model/material'
import { supplierProductSchema } from '../../../domain/model/supplier-product'
import { validMaterialInput, validSupplierProductInput } from '../../../domain/model/__tests__/fixtures'
import { materialPresets, materialThumbnail } from '../../materials/material-library'
import ProductDetails from '../ProductDetails.vue'
const material = materialSchema.parse(validMaterialInput)
const product = supplierProductSchema.parse(validSupplierProductInput)
const props = { product, materials: [material], suppliers: [], stock: [], stockAvailable: true, stockError: '', disabled: false }

describe('product material preview', () => {
  it.each(materialPresets)('uses the associated $name preset without guessing from product names', preset => {
    const associated = materialSchema.parse({ ...material, name: preset.name, libraryPresetId: preset.id })
    const wrapper = mount(ProductDetails, { props: { ...props, materials: [associated] } })
    const preview = wrapper.get('figure[aria-label="Material preview"]')
    expect(preview.get('img').attributes('src')).toBe(materialThumbnail(preset.id))
    expect(preview.get('img').attributes('loading')).toBe('lazy')
    expect(preview.element.compareDocumentPosition(wrapper.get('[aria-label="Product specifications"]').element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    wrapper.unmount()
  })
  it('retains a renamed preset texture and immediately follows selected product material IDs', async () => {
    const pine = materialSchema.parse({ ...material, name: 'Pin Douglas', libraryPresetId: 'pin' })
    const oak = materialSchema.parse({ ...material, id: 'oak-material', name: 'Custom oak', libraryPresetId: 'chene' })
    const second = supplierProductSchema.parse({ ...product, id: 'second-product', materialId: oak.id, name: product.name })
    const wrapper = mount(ProductDetails, { props: { ...props, materials: [pine, oak] } })
    expect(wrapper.get('figure img').attributes('src')).toBe(materialThumbnail('pin'))
    expect(wrapper.get('figcaption').text()).toContain('Pin Douglas')
    const oldImage = wrapper.get('figure img')
    await wrapper.setProps({ product: second }); await oldImage.trigger('error')
    expect(wrapper.get('figure img').attributes('src')).toBe(materialThumbnail('chene'))
    expect(wrapper.get('figcaption').text()).toContain('Custom oak')
    wrapper.unmount()
  })
  it.each([undefined, 'unknown-preset'])('shows a neutral placeholder for a custom/unknown material (%s)', libraryPresetId => {
    const custom = materialSchema.parse({ ...material, name: 'Pin', libraryPresetId })
    const wrapper = mount(ProductDetails, { props: { ...props, materials: [custom], product: supplierProductSchema.parse({ ...product, name: 'Chêne' }) } })
    expect(wrapper.get('figure').text()).toContain('No texture available')
    expect(wrapper.find('figure img').exists()).toBe(false)
    wrapper.unmount()
  })
  it('handles unavailable textures and missing material references without broken images', async () => {
    const associated = materialSchema.parse({ ...material, libraryPresetId: 'pin' })
    const wrapper = mount(ProductDetails, { props: { ...props, materials: [associated] } })
    await wrapper.get('figure img').trigger('error')
    expect(wrapper.find('figure img').exists()).toBe(false)
    expect(wrapper.get('figure').text()).toContain('No texture available')
    await wrapper.setProps({ materials: [] })
    expect(wrapper.get('figcaption').text()).toContain('Missing material')
    await wrapper.setProps({ product: undefined })
    expect(wrapper.find('figure').exists()).toBe(false)
    wrapper.unmount()
  })
})
