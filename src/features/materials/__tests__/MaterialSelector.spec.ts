import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MaterialSelector from '../MaterialSelector.vue'
import { materialPresets } from '../material-library'

const options = [
  ...materialPresets.map(preset => ({ value: `preset:${preset.id}`, name: preset.name, group: preset.category, presetId: preset.id })),
  { value: 'custom-pine', name: 'Pin Douglas', group: 'Existing catalog materials', presetId: 'pin' },
  { value: 'scratch', name: 'Custom panel', group: 'Existing catalog materials', presetId: undefined },
]
const wrappers: ReturnType<typeof mount<typeof MaterialSelector>>[] = []
function render(modelValue = '') {
  const wrapper = mount(MaterialSelector, { attachTo: document.body, props: { id: 'material', modelValue, options, disabled: false } })
  wrappers.push(wrapper)
  return wrapper
}
afterEach(() => { wrappers.forEach(wrapper => { wrapper.unmount() }); wrappers.length = 0; vi.restoreAllMocks() })
describe('searchable Material selector', () => {
  it('groups all presets and catalog materials, shows thumbnails and marks the stable selected ID', async () => {
    const wrapper = render('custom-pine')
    await wrapper.get('#material').trigger('click')
    expect(wrapper.findAll('[role="group"]')).toHaveLength(5)
    expect(wrapper.findAll('[role="option"]')).toHaveLength(22)
    expect(wrapper.get('[data-value="custom-pine"]').attributes('aria-selected')).toBe('true')
    expect(wrapper.get('[data-value="scratch"]').find('img').exists()).toBe(false)
    expect(wrapper.get('[data-value="preset:pin"] img').attributes('src')).toContain('/materials/previews/pin.webp')
    expect(document.activeElement).toBe(wrapper.get('[role="combobox"]').element)
  })
  it('searches case-insensitively and selects without an extra material creation step', async () => {
    const wrapper = render()
    await wrapper.get('#material').trigger('click')
    await wrapper.get('input').setValue('pIN')
    expect(wrapper.findAll('[role="option"]').map(option => option.text())).toEqual(['Pin', 'Sapin', 'Pin Douglas'])
    await wrapper.get('[data-value="preset:pin"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['preset:pin']])
    expect(wrapper.emitted('create')).toBeUndefined()
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('#material').element)
  })
  it('keeps the compact search integrated above the list and supports keyboard selection', async () => {
    const wrapper = render()
    await wrapper.get('#material').trigger('click')
    const search = wrapper.get('[role="combobox"]')
    expect(search.element.parentElement?.classList.contains('h-8')).toBe(true)
    expect(search.element.parentElement?.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    expect(search.attributes('class')).not.toContain('field')
    expect(search.element.compareDocumentPosition(wrapper.get('[role="listbox"]').element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await search.setValue('Pin Douglas')
    await search.trigger('keydown', { key: 'ArrowDown' })
    await search.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:modelValue')).toEqual([['custom-pine']])
    expect(document.activeElement).toBe(wrapper.get('#material').element)
  })
  it('brings the complete popup into view inside a scrolling form drawer', async () => {
    const scroll = vi.fn()
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll })
    try {
      const wrapper = render()
      await wrapper.get('#material').trigger('click')
      expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest' })
      expect(scroll.mock.contexts.at(-1)).toBe(wrapper.get('[role="listbox"]').element.parentElement)
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    }
  })
  it('supports arrow keys, Home, End and Enter with active-descendant tracking', async () => {
    const wrapper = render()
    await wrapper.get('#material').trigger('keydown', { key: 'ArrowDown' })
    const search = wrapper.get('input')
    await search.trigger('keydown', { key: 'End' })
    expect(search.attributes('aria-activedescendant')).toBe('material-option-21')
    await search.trigger('keydown', { key: 'Home' })
    await search.trigger('keydown', { key: 'ArrowDown' })
    await search.trigger('keydown', { key: 'ArrowUp' })
    await search.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:modelValue')).toEqual([['preset:chene']])
  })
  it('Escape closes only the dropdown and returns focus without cancelling its enclosing form', async () => {
    const wrapper = render()
    const parentKey = vi.fn()
    document.body.addEventListener('keydown', parentKey)
    try {
      await wrapper.get('#material').trigger('click')
      await wrapper.get('input').trigger('keydown', { key: 'Escape' })
      expect(parentKey).not.toHaveBeenCalled()
      expect(wrapper.get('#material').attributes('aria-expanded')).toBe('false')
      expect(document.activeElement).toBe(wrapper.get('#material').element)
    } finally { document.body.removeEventListener('keydown', parentKey) }
  })
  it('keeps custom creation available at the bottom even when search has no matches', async () => {
    const wrapper = render()
    await wrapper.get('#material').trigger('click')
    await wrapper.get('input').setValue('no such material')
    expect(wrapper.get('[role="status"]').text()).toBe('No matching materials.')
    const create = wrapper.findAll('button').find(button => button.text() === '+ Create custom material')
    if (!create) throw new Error('Missing custom material action')
    await create.trigger('click')
    expect(wrapper.emitted('create')).toEqual([[]])
    expect(wrapper.find('input').exists()).toBe(false)
  })
  it('closes on outside interaction or Tab leaving the control and disables while saving', async () => {
    const wrapper = render()
    await wrapper.get('#material').trigger('click')
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await nextTick()
    expect(wrapper.get('#material').attributes('aria-expanded')).toBe('false')
    await wrapper.get('#material').trigger('click')
    await wrapper.get('input').trigger('focusout', { relatedTarget: document.body })
    expect(wrapper.find('input').exists()).toBe(false)
    await wrapper.get('#material').trigger('click')
    await wrapper.setProps({ disabled: true })
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.get('#material').attributes('disabled')).toBeDefined()
  })
  it('preserves missing IDs explicitly and never guesses a replacement', () => {
    const wrapper = render('missing-record')
    expect(wrapper.text()).toContain('Missing material — choose another')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})
