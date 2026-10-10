import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { createMemoryHistory } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from '../App.vue'
import { createAppPinia } from '../pinia'
import { createAppRouter } from '../router'
import { materialRepositoryKey } from '../../features/materials/material-repository'
import { partRepositoryKey } from '../../features/parts/part-repository'
import { createLocalPersistence } from '../../infrastructure/persistence/local-database'
import { supplierRepositoryKey, supplierProductRepositoryKey } from '../../features/suppliers/catalog-repositories'
import { createCatalogRepositories } from '../../application/catalog/catalog-repositories'
import { validMaterialInput, validPartInput, validSupplierInput, validSupplierProductInput } from '../../domain/model/__tests__/fixtures'

const wrappers: VueWrapper[] = []
const connections: ReturnType<typeof createLocalPersistence>[] = []
afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  for (const persistence of connections) persistence.close()
  wrappers.length = 0
  connections.length = 0
  document.documentElement.removeAttribute('data-theme')
})

async function mountAt(path: string, indexedDB = new IDBFactory()) {
  const persistence = createLocalPersistence('navigation-test', { indexedDB, IDBKeyRange })
  connections.push(persistence)
  const catalog = createCatalogRepositories(persistence)
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  await router.isReady()

  const wrapper = mount(App, {
    global: {
      plugins: [createAppPinia(), router],
      provide: {
        [materialRepositoryKey]: catalog.materials,
        [partRepositoryKey]: persistence.parts,
        [supplierRepositoryKey]: catalog.suppliers,
        [supplierProductRepositoryKey]: catalog.supplierProducts,
      },
    },
    attachTo: document.body,
  })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router, persistence }
}

