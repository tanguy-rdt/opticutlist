import { mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import { afterEach, describe, expect, it } from 'vitest'

import App from '../App.vue'
import { createAppPinia } from '../pinia'
import { createAppRouter } from '../router'

const wrappers: VueWrapper[] = []
afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  wrappers.length = 0
})

async function mountAt(path: string) {
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  await router.isReady()

  const wrapper = mount(App, {
    global: { plugins: [createAppPinia(), router] },
    attachTo: document.body,
  })
  wrappers.push(wrapper)
  return wrapper
}

describe('App shell', () => {
  it('renders the application name and home view', async () => {
    const wrapper = await mountAt('/')

    expect(wrapper.get('header').text()).toContain('OptiCutList')
    expect(wrapper.get('h1').text()).toBe('Welcome to OptiCutList')
  })

  it('provides hash-safe skip navigation and a projects placeholder', async () => {
    const wrapper = await mountAt('/projects')
    await wrapper.get('a[href="#main-content"]').trigger('click')
    expect(document.activeElement).toBe(wrapper.get('main').element)
    expect(wrapper.get('h1').text()).toBe('Projects')
    expect(wrapper.get('nav').text()).toContain('Materials')
  })

  it('renders the not-found view for unknown routes', async () => {
    const wrapper = await mountAt('/does-not-exist')

    expect(wrapper.get('h1').text()).toBe('Page not found')
  })
})
