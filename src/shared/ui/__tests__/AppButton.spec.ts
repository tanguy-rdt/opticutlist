import { mount } from '@vue/test-utils'
import { h } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import AppButton from '../AppButton.vue'
import AppIcon from '../AppIcon.vue'

describe('shared application button', () => {
  it.each([['primary', 'button-primary'], ['secondary', 'button'], ['ghost', 'button-ghost'], ['destructive', 'button-danger']] as const)('renders the %s variant with native button semantics', (variant, className) => {
    const clicked = vi.fn()
    const wrapper = mount(AppButton, { props: { variant }, attrs: { onClick: clicked }, slots: { default: 'Action' } })
    expect(wrapper.get<HTMLButtonElement>('button').element.tagName).toBe('BUTTON')
    expect(wrapper.attributes('type')).toBe('button')
    expect(wrapper.classes()).toContain(className)
    wrapper.get<HTMLButtonElement>('button').element.click()
    expect(clicked).toHaveBeenCalledOnce()
    wrapper.unmount()
  })
  it('shares default/small metrics without a separate icon sizing system', async () => {
    const wrapper = mount(AppButton, { props: { iconOnly: true, label: 'Close dialog', variant: 'ghost', size: 'small' }, slots: { default: () => h(AppIcon, { name: 'close' }) } })
    expect(wrapper.classes()).toContain('button-icon')
    expect(wrapper.classes()).toContain('button-compact')
    expect(wrapper.attributes('aria-label')).toBe('Close dialog')
    await wrapper.setProps({ size: 'default' })
    expect(wrapper.classes()).not.toContain('button-compact')
    expect(wrapper.classes()).toContain('button-icon')
    wrapper.unmount()
  })
  it('preserves submit/reset types and disables activation during loading or disabled state', async () => {
    const clicked = vi.fn()
    const wrapper = mount(AppButton, { props: { type: 'submit', loading: true }, attrs: { onClick: clicked }, slots: { default: 'Saving…' } })
    expect(wrapper.attributes('type')).toBe('submit')
    expect(wrapper.attributes('aria-busy')).toBe('true')
    expect(wrapper.get<HTMLButtonElement>('button').element.disabled).toBe(true)
    wrapper.get<HTMLButtonElement>('button').element.click(); expect(clicked).not.toHaveBeenCalled()
    expect(wrapper.find('[aria-hidden="true"]').exists()).toBe(true)
    await wrapper.setProps({ loading: false, disabled: true, type: 'reset' })
    wrapper.get<HTMLButtonElement>('button').element.click(); expect(clicked).not.toHaveBeenCalled()
    expect(wrapper.attributes('type')).toBe('reset')
    expect(wrapper.find('.button-spinner').exists()).toBe(false)
    await wrapper.setProps({ disabled: false })
    wrapper.get<HTMLButtonElement>('button').element.click(); expect(clicked).toHaveBeenCalledOnce()
    wrapper.unmount()
  })
})
