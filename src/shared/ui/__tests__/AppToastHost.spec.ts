import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import AppToastHost from '@/ui/components/common/AppToastHost.vue'
import { useToastStore } from '@/ui/stores/toast-store'

let wrapper: VueWrapper
function setup() {
  const pinia = createPinia()
  wrapper = mount(AppToastHost, { global: { plugins: [pinia] } })
  return useToastStore(pinia)
}
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { wrapper.unmount(); vi.useRealTimers() })

describe('application toast notifications', () => {
  it('announces success and descriptions politely, deduplicates active messages and stacks different events', async () => {
    const store = setup()
    const id = store.success('Product created', 'Oak panel')
    expect(store.success('Product created', 'Oak panel')).toBe(id)
    store.success('Supplier updated')
    await nextTick()
    expect(wrapper.findAll('article')).toHaveLength(2)
    expect(wrapper.findAll('[role="status"]').map(item => item.text())).toEqual(['Product createdOak panel', 'Supplier updated'])
    expect(wrapper.get('[role="status"]').attributes('aria-atomic')).toBe('true')
    expect(wrapper.get('.app-toast-progress').attributes('style')).toContain('4000ms')
    await vi.advanceTimersByTimeAsync(4000)
    expect(store.notifications).toHaveLength(0)
  })

  it('dismisses manually and clears timers on removal and host unmount', async () => {
    const store = setup()
    store.success('Product deleted')
    await nextTick()
    await wrapper.get('button[aria-label="Dismiss Product deleted"]').trigger('click')
    expect(store.notifications).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
    store.success('Supplier deleted')
    await nextTick()
    wrapper.unmount()
    expect(store.notifications).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('pauses the remaining lifetime and progress while hovered and resumes without resetting', async () => {
    const store = setup()
    store.success('Product updated')
    await nextTick()
    await vi.advanceTimersByTimeAsync(1000)
    await wrapper.get('article').trigger('mouseenter')
    expect(wrapper.get('.app-toast-progress').attributes('style')).toContain('paused')
    await vi.advanceTimersByTimeAsync(10000)
    expect(store.notifications).toHaveLength(1)
    await wrapper.get('article').trigger('mouseleave')
    expect(wrapper.get('.app-toast-progress').attributes('style')).toContain('running')
    await vi.advanceTimersByTimeAsync(2999)
    expect(store.notifications).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(store.notifications).toHaveLength(0)
  })

  it('keeps keyboard-focused notifications readable after the pointer leaves', async () => {
    const store = setup()
    store.success('Product created', undefined, 2000)
    await nextTick()
    await wrapper.get('article').trigger('focusin')
    await wrapper.get('article').trigger('mouseenter')
    await wrapper.get('article').trigger('mouseleave')
    await vi.advanceTimersByTimeAsync(5000)
    expect(store.notifications).toHaveLength(1)
    await wrapper.get('article').trigger('focusout', { relatedTarget: null })
    await vi.advanceTimersByTimeAsync(2000)
    expect(store.notifications).toHaveLength(0)
  })

  it('uses a viewport overlay below native dialogs and removes motion for reduced-motion users', () => {
    setup()
    const css = readFileSync('src/ui/styles.css', 'utf8')
    expect(css).toMatch(/\.app-toast-host\s*\{\s*position: fixed;\s*z-index: 40;/)
    expect(css).toContain('pointer-events: none;')
    expect(css).toContain('width: 100%;\n  height: 3px;')
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.toast-enter-active, \.toast-leave-active \{ transition: none; \}\s*\.app-toast-progress \{ animation: none; \}/)
  })
})

it('keeps PDF operation errors available until explicitly dismissed', async () => {
  const store = setup()
  const id = store.error('Could not download PDF', 'Retry after checking the document settings.')
  expect(store.error('Could not download PDF', 'Retry after checking the document settings.')).toBe(id)
  await nextTick()
  expect(wrapper.get('[role="alert"]').text()).toContain('Retry after checking')
  expect(wrapper.find('.app-toast-progress').exists()).toBe(false)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(store.notifications).toHaveLength(1)
  await wrapper.get('button[aria-label="Dismiss Could not download PDF"]').trigger('click')
  expect(store.notifications).toHaveLength(0)
})
