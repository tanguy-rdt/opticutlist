import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import { afterEach, describe, expect, it } from 'vitest'

import App from '../App.vue'
import { createAppPinia } from '../pinia'
import { createAppRouter } from '../router'
import { materialRepositoryKey } from '../../features/materials/material-repository'
import { partRepositoryKey } from '../../features/parts/part-repository'
import { createLocalPersistence } from '../../infrastructure/persistence/local-database'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { supplierRepositoryKey, supplierProductRepositoryKey } from '../../features/suppliers/catalog-repositories'
import { createCatalogRepositories } from '../../application/catalog/catalog-repositories'

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

  it('opens the functional Parts page from the main navigation', async () => {
    const persistence = createLocalPersistence('parts-navigation-test', { indexedDB: new IDBFactory(), IDBKeyRange })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/')
    await router.isReady()
    const wrapper = mount(App, {
      global: {
        plugins: [createAppPinia(), router],
        provide: { [materialRepositoryKey]: persistence.materials, [partRepositoryKey]: persistence.parts },
      },
    })
    wrappers.push(wrapper)
    try {
      await wrapper.get('nav a[href="/parts"]').trigger('click')
      await flushPromises()
      expect(wrapper.get('h1').text()).toBe('Parts')
      expect(wrapper.get('nav a[href="/parts"]').attributes('aria-current')).toBe('page')
    } finally {
      wrapper.unmount()
      persistence.close()
    }
  })

  it('opens Suppliers from the main navigation', async () => {
    const persistence = createLocalPersistence('supplier-navigation-test', { indexedDB: new IDBFactory(), IDBKeyRange })
    const catalog = createCatalogRepositories(persistence)
    const router = createAppRouter(createMemoryHistory())
    await router.push('/')
    await router.isReady()
    const wrapper = mount(App, {
      global: {
        plugins: [createAppPinia(), router],
        provide: { [materialRepositoryKey]: catalog.materials, [supplierRepositoryKey]: catalog.suppliers, [supplierProductRepositoryKey]: catalog.supplierProducts },
      },
    })
    wrappers.push(wrapper)
    try {
      await wrapper.get('nav a[href="/suppliers"]').trigger('click')
      await flushPromises()
      expect(wrapper.get('h1').text()).toBe('Suppliers')
      expect(wrapper.get('nav a[href="/suppliers"]').attributes('aria-current')).toBe('page')
    } finally { wrapper.unmount(); persistence.close() }
  })
})
