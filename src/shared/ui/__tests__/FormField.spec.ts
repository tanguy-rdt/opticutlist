import { mount } from '@vue/test-utils'
import { h } from 'vue'
import { describe, expect, it } from 'vitest'
import FormField from '@/ui/components/common/FormField.vue'
describe('shared form field', () => {
  it('keeps labels, required state, hints and validation errors associated with the control', async () => {
    const wrapper = mount(FormField, { props: { id: 'length', label: 'Length', required: true, hint: 'Millimeters', requiredIndicator: 'asterisk' }, slots: { default: (props: { controlAttrs: Record<string, unknown> }) => h('input', { ...props.controlAttrs, class: 'field' }) } })
    expect(wrapper.get('label').attributes('for')).toBe('length')
    expect(wrapper.get('input').attributes('required')).toBeDefined()
    expect(wrapper.get('input').attributes('aria-describedby')).toBe('length-error length-hint')
    expect(wrapper.get('#length-error').classes()).toContain('hidden')
    await wrapper.setProps({ error: 'Length must be positive' })
    expect(wrapper.get('input').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('#length-error').attributes('role')).toBe('alert')
    expect(wrapper.get('#length-error').classes()).not.toContain('hidden')
    expect(wrapper.get('#length-error').text()).toBe('Length must be positive')
    wrapper.unmount()
  })
})
