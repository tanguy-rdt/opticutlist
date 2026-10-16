import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AppCheckbox from '../AppCheckbox.vue'

describe('AppCheckbox', () => {
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
