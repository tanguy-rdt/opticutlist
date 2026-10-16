import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AppCheckbox from '../AppCheckbox.vue'

describe('AppCheckbox', () => {
  it('exposes a native mixed state without duplicating the checked model', async () => {
    const wrapper = mount(AppCheckbox, { props: { id: 'group', label: 'Select group', hideLabel: true, modelValue: false, indeterminate: true } })
    const input = wrapper.get<HTMLInputElement>('input')
    expect(input.element.indeterminate).toBe(true)
    expect(input.attributes('aria-checked')).toBe('mixed')
    expect(wrapper.get('label span').classes()).toContain('sr-only')
    await wrapper.setProps({ indeterminate: false, modelValue: true })
    expect(input.element.indeterminate).toBe(false)
    expect(input.element.checked).toBe(true)
    expect(input.attributes('aria-checked')).toBe('true')
    wrapper.unmount()
  })
  it('uses a labeled native checkbox with linked help, checked state and model updates', async () => {
    const wrapper = mount(AppCheckbox, { props: { id: 'stock-preference', label: 'Prefer stock panels', description: 'Use owned panels.', modelValue: true } })
    const input = wrapper.get<HTMLInputElement>('input')
    expect(input.attributes('type')).toBe('checkbox')
    expect(input.element.checked).toBe(true)
    expect(wrapper.get('label').attributes('for')).toBe(input.attributes('id'))
    expect(input.attributes('aria-describedby')).toBe('stock-preference-description')
    expect(wrapper.get('#stock-preference-description').text()).toBe('Use owned panels.')
    await input.setValue(false)
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
    await wrapper.setProps({ disabled: true })
    expect(input.attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
})
