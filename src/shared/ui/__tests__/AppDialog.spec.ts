import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import AppDialog from '@/ui/components/common/AppDialog.vue'
const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => { wrapper.unmount() }); wrappers.length = 0; document.body.replaceChildren() })
function setup(props: Partial<InstanceType<typeof AppDialog>['$props']> = {}) {
  const wrapper = mount(AppDialog, { props: { title: 'Edit item', busy: false, ...props }, attachTo: document.body, slots: { default: '<input aria-label="Draft"><div class="dialog-actions"><button type="button">Cancel</button><button type="submit">Save</button></div>' } })
  wrappers.push(wrapper); return wrapper
}
describe('shared application dialog', () => {
  it('uses native modal semantics, one consistent close control and an associated title', async () => {
    const wrapper = setup()
    const dialog = wrapper.get('dialog')
    expect(dialog.attributes('open')).toBeDefined()
    expect(dialog.attributes('aria-labelledby')).toBe(wrapper.get('h2').attributes('id'))
    const close = wrapper.get('button[aria-label="Close form"]')
    expect(close.classes()).toEqual(expect.arrayContaining(['button', 'button-compact', 'button-icon', 'button-ghost']))
    expect(close.get('svg').attributes('aria-hidden')).toBe('true')
    await close.trigger('click'); expect(wrapper.emitted('close')).toHaveLength(1)
  })
  it('guards critical operations, handles Escape and restores focus to the opener on close', async () => {
    const opener = document.createElement('button'); document.body.append(opener); opener.focus()
    const wrapper = setup({ busy: true })
    expect(wrapper.get('button[aria-label="Close form"]').attributes('disabled')).toBeDefined()
    await wrapper.get('dialog').trigger('cancel'); expect(wrapper.emitted('close')).toBeUndefined()
    await wrapper.setProps({ busy: false }); await wrapper.get('dialog').trigger('cancel')
    expect(wrapper.emitted('close')).toHaveLength(1)
    await wrapper.setProps({ open: false }); await flushPromises()
    expect(wrapper.get('dialog').attributes('open')).toBeUndefined()
    expect(document.activeElement).toBe(opener)
  })
  it('keeps generated title IDs distinct and supports explicit titles, sizes and drawers', () => {
    const pair = mount(defineComponent({ render: () => h('div', [h(AppDialog, { title: 'First', busy: false, size: 'small' }), h(AppDialog, { title: 'Second', busy: false, size: 'large' })]) }))
    wrappers.push(pair)
    const dialogs = pair.findAll('dialog')
    expect(dialogs[0]?.attributes('aria-labelledby')).not.toBe(dialogs[1]?.attributes('aria-labelledby'))
    expect(dialogs[0]?.classes()).toContain('max-w-lg')
    expect(dialogs[1]?.classes()).toContain('max-w-5xl')
    const drawer = setup({ drawer: true, titleId: 'custom-title', closeLabel: 'Close drawer' })
    expect(drawer.get('dialog').classes()).toContain('ml-auto')
    expect(drawer.get('dialog').attributes('aria-labelledby')).toBe('custom-title')
    expect(drawer.find('button[aria-label="Close drawer"]').exists()).toBe(true)
  })
})
