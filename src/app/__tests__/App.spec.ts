import { mount } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import { describe, expect, it } from 'vitest'

import App from '../App.vue'
import { createAppPinia } from '../pinia'
import { createAppRouter } from '../router'

async function mountAt(path: string) {
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  await router.isReady()

  return mount(App, {
    global: { plugins: [createAppPinia(), router] },
  })
}

describe('App shell', () => {
  it('renders the application name and home view', async () => {
    const wrapper = await mountAt('/')

    expect(wrapper.get('header').text()).toContain('OptiCutList')
    expect(wrapper.get('h1').text()).toBe('Welcome to OptiCutList')
  })

  it('renders the not-found view for unknown routes', async () => {
    const wrapper = await mountAt('/does-not-exist')

    expect(wrapper.get('h1').text()).toBe('Page not found')
  })
})
