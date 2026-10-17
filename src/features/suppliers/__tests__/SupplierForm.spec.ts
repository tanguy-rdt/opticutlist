import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SupplierForm from '@/ui/components/suppliers/SupplierForm.vue'
import { supplierSchema } from '../../../domain/model/supplier'

const supplier = supplierSchema.parse({ id: 'existing-supplier', name: 'Local supplier', websiteUrl: 'https://old.example/' })
describe('supplier website form handling', () => {
  it.each([null, supplier])('normalizes domains on save for add/edit (%j), preserving the typing draft', async existing => {
    const wrapper = mount(SupplierForm, { props: { supplier: existing, disabled: false } })
    await wrapper.get('#supplier-name').setValue('Local supplier')
    await wrapper.get('#supplier-website').setValue('  www.leroymerlin.fr  ')
    expect(wrapper.get<HTMLInputElement>('#supplier-website').element.value).toBe('  www.leroymerlin.fr  ')
    await wrapper.get('form').trigger('submit')
    const saved = supplierSchema.parse(wrapper.emitted('save')?.[0]?.[0])
    expect(saved.websiteUrl).toBe('https://www.leroymerlin.fr/')
    expect(saved.name).toBe('Local supplier')
    if (existing) expect(saved.id).toBe(existing.id)
    expect(wrapper.get<HTMLInputElement>('#supplier-website').element.value).toBe('  www.leroymerlin.fr  ')
    wrapper.unmount()
  })
  it.each([null, supplier])('omits empty websites for add/edit (%j)', async existing => {
    const wrapper = mount(SupplierForm, { props: { supplier: existing, disabled: false } })
    await wrapper.get('#supplier-name').setValue('Local supplier')
    await wrapper.get('#supplier-website').setValue('  ')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('save')?.[0]?.[0]).not.toHaveProperty('websiteUrl')
    wrapper.unmount()
  })
  it('links invalid website errors to the input and preserves its draft', async () => {
    const wrapper = mount(SupplierForm, { props: { supplier, disabled: false }, attachTo: document.body })
    await wrapper.get('#supplier-website').setValue('hello')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('save')).toBeUndefined()
    expect(wrapper.get('#supplier-website').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('#supplier-website-error').text()).toContain('valid domain name')
    expect(document.activeElement).toBe(wrapper.get('#supplier-website').element)
    wrapper.unmount()
  })
})
