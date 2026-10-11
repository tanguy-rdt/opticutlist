import { optimizeProject } from '../../domain/optimizer/optimize-project'
import { panelSnapshotSchema } from '../../domain/model/saved-cutting-plan'
import { partSchema } from '../../domain/model/part'
import { supplierProductSchema } from '../../domain/model/supplier-product'
import { createSavedPlanService } from '../../application/plans/saved-plan-service'
import { savedPlanServiceKey } from '../../features/optimization/saved-plan-service'
import { createCuttingConfirmationService } from '../../application/inventory/cutting-confirmation-service'
import { cuttingConfirmationServiceKey } from '../../features/inventory/cutting-confirmation-service'
import { stockItemSchema } from '../../domain/model/stock-item'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { createMemoryHistory } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createOptimizationService, type OptimizationWorkerPort } from '../../application/optimization/optimization-service'
import { optimizationServiceFactoryKey } from '../../features/optimization/optimization-service'
import { handleOptimizationRequest } from '../../workers/optimization/handle-optimization-request'
import App from '../App.vue'
import { createAppPinia } from '../pinia'
import { createAppRouter } from '../router'
import { materialRepositoryKey } from '../../features/materials/material-repository'
import { projectServiceKey } from '../../features/projects/project-service'
import { createProjectService } from '../../application/projects/project-service'
import { cuttingProjectSchema } from '../../domain/model/cutting-project'
import { createLocalPersistence } from '../../infrastructure/persistence/local-database'
import { supplierRepositoryKey, supplierProductRepositoryKey } from '../../features/suppliers/catalog-repositories'
import { createCatalogRepositories } from '../../application/catalog/catalog-repositories'
import { validMaterialInput, validPartInput, validSupplierInput, validSupplierProductInput, validStockItemInput } from '../../domain/model/__tests__/fixtures'

vi.mock('../../features/optimization/viewer/plan-canvas', () => ({ createPlanCanvas: () => ({ setViewport: vi.fn(), setSelection: vi.fn(), setPalette: vi.fn(), resize: vi.fn(), destroy: vi.fn() }) }))

const wrappers: VueWrapper[] = []
const connections: ReturnType<typeof createLocalPersistence>[] = []
afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  for (const persistence of connections) persistence.close()
  vi.restoreAllMocks()
  wrappers.length = 0
  connections.length = 0
  document.documentElement.removeAttribute('data-theme')
})

