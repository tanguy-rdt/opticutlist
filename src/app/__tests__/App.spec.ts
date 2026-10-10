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
  it('keeps the three-tile layout and woodworking imagery', async () => {
    const { wrapper } = await mountAt('/')
    expect(wrapper.get('header').text()).toContain('OptiCutList')
    expect(wrapper.get('h1').text()).toBe('Your next build starts here.')
    expect(wrapper.findAll('.home-card h2').map(heading => heading.text())).toEqual(['New Project', 'Import Project', 'Catalogue'])
    expect(wrapper.get('[aria-labelledby="catalog-title"]').classes()).toContain('md:row-span-2')
    expect(wrapper.get('[aria-labelledby="import-project-title"]').classes()).toContain('md:row-start-2')
    expect(wrapper.get('[aria-labelledby="catalog-title"] svg').attributes('aria-hidden')).toBe('true')
  })

  it('keeps only the logo and theme selector in the header', async () => {
    const { wrapper } = await mountAt('/')
    expect(wrapper.find('header nav').exists()).toBe(false)
    expect(wrapper.findAll('header a')).toHaveLength(1)
    expect(wrapper.get('header a').attributes('aria-label')).toBe('OptiCutList home')
    expect(wrapper.find('#theme-preference').exists()).toBe(true)
    expect(wrapper.find('aside').exists()).toBe(false)
  })

  it('exposes unavailable project tiles to keyboard users with clear explanations', async () => {
    const { wrapper, router } = await mountAt('/')
    for (const id of ['new-project', 'import-project']) {
      const tile = wrapper.get<HTMLElement>(`[aria-labelledby="${id}-title"]`)
      expect(tile.attributes('aria-disabled')).toBe('true')
      expect(tile.attributes('role')).toBe('button')
      expect(tile.attributes('tabindex')).toBe('0')
      expect(tile.attributes('aria-describedby')).toBe(`${id}-unavailable`)
      expect(wrapper.get(`#${id}-unavailable`).text()).toContain('not available yet')
      tile.element.focus()
      expect(document.activeElement).toBe(tile.element)
      await tile.trigger('click')
      await tile.trigger('keydown', { key: 'Enter' })
      await tile.trigger('keydown', { key: ' ' })
      await flushPromises()
      expect(router.currentRoute.value.path).toBe('/')
    }
  })

  it('opens Catalogue when any part of its tile is clicked', async () => {
    const { wrapper, router } = await mountAt('/')
    const tile = wrapper.get('a[aria-labelledby="catalog-title"]')
    expect(tile.attributes('href')).toBe('/catalog')
    expect(tile.find('a, button, input, select').exists()).toBe(false)
    await tile.get('svg').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/catalog')
    expect(wrapper.get('h1').text()).toBe('Catalogue')
    expect(wrapper.text()).toContain('New supplier')
  })

  it('supports native keyboard activation of the entire Catalogue link', async () => {
    const { wrapper, router } = await mountAt('/')
    const tile = wrapper.get<HTMLAnchorElement>('a[aria-labelledby="catalog-title"]')
    tile.element.focus()
    expect(document.activeElement).toBe(tile.element)
    expect(tile.element.tabIndex).toBe(0)
    expect(tile.attributes('aria-disabled')).toBeUndefined()
    // jsdom does not synthesize browser default actions for Enter. Dispatch the
    // zero-detail click that a browser emits when a focused native link is activated.
    tile.element.dispatchEvent(new MouseEvent('click', { detail: 0, bubbles: true, cancelable: true }))
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/catalog')
  })

  it('removes nested actions, catalogue badges and independent saved-library links', async () => {
    const { wrapper } = await mountAt('/')
    expect(wrapper.find('main button').exists()).toBe(false)
    expect(wrapper.findAll('main a').map(link => link.attributes('href'))).toEqual(['/catalog'])
    expect(wrapper.text()).not.toContain('Access saved parts and materials')
    const catalogue = wrapper.get('[aria-labelledby="catalog-title"]')
    expect(catalogue.findAll('span')).toHaveLength(0)
    expect(catalogue.findAll('p')).toHaveLength(1)
    expect(catalogue.text()).not.toContain('Open catalog')
  })

  it.each(['/catalog', '/suppliers'])('provides Back to Home from %s without a project', async (path) => {
    const { wrapper, router } = await mountAt(path)
    expect(wrapper.get('h1').text()).toBe('Catalogue')
    expect(router.currentRoute.value.name).toBe('suppliers')
    const back = wrapper.get('main a[href="/"]')
    expect(back.text()).toContain('Back to Home')
    await back.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    expect(wrapper.get('h1').text()).toBe('Your next build starts here.')
  })

  it('keeps legacy routes usable without exposing global Parts or Materials links', async () => {
    const { wrapper, router } = await mountAt('/projects')
    expect(wrapper.get('h1').text()).toBe('Projects')
    expect(wrapper.find('a[href="/parts"], a[href="/materials"]').exists()).toBe(false)
    for (const path of ['/parts', '/materials']) {
      await router.push(path)
      await flushPromises()
      expect(wrapper.get('h1').text()).toBe(path === '/parts' ? 'Parts' : 'Materials')
      expect(wrapper.find('nav').exists()).toBe(false)
      expect(wrapper.find('a[href="/projects"]').exists()).toBe(false)
    }
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
