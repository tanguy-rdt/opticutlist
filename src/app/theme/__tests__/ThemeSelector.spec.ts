import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ThemeSelector from '@/ui/components/settings/ThemeSelector.vue'

const wrappers: VueWrapper[] = []
const addListener = vi.fn<(type: string, listener: (event: MediaQueryListEvent) => void) => void>()
const removeListener = vi.fn<(type: string, listener: (event: MediaQueryListEvent) => void) => void>()
const media = { matches: false, addEventListener: addListener, removeEventListener: removeListener }

const matchMedia = vi.fn(() => media)

function render() {
  const wrapper = mount(ThemeSelector)
  wrappers.push(wrapper)
  return wrapper
}
function changeSystem(dark: boolean): void {
  addListener.mock.calls[0]?.[1](Object.assign(new Event('change'), { matches: dark, media: '(prefers-color-scheme: dark)' }))
}

beforeEach(() => {
  localStorage.clear()
  media.matches = false
  addListener.mockClear()
  removeListener.mockClear()
  vi.stubGlobal('matchMedia', matchMedia)
})
afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  wrappers.length = 0
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete document.documentElement.dataset.theme
  document.documentElement.style.colorScheme = ''
})

describe('ThemeSelector', () => {
  it('defaults to System and applies the operating system theme', () => {
    media.matches = true
    const wrapper = render()
    expect(wrapper.get('select').element.value).toBe('system')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)')
  })

  it('responds to system changes only while System is selected', async () => {
    const wrapper = render()
    changeSystem(true)
    await wrapper.vm.$nextTick()
    expect(document.documentElement.dataset.theme).toBe('dark')
    await wrapper.get('select').setValue('light')
    changeSystem(false)
    changeSystem(true)
    await wrapper.vm.$nextTick()
    expect(document.documentElement.dataset.theme).toBe('light')
    await wrapper.get('select').setValue('system')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('persists explicit preferences and restores them on remount', async () => {
    const wrapper = render()
    await wrapper.get('select').setValue('dark')
    expect(localStorage.getItem('opticutlist.theme')).toBe('dark')
    wrapper.unmount()
    const restored = render()
    expect(restored.get('select').element.value).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    await restored.get('select').setValue('system')
    expect(localStorage.getItem('opticutlist.theme')).toBe('system')
  })

  it('falls back to System for an invalid saved preference', () => {
    localStorage.setItem('opticutlist.theme', 'invalid')
    expect(render().get('select').element.value).toBe('system')
  })

  it('still applies themes when localStorage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked') })
    const wrapper = render()
    await wrapper.get('select').setValue('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(wrapper.get('[role="status"]').text()).toContain('could not save')
  })

  it('removes the system listener on unmount', () => {
    const wrapper = render()
    wrapper.unmount()
    expect(removeListener).toHaveBeenCalledWith('change', addListener.mock.calls[0]?.[1])
  })

  it('supports environments without matchMedia', async () => {
    vi.stubGlobal('matchMedia', undefined)
    const wrapper = render()
    expect(document.documentElement.dataset.theme).toBe('light')
    await wrapper.get('select').setValue('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