async function mountAt(path: string, indexedDB = new IDBFactory()) {
  const persistence = createLocalPersistence('navigation-test', { indexedDB, IDBKeyRange })
  connections.push(persistence)
  const catalog = createCatalogRepositories(persistence)
  const service = createProjectService(persistence)
  const workers: OptimizationWorkerPort[] = []
  const postMessage = vi.fn<OptimizationWorkerPort['postMessage']>()
  const createWorker = (): OptimizationWorkerPort => {
    const worker: OptimizationWorkerPort = { postMessage, terminate: vi.fn(), onmessage: null, onerror: null, onmessageerror: null }
    workers.push(worker)
    return worker
  }
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  await router.isReady()

  const wrapper = mount(App, {
    global: {
      plugins: [createAppPinia(), router],
      provide: {
        [optimizationServiceFactoryKey]: () => createOptimizationService(createWorker),
        [savedPlanServiceKey]: createSavedPlanService(persistence),
        [cuttingConfirmationServiceKey]: createCuttingConfirmationService(persistence),
        [materialRepositoryKey]: catalog.materials,
        [projectServiceKey]: service,
        [supplierRepositoryKey]: catalog.suppliers,
        [supplierProductRepositoryKey]: catalog.supplierProducts,
      },
    },
    attachTo: document.body,
  })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router, persistence, service, workers, postMessage }
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
    for (const id of ['import-project']) {
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
    expect(wrapper.find('.home-card button').exists()).toBe(false)
    expect(wrapper.findAll('.home-card').filter(tile => tile.element.tagName === 'A').map(link => link.attributes('href'))).toEqual(['/projects', '/catalog'])
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

  it('requires a project for old Parts and Materials routes', async () => {
    const { wrapper, router } = await mountAt('/parts')
    expect(router.currentRoute.value.path).toBe('/projects')
    expect(wrapper.get('h1').text()).toBe('New Project')
    expect(wrapper.find('nav').exists()).toBe(false)
    await router.push('/materials')
    expect(router.currentRoute.value.path).toBe('/projects')
  })

  it('creates, opens and refreshes an isolated project workspace from Home', async () => {
    const indexedDB = new IDBFactory()
    const { wrapper, router, persistence } = await mountAt('/', indexedDB)
    await wrapper.get('a[aria-labelledby="new-project-title"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('h1').text()).toBe('New Project')
    await wrapper.get('#project-name').setValue('Workshop cabinet')
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => { expect(wrapper.find('nav[aria-label="Project"]').exists()).toBe(true) })
    const path = router.currentRoute.value.path
    expect(path).toMatch(/^\/projects\/[^/]+\/parts$/)
    expect(wrapper.text()).toContain('Workshop cabinet')
    expect(wrapper.get('h1').text()).toBe('Parts')
    await wrapper.get('nav a').trigger('click')
    await router.push(path.replace(/parts$/, 'materials'))
    await vi.waitFor(() => { expect(wrapper.get('h1').text()).toBe('Materials') })
    await wrapper.get('main a[href="/"]').trigger('click')
    await vi.waitFor(() => { expect(wrapper.find('nav').exists()).toBe(false) })
    await vi.waitFor(() => { expect(wrapper.find(`a[href="${path}"]`).exists()).toBe(true) })
    await wrapper.get(`a[href="${path}"]`).trigger('click')
    await vi.waitFor(() => { expect(wrapper.get('h1').text()).toBe('Parts') })
    wrapper.unmount(); persistence.close()
    const reopened = await mountAt(path, indexedDB)
    await vi.waitFor(() => { expect(reopened.wrapper.get('h1').text()).toBe('Parts') })
    expect(reopened.wrapper.text()).toContain('Workshop cabinet')
  })

  it('never displays another project’s Parts when switching or refreshing workspaces', async () => {
    const { wrapper, router, persistence, service } = await mountAt('/')
    await persistence.materials.create(validMaterialInput)
    const first = cuttingProjectSchema.parse({ id: 'isolation-first', name: 'First', partIds: [], materialIds: [], supplierProductIds: [] })
    const second = cuttingProjectSchema.parse({ ...first, id: 'isolation-second', name: 'Second' })
    await service.projects.create(first)
    await service.projects.create(second)
    await service.parts(first.id).create({ ...validPartInput, name: 'Only first project' })
    await service.parts(second.id).create({ ...validPartInput, id: 'second-part', name: 'Only second project' })
    await router.push('/projects/isolation-first/parts')
    await vi.waitFor(() => { expect(wrapper.find('table').exists()).toBe(true) })
    expect(wrapper.get('table').text()).toContain('Only first project')
    expect(wrapper.get('table').text()).not.toContain('Only second project')
    await router.push('/projects/isolation-second/parts')
    await vi.waitFor(() => { expect(wrapper.find('table').exists()).toBe(true) })
    expect(wrapper.get('table').text()).toContain('Only second project')
    expect(wrapper.get('table').text()).not.toContain('Only first project')
  })

  it('opens Optimization only within a saved project and discards results when switching projects', async () => {
    const indexedDB = new IDBFactory()
    const { wrapper, router, persistence, service, workers, postMessage } = await mountAt('/', indexedDB)
    expect(wrapper.find('a[href$="/optimization"]').exists()).toBe(false)
    await persistence.materials.create(validMaterialInput)
    await persistence.suppliers.create(validSupplierInput)
    await persistence.supplierProducts.create(validSupplierProductInput)
    const first = cuttingProjectSchema.parse({ id: 'cutting-first', name: 'First cutting project', partIds: [], materialIds: [], supplierProductIds: [validSupplierProductInput.id] })
    const second = cuttingProjectSchema.parse({ ...first, id: 'cutting-second', name: 'Second cutting project', supplierProductIds: [] })
    await service.projects.create(first); await service.projects.create(second)
    await service.parts(first.id).create(validPartInput)
    await router.push('/projects/cutting-first/parts')
    await vi.waitFor(() => { expect(wrapper.find('nav a[href$="/optimization"]').exists()).toBe(true) })
    await wrapper.get('nav a[href$="/optimization"]').trigger('click')
    await vi.waitFor(() => { expect(wrapper.find('[data-panel-id]').exists()).toBe(true) })
    await vi.waitFor(() => { expect(wrapper.text()).not.toContain('Loading project inputs') })
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => { expect(postMessage).toHaveBeenCalledOnce() })
    const worker = workers[0]
    const request = postMessage.mock.calls[0]?.[0]
    if (worker === undefined || request === undefined) throw new Error('Expected running worker')
    const lateReply = worker.onmessage
    const terminated = vi.spyOn(worker, 'terminate')
    await router.push('/projects/cutting-second/optimization')
    await vi.waitFor(() => { expect(wrapper.text()).toContain('No parts in this project') })
    expect(terminated).toHaveBeenCalledOnce()
    lateReply?.(new MessageEvent('message', { data: handleOptimizationRequest(request) }))
    await flushPromises()
    expect(wrapper.text()).not.toContain('Validated project cutting plan')
    expect(wrapper.text()).not.toContain('First cutting project')
    wrapper.unmount(); persistence.close()
    const reopened = await mountAt('/projects/cutting-first/optimization', indexedDB)
    await vi.waitFor(() => { expect(reopened.wrapper.text()).toContain('2 requested copies') })
    expect(reopened.wrapper.text()).toContain('First cutting project')
    await reopened.wrapper.get('main a[href="/"]').trigger('click')
    await vi.waitFor(() => { expect(reopened.wrapper.find('nav').exists()).toBe(false) })
  })

  it('shows missing projects without mounting global Parts or Materials', async () => {
    const { wrapper } = await mountAt('/projects/missing/parts')
    await vi.waitFor(() => { expect(wrapper.find('[role="alert"]').exists()).toBe(true) })
    expect(wrapper.get('h1').text()).toBe('Could not open project')
    expect(wrapper.find('nav').exists()).toBe(false)
    expect(wrapper.find('#part-name').exists()).toBe(false)
  })

  it('preserves existing records across navigation and database reopening', async () => {
    const indexedDB = new IDBFactory()
    const { wrapper, router, persistence, service } = await mountAt('/', indexedDB)
    expect((await persistence.materials.create(validMaterialInput)).ok).toBe(true)
    expect((await persistence.parts.create(validPartInput)).ok).toBe(true)
    expect((await persistence.suppliers.create(validSupplierInput)).ok).toBe(true)
    expect((await persistence.supplierProducts.create(validSupplierProductInput)).ok).toBe(true)

    const project = cuttingProjectSchema.parse({ id: 'retained-project', name: 'Retained project', partIds: [], materialIds: [], supplierProductIds: [] })
    expect((await service.projects.create(project)).ok).toBe(true)
    const legacy = await service.listLegacyParts()
    if (!legacy.ok || !legacy.value[0]) throw new Error('Missing legacy part')
    expect((await service.adoptLegacyParts(project.id, [legacy.value[0].id])).ok).toBe(true)
    await router.push('/projects/retained-project/parts')
    await flushPromises()
    await vi.waitFor(() => { expect(wrapper.get('table').text()).toContain(validPartInput.name) })
    await router.push('/projects/retained-project/materials')
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

    const reopened = await mountAt('/projects/retained-project/parts', indexedDB)
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

describe('saved plan refresh and navigation', () => {
  it('reopens a historical plan after application remount and guards unsaved edits when leaving its project', async () => {
    const indexedDB = new IDBFactory()
    const initial = await mountAt('/', indexedDB)
    const project = cuttingProjectSchema.parse({ id: 'saved-workspace', name: 'Saved workspace', partIds: [], materialIds: [], supplierProductIds: [] })
    await initial.service.projects.create(project)
    const part = partSchema.parse(validPartInput)
    const product = supplierProductSchema.parse(validSupplierProductInput)
    const settings = { kerfMm: 3, edgeMarginMm: 0 }
    const optimized = optimizeProject({ parts: [part], panels: [{ product, quantity: 1 }], settings })
    if (!optimized.ok) throw new Error('Fixture')
    const { id, name, materialId, lengthMm, widthMm, thicknessMm, grainDirection } = product
    const saved = await createSavedPlanService(initial.persistence).forProject(project.id).save({ id: 'historical-plan', projectId: project.id, name: 'Historical cuts', createdAt: '2026-10-11T12:00:00.000Z' }, { plan: optimized.plan, parts: [part], settings, sources: [{ product: panelSnapshotSchema.parse({ id, name, materialId, lengthMm, widthMm, thicknessMm, grainDirection }), quantity: 1, materialName: validMaterialInput.name, supplierName: validSupplierInput.name }], editedPanelIndices: [] })
    expect(saved.ok).toBe(true)
    initial.wrapper.unmount(); initial.persistence.close()
    const { wrapper, router, persistence } = await mountAt('/projects/saved-workspace/optimization', indexedDB)
    await vi.waitFor(() => { expect(wrapper.find('[aria-label="Open plan Historical cuts"]').exists()).toBe(true); expect(wrapper.get('[aria-label="Open plan Historical cuts"]').attributes('disabled')).toBeUndefined() })
    expect(wrapper.text()).toContain('No parts in this project')
    await wrapper.get('[aria-label="Open plan Historical cuts"]').trigger('click')
    await vi.waitFor(() => { expect(wrapper.find('#cutting-viewer-part').exists()).toBe(true) })
    expect(wrapper.text()).toContain('Saved plan: Historical cuts')
    expect(wrapper.get('tbody').text()).toContain('Side panel')
    const control = (text: string) => {
      const button = wrapper.findAll('button').find(button => button.text() === text)
      if (!button) throw new Error(`Missing ${text}`)
      return button
    }
    await wrapper.get('#cutting-viewer-part').setValue(wrapper.get('#cutting-viewer-part option:nth-child(2)').attributes('value'))
    await control('Enter Edit Mode').trigger('click')
    await wrapper.get('#cutting-viewer-swap').setValue(wrapper.get('#cutting-viewer-swap option:nth-child(2)').attributes('value'))
    await control('Swap selected copies').trigger('click')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await router.push('/')
    expect(router.currentRoute.value.fullPath).toBe('/projects/saved-workspace/optimization')
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Discard unsaved manual'))
    confirm.mockReturnValue(true)
    await router.push('/')
    expect(router.currentRoute.value.fullPath).toBe('/')
    const stored = await createSavedPlanService(persistence).forProject(project.id).list()
    expect(stored.ok && stored.value.length).toBe(1)
  })
})

it('confirms only explicitly reviewed saved cutting layouts and retains confirmation status after remount', async () => {
  const indexedDB = new IDBFactory()
  const initial = await mountAt('/', indexedDB)
  const project = cuttingProjectSchema.parse({ id: 'physical-cut', name: 'Physical cutting', partIds: [], materialIds: [], supplierProductIds: [] })
  await initial.service.projects.create(project)
  const product = supplierProductSchema.parse(validSupplierProductInput)
  const part = partSchema.parse({ ...validPartInput, quantity: 1 })
  const stock = stockItemSchema.parse({ ...validStockItemInput, lengthMm: product.lengthMm, widthMm: product.widthMm, thicknessMm: product.thicknessMm, materialId: product.materialId, grainDirection: product.grainDirection, quantity: 1 })
  await initial.persistence.stockItems.create(stock)
  const settings = { kerfMm: 3, edgeMarginMm: 0 }
  const optimized = optimizeProject({ parts: [part], panels: [{ product, quantity: 1 }], settings })
  if (!optimized.ok) throw new Error('Fixture')
  const { id, name, materialId, lengthMm, widthMm, thicknessMm, grainDirection } = product
  const saved = await createSavedPlanService(initial.persistence).forProject(project.id).save({ id: 'physical-layout', projectId: project.id, name: 'Physical layout', createdAt: '2026-10-11T12:00:00.000Z' }, { plan: optimized.plan, parts: [part], settings, sources: [{ product: panelSnapshotSchema.parse({ id, name, materialId, lengthMm, widthMm, thicknessMm, grainDirection }), quantity: 1, materialName: 'Birch', supplierName: 'Supplier' }], editedPanelIndices: [] })
  expect(saved.ok).toBe(true)
  await initial.router.push('/projects/physical-cut/optimization')
  const wrapper = initial.wrapper
  await vi.waitFor(() => { expect(wrapper.find('[aria-label="Confirm cutting Physical layout"]').exists()).toBe(true); expect(wrapper.get('[aria-label="Confirm cutting Physical layout"]').attributes('disabled')).toBeUndefined() })
  await wrapper.get('[aria-label="Confirm cutting Physical layout"]').trigger('click')
  await vi.waitFor(() => { expect(wrapper.find('#cutting-stock-0').exists()).toBe(true) })
  expect(await initial.persistence.stockItems.get(stock.id)).toEqual({ ok: true, value: stock })
  await wrapper.get('#cutting-stock-0').setValue(stock.id)
  const control = (name: string) => {
    const found = wrapper.findAll('button').reverse().find(button => button.text() === name)
    if (!found) throw new Error(`Missing ${name}`)
    return found
  }
  await control('Review inventory changes').trigger('click')
  expect(wrapper.text()).toContain('No offcuts will be added.')
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  await control('Confirm Cutting').trigger('click')
  await vi.waitFor(() => { expect(wrapper.text()).toContain('Cutting confirmed · Inventory movements recorded') })
  expect(await initial.persistence.stockItems.list()).toEqual({ ok: true, value: [] })
  initial.wrapper.unmount(); initial.persistence.close()
  const remount = await mountAt('/projects/physical-cut/optimization', indexedDB)
  await vi.waitFor(() => { expect(remount.wrapper.text()).toContain('Cutting confirmed · Inventory movements recorded') })
  expect(remount.wrapper.get('[aria-label="Confirm cutting Physical layout"]').attributes('disabled')).toBeDefined()
  const movements = await createCuttingConfirmationService(remount.persistence).forProject(project.id).list()
  expect(movements.ok && movements.value).toHaveLength(1)
})
