import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SupplierLogo from '@/ui/components/suppliers/SupplierLogo.vue'
import { supplierFaviconUrl } from '@/ui/utils/supplier-favicon'

describe('supplier favicon', () => {
  it.each([
    ['https://supplier.example/catalog?search=panel#details', 'https://supplier.example/favicon.ico'],
    ['http://supplier.example:8080/subdirectory', 'http://supplier.example:8080/favicon.ico'],
    ['https://SUPPLIER.example:443', 'https://supplier.example/favicon.ico'],
  ])('resolves only the origin of %s', (website, expected) => {
    expect(supplierFaviconUrl(website)).toBe(expected)
  })
  it.each([undefined, '', 'invalid', '/relative', '//supplier.example', 'javascript:alert(1)', 'data:image/png;base64,abc', 'ftp://supplier.example', 'https://user:secret@supplier.example'])('does not request an icon for %s', websiteUrl => {
    expect(supplierFaviconUrl(websiteUrl)).toBeUndefined()
    const wrapper = mount(SupplierLogo, { props: { websiteUrl } })
    expect(wrapper.find('img').exists()).toBe(false); expect(wrapper.find('svg').exists()).toBe(true)
    wrapper.unmount()
  })
  it('keeps the generic icon until a direct no-referrer image loads, and falls back on error', async () => {
    const wrapper = mount(SupplierLogo, { props: { websiteUrl: 'https://supplier.example/catalog' } })
    const image = wrapper.get('img')
    expect(image.attributes()).toMatchObject({ src: 'https://supplier.example/favicon.ico', referrerpolicy: 'no-referrer', loading: 'lazy', alt: '' })
    expect(image.classes()).toContain('invisible'); expect(wrapper.find('svg').exists()).toBe(true)
    await image.trigger('load')
    expect(image.classes()).toContain('visible'); expect(wrapper.find('svg').exists()).toBe(false)
    await image.trigger('error')
    expect(wrapper.find('img').exists()).toBe(false); expect(wrapper.find('svg').exists()).toBe(true)
    wrapper.unmount()
  })
  it.each(['small', 'large'] as const)('renders an aspect-preserving %s logo without a loaded frame', async size => {
    const wrapper = mount(SupplierLogo, { props: { websiteUrl: 'https://supplier.example', size } })
    expect(wrapper.classes()).toContain('bg-subtle')
    expect(wrapper.classes()).not.toContain('border')
    await wrapper.get('img').trigger('load')
    expect(wrapper.classes()).not.toContain('bg-subtle')
    expect(wrapper.get('img').classes()).toContain('object-contain')
    expect(wrapper.get('img').classes()).not.toContain('object-cover')
    expect(wrapper.classes()).toContain(size === 'large' ? 'size-12' : 'size-8')
    wrapper.unmount()
  })
  it('retries for a changed website origin and ignores old image events', async () => {
    const wrapper = mount(SupplierLogo, { props: { websiteUrl: 'https://first.example' } })
    const oldImage = wrapper.get('img'); await oldImage.trigger('error')
    await wrapper.setProps({ websiteUrl: 'https://second.example/catalog' })
    expect(wrapper.get('img').attributes('src')).toBe('https://second.example/favicon.ico')
    await wrapper.get('img').trigger('load'); await oldImage.trigger('error')
    expect(wrapper.get('img').classes()).toContain('visible')
    await wrapper.setProps({ websiteUrl: undefined })
    expect(wrapper.find('img').exists()).toBe(false); expect(wrapper.find('svg').exists()).toBe(true)
    wrapper.unmount()
  })
})
