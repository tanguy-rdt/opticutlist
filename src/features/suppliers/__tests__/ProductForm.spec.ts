import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ProductForm from '../ProductForm.vue'
import { materialRepositoryKey } from '../../materials/material-repository'
import { materialSchema } from '../../../domain/model/material'
import { supplierSchema } from '../../../domain/model/supplier'
import { supplierProductSchema } from '../../../domain/model/supplier-product'
import { validMaterialInput, validSupplierInput, validSupplierProductInput } from '../../../domain/model/__tests__/fixtures'

const material = materialSchema.parse(validMaterialInput)
const supplier = supplierSchema.parse(validSupplierInput)
const otherSupplier = supplierSchema.parse({ ...supplier, id: 'another-supplier', name: supplier.name })
const product = supplierProductSchema.parse(validSupplierProductInput)
function render(initialSupplierId: string, editing = false, suppliers = [supplier, otherSupplier], fixedSupplier = true) {
  return mount(ProductForm, {
    props: { product: editing ? product : null, initialSupplierId, suppliers, materials: [material], disabled: false, fixedSupplier },
    global: { provide: { [materialRepositoryKey]: { create: vi.fn() } } },
  })
}
describe('product supplier context', () => {
  it('saves the explicitly selected supplier ID even when names are identical', async () => {
    const wrapper = render(otherSupplier.id)
    try {
      expect(wrapper.find('#product-supplier').exists()).toBe(false)
      expect(wrapper.text()).toContain(`Supplier: ${otherSupplier.name}`)
      await wrapper.get('#product-name').setValue('Panel')
      await wrapper.get('#product-material').trigger('click')
      await wrapper.get(`[data-value="${material.id}"]`).trigger('click')
      for (const key of ['lengthMm', 'widthMm', 'thicknessMm', 'price'] as const) await wrapper.get(`#product-${key}`).setValue(String(product[key]))
      await wrapper.get('form').trigger('submit')
      const saved = supplierProductSchema.parse(wrapper.emitted('save')?.[0]?.[0])
      expect(saved.supplierId).toBe(otherSupplier.id)
      expect(saved.availability).toBe('unknown')
      expect(wrapper.find('#product-availability').exists()).toBe(false)
    } finally { wrapper.unmount() }
  })
  it('retains the original product supplier when editing from a different supplier context', async () => {
    const wrapper = render(otherSupplier.id, true)
    try {
      expect(wrapper.find('#product-supplier').exists()).toBe(false)
      await wrapper.get('#product-name').setValue('Renamed panel')
      await wrapper.get('form').trigger('submit')
      expect(supplierProductSchema.parse(wrapper.emitted('save')?.[0]?.[0])).toEqual({ ...product, name: 'Renamed panel' })
    } finally { wrapper.unmount() }
  })
  it.each(['available', 'unavailable', 'unknown'] as const)('preserves legacy %s without offering an availability control', async availability => {
    const wrapper = render(supplier.id, true)
    await wrapper.setProps({ product: { ...product, availability } })
    expect(wrapper.find('#product-availability').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Availability')
    await wrapper.get('form').trigger('submit')
    expect(supplierProductSchema.parse(wrapper.emitted('save')?.[0]?.[0]).availability).toBe(availability)
    wrapper.unmount()
  })
  it.each(['', 'missing-supplier', 'invalid id'])('rejects missing or invalid fixed context %j without defaulting', async initialSupplierId => {
    const wrapper = render(initialSupplierId)
    try {
      await wrapper.get('form').trigger('submit')
      expect(wrapper.get('#product-supplier-error').attributes('role')).toBe('alert')
      expect(wrapper.get('#product-supplier-error').text()).toBe('Choose an existing supplier.')
      expect(wrapper.emitted('save')).toBeUndefined()
      expect(wrapper.find('#product-supplier').exists()).toBe(false)
    } finally { wrapper.unmount() }
  })
  it('reports a missing supplier even if no suppliers are available', async () => {
    const wrapper = render(supplier.id, true, [])
    try {
      await wrapper.get('form').trigger('submit')
      expect(wrapper.get('#product-supplier-error').text()).toBe('Choose an existing supplier.')
      expect(wrapper.emitted('save')).toBeUndefined()
    } finally { wrapper.unmount() }
  })
  it('keeps supplier reassignment available in an explicitly editable form context', async () => {
    const wrapper = render(supplier.id, true, [supplier, otherSupplier], false)
    try {
      await wrapper.get('#product-supplier').setValue(otherSupplier.id)
      await wrapper.get('form').trigger('submit')
      expect(supplierProductSchema.parse(wrapper.emitted('save')?.[0]?.[0]).supplierId).toBe(otherSupplier.id)
    } finally { wrapper.unmount() }
  })
})