describe('Home and application navigation', () => {
  it('renders the three home cards in the desktop two-column arrangement', async () => {
    const { wrapper } = await mountAt('/')
    expect(wrapper.get('header').text()).toContain('OptiCutList')
    expect(wrapper.get('h1').text()).toBe('Your next build starts here.')
    expect(wrapper.findAll('article h2').map(heading => heading.text())).toEqual(['New Project', 'Import Project', 'Catalog'])
    expect(wrapper.get('article[aria-labelledby="catalog-title"]').classes()).toContain('md:row-span-2')
    expect(wrapper.get('article[aria-labelledby="import-project-title"]').classes()).toContain('md:row-start-2')
    expect(wrapper.get('article[aria-labelledby="catalog-title"] svg').attributes('aria-hidden')).toBe('true')
  })

  it('keeps global navigation limited to Home and Catalog without a fake project workspace', async () => {
    const { wrapper } = await mountAt('/')
    expect(wrapper.findAll('nav[aria-label="Main"] a').map(link => link.text())).toEqual(['Home', 'Catalog'])
    expect(wrapper.find('nav[aria-label="Project"]').exists()).toBe(false)
    expect(wrapper.get('nav a[href="/"]').attributes('aria-current')).toBe('page')
  })

  it('clearly disables project creation and import when no workflow exists', async () => {
    const { wrapper, router } = await mountAt('/')
    const create = wrapper.get('article[aria-labelledby="new-project-title"] button')
    const importProject = wrapper.get('article[aria-labelledby="import-project-title"] button')
    expect(create.attributes('disabled')).toBeDefined()
    expect(importProject.attributes('disabled')).toBeDefined()
    expect(create.attributes('aria-describedby')).toBe('new-project-unavailable')
    expect(importProject.attributes('aria-describedby')).toBe('import-project-unavailable')
    expect(wrapper.get('#new-project-unavailable').text()).toContain('not available yet')
    expect(wrapper.get('#import-project-unavailable').text()).toContain('not available yet')
    await create.trigger('click')
    await importProject.trigger('click')
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('opens the existing catalog from its home card with no project', async () => {
    const { wrapper, router } = await mountAt('/')
    await wrapper.get('article a[href="/catalog"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/catalog')
    expect(wrapper.get('h1').text()).toBe('Catalog')
    expect(wrapper.text()).toContain('New supplier')
    expect(wrapper.get('nav a[href="/catalog"]').attributes('aria-current')).toBe('page')
    expect(wrapper.find('nav[aria-label="Project"]').exists()).toBe(false)
  })

  it('opens Catalog from global navigation and returns home', async () => {
    const { wrapper, router } = await mountAt('/')
    await wrapper.get('nav a[href="/catalog"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('h1').text()).toBe('Catalog')
    await wrapper.get('a[aria-label="OptiCutList home"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    expect(wrapper.get('h1').text()).toBe('Your next build starts here.')
  })

  it('preserves the supplier deep link as an alias of the same catalog', async () => {
    const { wrapper, router } = await mountAt('/suppliers')
    expect(wrapper.get('h1').text()).toBe('Catalog')
    expect(router.currentRoute.value.name).toBe('suppliers')
    expect(wrapper.get('nav a[href="/catalog"]').attributes('aria-current')).toBe('page')
  })

  it('keeps saved libraries reachable without adding them to global navigation', async () => {
    const { wrapper } = await mountAt('/')
    await wrapper.get('a[href="/projects"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('h1').text()).toBe('Saved parts and materials')
    await wrapper.get('a[href="/parts"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('h1').text()).toBe('Parts')
    expect(wrapper.text()).toContain('These records are not attached to a project.')
    expect(wrapper.findAll('nav a').map(link => link.text())).toEqual(['Home', 'Catalog'])
    await wrapper.get('a[href="/projects"]').trigger('click')
    await flushPromises()
    await wrapper.get('a[href="/materials"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('h1').text()).toBe('Materials')
    expect(wrapper.find('nav[aria-label="Project"]').exists()).toBe(false)
  })

  it('preserves existing records across navigation and database reopening', async () => {
    const indexedDB = new IDBFactory()
    const { wrapper, router, persistence } = await mountAt('/', indexedDB)
    expect((await persistence.materials.create(validMaterialInput)).ok).toBe(true)
    expect((await persistence.parts.create(validPartInput)).ok).toBe(true)
    expect((await persistence.suppliers.create(validSupplierInput)).ok).toBe(true)
    expect((await persistence.supplierProducts.create(validSupplierProductInput)).ok).toBe(true)

    await router.push('/parts')
    await flushPromises()
    await vi.waitFor(() => { expect(wrapper.get('table').text()).toContain(validPartInput.name) })
    await router.push('/materials')
    await flushPromises()
    await vi.waitFor(() => { expect(wrapper.get('table').text()).toContain(validMaterialInput.name) })
    await router.push('/catalog')
    await flushPromises()
    await vi.waitFor(() => { expect(wrapper.text()).toContain(validSupplierProductInput.name) })
    expect(wrapper.text()).toContain(validSupplierInput.name)
    await router.push('/')
    await flushPromises()
    wrapper.unmount()
    persistence.close()

    const reopened = await mountAt('/parts', indexedDB)
    await vi.waitFor(() => { expect(reopened.wrapper.get('table').text()).toContain(validPartInput.name) })
    expect(await reopened.persistence.parts.list()).toEqual({ ok: true, value: [expect.objectContaining(validPartInput)] })
    expect(await reopened.persistence.materials.list()).toEqual({ ok: true, value: [expect.objectContaining(validMaterialInput)] })
    expect(await reopened.persistence.supplierProducts.list()).toEqual({ ok: true, value: [expect.objectContaining(validSupplierProductInput)] })
    expect(await reopened.persistence.suppliers.list()).toEqual({ ok: true, value: [expect.objectContaining(validSupplierInput)] })
  })

  it('provides hash-safe skip navigation', async () => {
    const { wrapper } = await mountAt('/')
    await wrapper.get('a[href="#main-content"]').trigger('click')
    expect(document.activeElement).toBe(wrapper.get('main').element)
  })

  it('renders the not-found view for unknown routes', async () => {
    const { wrapper } = await mountAt('/does-not-exist')
    expect(wrapper.get('h1').text()).toBe('Page not found')
  })
})
