import { createCurrentResultService } from '../../application/plans/current-result-service'
import { currentResultServiceKey } from '../../features/optimization/current-result-service'
import { createProjectTransferService } from '../../application/projects/project-transfer-service'
import { projectJson } from '../../infrastructure/projects/project-json'
import { projectTransferServiceKey } from '../../features/projects/project-transfer-service'
import { optimizeProject } from '../../domain/optimizer/optimize-project'
import { panelSnapshotSchema } from '../../domain/model/saved-cutting-plan'
import { partSchema } from '../../domain/model/part'
import { supplierProductSchema } from '../../domain/model/supplier-product'
import { createSavedPlanService } from '../../application/plans/saved-plan-service'
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
import ProjectCreationDialog from '../../features/projects/ProjectCreationDialog.vue'
import { projectServiceKey } from '../../features/projects/project-service'
import { createProjectService } from '../../application/projects/project-service'
import { cuttingProjectSchema } from '../../domain/model/cutting-project'
import { createLocalPersistence } from '../../infrastructure/persistence/local-database'
import { catalogStockRepositoryKey, supplierRepositoryKey, supplierProductRepositoryKey } from '../../features/suppliers/catalog-repositories'
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
        [currentResultServiceKey]: createCurrentResultService(persistence),
        [projectTransferServiceKey]: createProjectTransferService(persistence, projectJson),
        [cuttingConfirmationServiceKey]: createCuttingConfirmationService(persistence),
        [materialRepositoryKey]: catalog.materials,
        [projectServiceKey]: service,
        [catalogStockRepositoryKey]: persistence.stockItems,
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
  it('protects pending Materials choices across tabs and project changes without changing navigation', async () => {
    const { wrapper, router, persistence, service } = await mountAt('/')
    await persistence.materials.create(validMaterialInput)
    await persistence.suppliers.create(validSupplierInput)
    await persistence.supplierProducts.create(validSupplierProductInput)
    const first = cuttingProjectSchema.parse({ id: 'draft-project', name: 'First', materialIds: [], supplierProductIds: [], partIds: [] })
    const second = cuttingProjectSchema.parse({ ...first, id: 'other-draft-project', name: 'Second' })
    await service.projects.create(first)
    await service.projects.create(second)
    await router.push(`/projects/${first.id}/materials`)
    await vi.waitFor(() => { expect(wrapper.find(`input[aria-label="Use ${validMaterialInput.name}"]`).exists()).toBe(true) })
    vi.spyOn(service.projects, 'update').mockResolvedValue({ ok: false, error: { kind: 'storageFailure', message: 'Disk full' } })
    await wrapper.get(`input[aria-label="Use ${validMaterialInput.name}"]`).setValue(true)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await router.push(`/projects/${first.id}/parts`)
    expect(router.currentRoute.value.path).toBe(`/projects/${first.id}/materials`)
    await router.push(`/projects/${second.id}/materials`)
    expect(router.currentRoute.value.path).toBe(`/projects/${first.id}/materials`)
    expect(wrapper.get<HTMLInputElement>(`input[aria-label="Use ${validMaterialInput.name}"]`).element.checked).toBe(true)
    expect(await service.projects.get(first.id)).toEqual({ ok: true, value: first })
    confirm.mockReturnValue(true)
    await router.push(`/projects/${second.id}/materials`)
    await vi.waitFor(() => { expect(wrapper.get<HTMLInputElement>(`input[aria-label="Use ${validMaterialInput.name}"]`).element.checked).toBe(false) })
    expect(wrapper.text()).not.toContain('Unsaved changes')
    await router.push(`/projects/${second.id}/parts`)
    await flushPromises()
    await vi.waitFor(() => { expect(wrapper.text()).toContain('Select materials to get started') })
  })

  it('waits for Materials autosave before opening Parts and restores choices when reopened', async () => {
    const { wrapper, router, persistence, service } = await mountAt('/')
    await persistence.materials.create(validMaterialInput)
    await persistence.suppliers.create(validSupplierInput)
    await persistence.supplierProducts.create(validSupplierProductInput)
    const project = cuttingProjectSchema.parse({ id: 'autosave-project', name: 'Auto', materialIds: [], supplierProductIds: [], partIds: [] })
    await service.projects.create(project)
    await router.push(`/projects/${project.id}/materials`)
    await vi.waitFor(() => { expect(wrapper.find(`input[aria-label="Use ${validMaterialInput.name}"]`).exists()).toBe(true) })
    const update = service.projects.update.bind(service.projects)
    let release: (() => void) | undefined
    vi.spyOn(service.projects, 'update').mockImplementationOnce(async (id, record) => {
      await new Promise<void>(resolve => { release = resolve })
      return update(id, record)
    })
    const confirm = vi.spyOn(window, 'confirm')
    await wrapper.get(`input[aria-label="Use ${validMaterialInput.name}"]`).setValue(true)
    await vi.waitFor(() => { expect(release).toBeDefined() })
    const navigation = router.push(`/projects/${project.id}/parts`)
    await flushPromises()
    expect(router.currentRoute.value.path).toBe(`/projects/${project.id}/materials`)
    expect(wrapper.text()).toContain('Saving…')
    release?.()
    await navigation
    expect(router.currentRoute.value.path).toBe(`/projects/${project.id}/parts`)
    expect(confirm).not.toHaveBeenCalled()
    expect((await service.projects.get(project.id))).toMatchObject({ ok: true, value: { materialIds: [validMaterialInput.id] } })
    await router.push(`/projects/${project.id}/materials`)
    await vi.waitFor(() => { expect(wrapper.get<HTMLInputElement>(`input[aria-label="Use ${validMaterialInput.name}"]`).element.checked).toBe(true) })
    expect(wrapper.text()).not.toContain('Save project selections')
    expect(wrapper.text()).not.toContain('Selections up to date')
  })

  it('keeps the three-tile layout and woodworking imagery', async () => {
    const { wrapper } = await mountAt('/')
    expect(wrapper.get('header').text()).toContain('OptiCutList')
    expect(wrapper.get('h1').text()).toBe('Your next build starts here.')
    expect(wrapper.findAll('.home-card h2').map(heading => heading.text())).toEqual(['New Project', 'Import Project', 'Catalogue'])
    expect(wrapper.get('[aria-labelledby="catalog-title"]').classes()).toContain('md:row-span-2')
    expect(wrapper.get('[aria-labelledby="import-project-title"]').classes()).toContain('md:row-start-2')
    expect(wrapper.get('[aria-labelledby="catalog-title"] svg').attributes('aria-hidden')).toBe('true')
  })

  it('keeps branding and theme selection accessible in the persistent application sidebar', async () => {
    const { wrapper } = await mountAt('/')
    expect(wrapper.find('header nav').exists()).toBe(false)
    expect(wrapper.findAll('header a')).toHaveLength(1)
    expect(wrapper.get('header a').attributes('aria-label')).toBe('OptiCutList home')
    expect(wrapper.find('#theme-preference').exists()).toBe(true)
    expect(wrapper.find('aside[aria-label="Application navigation"]').exists()).toBe(true)
    expect(wrapper.findAll('nav[aria-label="Main navigation"] a').map(link => link.text())).toEqual(['Home', 'Projects', 'Catalog', 'Stock'])
  })

  it('navigates the sidebar with active states and collapses the small-screen menu after navigation or Escape', async () => {
    const { wrapper, router } = await mountAt('/')
    const nav = wrapper.get('nav[aria-label="Main navigation"]')
    expect(nav.get('a[href="/"]').attributes('aria-current')).toBe('page')
    const toggle = wrapper.get('button[aria-controls="app-sidebar-content"]')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await toggle.trigger('click'); expect(toggle.attributes('aria-expanded')).toBe('true')
    await nav.get('a[href="/projects"]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.path).toBe('/projects'); expect(nav.get('a[href="/projects"]').attributes('aria-current')).toBe('page')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await toggle.trigger('click'); await wrapper.get('aside[aria-label="Application navigation"]').trigger('keydown', { key: 'Escape' })
    expect(toggle.attributes('aria-expanded')).toBe('false'); expect(document.activeElement).toBe(toggle.element)
    await nav.get('a[href="/stock"]').trigger('click'); await flushPromises()
    expect(wrapper.get('h1').text()).toBe('Stock'); expect(nav.get('a[href="/stock"]').attributes('aria-current')).toBe('page')
    await vi.waitFor(() => { expect(wrapper.text()).toContain('No physical stock items yet') })
    await router.push('/suppliers'); await flushPromises(); expect(nav.get('a[href="/catalog"]').attributes('aria-current')).toBe('page')
  })

  it('opens persisted physical stock through sidebar navigation without changing its records', async () => {
    const { wrapper, persistence } = await mountAt('/')
    await persistence.materials.create(validMaterialInput); await persistence.stockItems.create(validStockItemInput)
    const before = await persistence.stockItems.list()
    await wrapper.get('nav[aria-label="Main navigation"] a[href="/stock"]').trigger('click')
    await vi.waitFor(() => { expect(wrapper.find('table').exists()).toBe(true) })
    expect(wrapper.text()).toContain(validMaterialInput.name)
    expect(wrapper.get('table').text()).toContain('800 × 400.5')
    expect(wrapper.get('tbody tr').findAll('td')[1]?.text()).toBe('18')
    expect(await persistence.stockItems.list()).toEqual(before)
  })

  it('opens import through the keyboard-accessible full-surface Home tile', async () => {
    const { wrapper, router } = await mountAt('/')
    const tile = wrapper.get<HTMLAnchorElement>('a[aria-labelledby="import-project-title"]')
    expect(tile.attributes('href')).toBe('/import')
    expect(tile.attributes('aria-disabled')).toBeUndefined()
    expect(tile.find('button, input').exists()).toBe(false)
    tile.element.focus()
    expect(document.activeElement).toBe(tile.element)
    tile.element.dispatchEvent(new MouseEvent('click', { detail: 0, bubbles: true, cancelable: true }))
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/import')
    expect(wrapper.get('h1').text()).toBe('Import Project')
    expect(wrapper.find('#project-import-file').exists()).toBe(true)
  })

  it('opens Catalogue when any part of its tile is clicked', async () => {
    const { wrapper, router } = await mountAt('/')
    const tile = wrapper.get('a[aria-labelledby="catalog-title"]')
    expect(tile.attributes('href')).toBe('/catalog')
    expect(tile.find('a, button, input, select').exists()).toBe(false)
    await tile.get('svg').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/catalog')
    expect(wrapper.get('h1').text()).toBe('Catalog')
    await vi.waitFor(() => { expect(wrapper.text()).toContain('Add Supplier') })
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
    expect(wrapper.findAll('.home-card').filter(tile => tile.element.tagName === 'A').map(link => link.attributes('href'))).toEqual(['/?create=1', '/import', '/catalog'])
    expect(wrapper.text()).not.toContain('Access saved parts and materials')
    const catalogue = wrapper.get('[aria-labelledby="catalog-title"]')
    expect(catalogue.findAll('span')).toHaveLength(0)
    expect(catalogue.findAll('p')).toHaveLength(1)
    expect(catalogue.text()).not.toContain('Open catalog')
  })

  it.each(['/catalog', '/suppliers'])('returns Home through the sidebar from %s without a project', async (path) => {
    const { wrapper, router } = await mountAt(path)
    expect(wrapper.get('h1').text()).toBe('Catalog')
    expect(router.currentRoute.value.name).toBe('suppliers')
    expect(wrapper.get('main').classes()).toContain('max-w-none')
    const back = wrapper.get('nav[aria-label="Main navigation"] a[href="/"]')
    expect(back.text()).toBe('Home')
    await back.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    expect(wrapper.get('h1').text()).toBe('Your next build starts here.')
    expect(wrapper.get('main').classes()).toContain('max-w-7xl')
  })

  it('requires a project for old Parts and Materials routes', async () => {
    const { wrapper, router } = await mountAt('/parts')
    expect(router.currentRoute.value.path).toBe('/projects')
    expect(wrapper.get('h1').text()).toBe('Projects')
    expect(wrapper.find('nav[aria-label="Project"]').exists()).toBe(false)
    await router.push('/materials')
    expect(router.currentRoute.value.path).toBe('/projects')
  })

  it.each(['/', '/projects'])('opens the same creation dialog from %s and cancels without writing or changing context', async path => {
    const { wrapper, router, persistence } = await mountAt(path)
    const tile = path === '/' ? 'a[aria-labelledby="new-project-title"]' : 'button[aria-labelledby="new-project-title"]'
    await vi.waitFor(() => { expect(wrapper.find(tile).exists()).toBe(true) })
    await wrapper.get(tile).trigger('click')
    await vi.waitFor(() => { expect(wrapper.findComponent(ProjectCreationDialog).exists()).toBe(true) })
    expect(wrapper.findAllComponents(ProjectCreationDialog)).toHaveLength(1)
    expect(document.activeElement).toBe(wrapper.get('#project-name').element)
    await wrapper.get('#project-name').setValue('Draft only')
    await wrapper.get('button[aria-label="Close form"]').trigger('click')
    await vi.waitFor(() => { expect(wrapper.find('dialog').exists()).toBe(false) })
    expect(router.currentRoute.value.fullPath).toBe(path)
    expect(await persistence.projects.list()).toEqual({ ok: true, value: [] })
    await wrapper.get(tile).trigger('click')
    await vi.waitFor(() => { expect(wrapper.find('#project-name').exists()).toBe(true) })
    expect(wrapper.get<HTMLInputElement>('#project-name').element.value).toBe('')
    await wrapper.get('dialog').trigger('cancel')
    await vi.waitFor(() => { expect(wrapper.find('dialog').exists()).toBe(false) })
    expect(await persistence.projects.list()).toEqual({ ok: true, value: [] })
  })

  it('opens the workspace automatically when creation starts in Projects', async () => {
    const { wrapper, router, persistence } = await mountAt('/projects')
    await vi.waitFor(() => { expect(wrapper.find('button[aria-labelledby="new-project-title"]').exists()).toBe(true) })
    await wrapper.get('button[aria-labelledby="new-project-title"]').trigger('click')
    await wrapper.get('#project-name').setValue('Desk')
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => { expect(wrapper.find('nav[aria-label="Project"]').exists()).toBe(true) })
    const records = await persistence.projects.list()
    if (!records.ok || !records.value[0]) throw new Error('Missing created project')
    expect(router.currentRoute.value.path).toBe(`/projects/${records.value[0].id}/materials`)
    expect(records.value[0].name).toBe('Desk')
    expect(wrapper.find('dialog').exists()).toBe(false)
  })

  it('restores direct creation URLs safely and removes only the creation flag on close', async () => {
    const indexedDB = new IDBFactory()
    const first = await mountAt('/?create=1&keep=context#anchor', indexedDB)
    expect(first.wrapper.findComponent(ProjectCreationDialog).exists()).toBe(true)
    await first.wrapper.get('#project-name').setValue('Unsaved')
    first.wrapper.unmount(); first.persistence.close()
    const reopened = await mountAt('/?create=1&keep=context#anchor', indexedDB)
    expect(reopened.wrapper.get<HTMLInputElement>('#project-name').element.value).toBe('')
    expect(await reopened.persistence.projects.list()).toEqual({ ok: true, value: [] })
    await reopened.wrapper.get('button[aria-label="Close form"]').trigger('click')
    await vi.waitFor(() => { expect(reopened.wrapper.find('dialog').exists()).toBe(false) })
    expect(reopened.router.currentRoute.value.fullPath).toBe('/?keep=context#anchor')
    await reopened.router.push('/?create=unsupported')
    expect(reopened.wrapper.find('dialog').exists()).toBe(false)
  })

  it('clears creation on navigation and keeps sidebar Projects free of automatic modals', async () => {
    const { wrapper, router } = await mountAt('/?create=1')
    await wrapper.get('#project-name').setValue('Old draft')
    await router.push('/projects')
    await vi.waitFor(() => { expect(wrapper.get('h1').text()).toBe('Projects') })
    expect(wrapper.find('dialog').exists()).toBe(false)
    await router.push('/')
    expect(wrapper.find('dialog').exists()).toBe(false)
    await wrapper.get('nav[aria-label="Main navigation"] a[href="/projects"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/projects')
    expect(wrapper.find('dialog').exists()).toBe(false)
  })

  it.each(['/', '/projects'])('starts the same import workflow from %s and returns to its origin', async path => {
    const { wrapper, router } = await mountAt(path)
    await vi.waitFor(() => { expect(wrapper.find('a[aria-labelledby="import-project-title"]').exists()).toBe(true) })
    await wrapper.get('a[aria-labelledby="import-project-title"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/import')
    expect(wrapper.get('#project-import-file').attributes('accept')).toBe('.pocl,.json,application/json')
    const back = wrapper.get(`main a[href="${path}"]`)
    await back.trigger('click'); await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe(path)
    expect(wrapper.find('dialog').exists()).toBe(false)
  })

  it('creates, opens and refreshes an isolated project workspace from Home', async () => {
    const indexedDB = new IDBFactory()
    const { wrapper, router, persistence } = await mountAt('/', indexedDB)
    await wrapper.get('a[aria-labelledby="new-project-title"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('h1').text()).toBe('Your next build starts here.')
    await vi.waitFor(() => { expect(wrapper.find('#project-name').exists()).toBe(true) })
    await wrapper.get('#project-name').setValue('Workshop cabinet')
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => { expect(wrapper.find('nav[aria-label="Project"]').exists()).toBe(true) })
    const path = router.currentRoute.value.path
    expect(path).toMatch(/^\/projects\/[^/]+\/materials$/)
    expect(wrapper.text()).toContain('Workshop cabinet')
    expect(wrapper.get('h1').text()).toBe('Materials')
    await wrapper.get('nav[aria-label="Project"] a').trigger('click')
    await router.push(path)
    await vi.waitFor(() => { expect(wrapper.get('h1').text()).toBe('Materials') })
    await wrapper.get('main a[href="/"]').trigger('click')
    await vi.waitFor(() => { expect(wrapper.find('nav[aria-label="Project"]').exists()).toBe(false) })
    expect(wrapper.text()).not.toContain('Your projects')
    await router.push('/projects')
    await vi.waitFor(() => { expect(wrapper.find(`a[href="${path}"]`).exists()).toBe(true) })
    await wrapper.get(`a[href="${path}"]`).trigger('click')
    await vi.waitFor(() => { expect(wrapper.get('h1').text()).toBe('Materials') })
    wrapper.unmount(); persistence.close()
    const reopened = await mountAt(path, indexedDB)
    await vi.waitFor(() => { expect(reopened.wrapper.get('h1').text()).toBe('Materials') })
    expect(reopened.wrapper.text()).toContain('Workshop cabinet')
  })

  it('opens unspecified project tabs on Materials while preserving explicit routes and tab order', async () => {
    const indexedDB = new IDBFactory()
    const { wrapper, router, service, persistence } = await mountAt('/', indexedDB)
    const project = cuttingProjectSchema.parse({ id: 'default-tabs', name: 'Default tabs', partIds: [], materialIds: [], supplierProductIds: [] })
    expect((await service.projects.create(project)).ok).toBe(true)
    await router.push('/projects/default-tabs')
    await vi.waitFor(() => { expect(wrapper.get('h1').text()).toBe('Materials') })
    expect(router.currentRoute.value.path).toBe('/projects/default-tabs/materials')
    expect(wrapper.findAll('nav[aria-label="Project"] a').map(link => link.text())).toEqual(['Materials', 'Parts', 'Optimization'])
    await router.push('/projects/default-tabs/parts')
    await vi.waitFor(() => { expect(wrapper.get('h1').text()).toBe('Parts') })
    await router.push('/projects/default-tabs/optimization')
    await vi.waitFor(() => { expect(wrapper.get('h1').text()).toBe('Optimization') })
    expect(router.currentRoute.value.path).toBe('/projects/default-tabs/optimization')
    wrapper.unmount(); persistence.close()
    const reopened = await mountAt('/projects/default-tabs', indexedDB)
    await vi.waitFor(() => { expect(reopened.wrapper.get('h1').text()).toBe('Materials') })
    expect(reopened.router.currentRoute.value.path).toBe('/projects/default-tabs/materials')
  })

  it('requires project material selection from a direct Parts route and preserves Parts after deselection', async () => {
    const { wrapper, router, service, persistence } = await mountAt('/')
    expect((await persistence.materials.create(validMaterialInput)).ok).toBe(true)
    await persistence.suppliers.create(validSupplierInput)
    await persistence.supplierProducts.create(validSupplierProductInput)
    const project = cuttingProjectSchema.parse({ id: 'material-first', name: 'Material first', partIds: [], materialIds: [], supplierProductIds: [] })
    expect((await service.projects.create(project)).ok).toBe(true)
    await router.push('/projects/material-first/parts')
    await vi.waitFor(() => { expect(wrapper.text()).toContain('Select materials to get started') })
    const newPart = () => wrapper.findAll('button').find(button => button.text() === 'New part')
    expect(newPart()?.attributes('disabled')).toBeDefined()
    expect(wrapper.find('form').exists()).toBe(false)
    expect(await service.parts(project.id).create(validPartInput)).toMatchObject({ ok: false, error: { kind: 'referenceConflict' } })
    await wrapper.get('a[href="/projects/material-first/materials"]').trigger('click')
    await vi.waitFor(() => { expect(wrapper.find('input[type="checkbox"]').exists()).toBe(true) })
    await wrapper.get(`input[aria-label="Use ${validMaterialInput.name}"]`).setValue(true)
    await router.push('/projects/material-first/parts')
    await vi.waitFor(() => { expect(newPart()?.attributes('disabled')).toBeUndefined() })
    const action = newPart()
    if (!action) throw new Error('Missing New part')
    await action.trigger('click')
    await wrapper.get('#part-name').setValue('Selected material part')
    await wrapper.get('#part-material').trigger('click')
    await wrapper.get(`[role="option"][data-value="${validMaterialInput.id}"]`).trigger('click')
    await wrapper.get('#part-length').setValue('720')
    await wrapper.get('#part-width').setValue('560')
    await wrapper.get('#part-thickness').setValue('18')
    await wrapper.get('#part-quantity').setValue('2')
    await wrapper.get('dialog form').trigger('submit')
    await vi.waitFor(() => { expect(wrapper.text()).toContain('Part created.') })
    const before = await service.parts(project.id).list()
    const owner = await service.projects.get(project.id)
    if (!owner.ok) throw new Error('Missing project')
    expect((await service.projects.update(project.id, { ...owner.value, materialIds: [] })).ok).toBe(true)
    const refresh = wrapper.findAll('button').find(button => button.text() === 'Refresh')
    if (!refresh) throw new Error('Missing refresh')
    await refresh.trigger('click')
    await vi.waitFor(() => { expect(wrapper.text()).toContain('Not selected for this project') })
    expect(wrapper.get('table').text()).toContain('Selected material part')
    expect(newPart()?.attributes('disabled')).toBeDefined()
    expect(await service.parts(project.id).list()).toEqual(before)
    expect(await persistence.materials.list()).toEqual({ ok: true, value: [validMaterialInput] })
  })

  it('never displays another project’s Parts when switching or refreshing workspaces', async () => {
    const { wrapper, router, persistence, service } = await mountAt('/')
    await persistence.materials.create(validMaterialInput)
    const first = cuttingProjectSchema.parse({ id: 'isolation-first', name: 'First', partIds: [], materialIds: [validMaterialInput.id], supplierProductIds: [] })
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
    await vi.waitFor(() => { expect(reopened.wrapper.find('nav[aria-label="Project"]').exists()).toBe(false) })
  })

  it('shows missing projects without mounting global Parts or Materials', async () => {
    const { wrapper } = await mountAt('/projects/missing/parts')
    await vi.waitFor(() => { expect(wrapper.find('[role="alert"]').exists()).toBe(true) })
    expect(wrapper.get('h1').text()).toBe('Could not open project')
    expect(wrapper.find('nav[aria-label="Project"]').exists()).toBe(false)
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
    await vi.waitFor(() => { expect(wrapper.text()).toContain(validMaterialInput.name) })
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

  it('renames persisted projects without changing catalog, parts, stock or historical cutting plans', async () => {
    const indexedDB = new IDBFactory()
    const initial = await mountAt('/', indexedDB)
    const { wrapper, router, persistence, service } = initial
    await persistence.materials.create(validMaterialInput)
    await persistence.suppliers.create(validSupplierInput)
    await persistence.supplierProducts.create(validSupplierProductInput)
    await persistence.stockItems.create(validStockItemInput)
    const project = cuttingProjectSchema.parse({ id: 'managed-project', name: 'Cabinet', partIds: [], materialIds: [validMaterialInput.id], supplierProductIds: [validSupplierProductInput.id], panelQuantities: [{ supplierProductId: validSupplierProductInput.id, quantity: 2 }] })
    await service.projects.create(project)
    const part = partSchema.parse(validPartInput)
    await service.parts(project.id).create(part)
    const product = supplierProductSchema.parse(validSupplierProductInput)
    const settings = { kerfMm: 3, edgeMarginMm: 0 }
    const optimized = optimizeProject({ parts: [part], panels: [{ product, quantity: 2 }], settings })
    if (!optimized.ok) throw new Error('Fixture')
    const { id, name, materialId, lengthMm, widthMm, thicknessMm, grainDirection } = product
    const saved = await createSavedPlanService(persistence).forProject(project.id).save({ id: 'managed-cuts', projectId: project.id, name: 'Cuts', createdAt: '2026-10-11T12:00:00.000Z' }, { plan: optimized.plan, parts: [part], settings, sources: [{ product: panelSnapshotSchema.parse({ id, name, materialId, lengthMm, widthMm, thicknessMm, grainDirection }), quantity: 2, materialName: validMaterialInput.name, supplierName: validSupplierInput.name }], editedPanelIndices: [] })
    if (!saved.ok) throw new Error('Fixture save failed')
    const before = await service.projects.get(project.id)
    const capture = () => Promise.all([persistence.parts.list(), persistence.materials.list(), persistence.suppliers.list(), persistence.supplierProducts.list(), persistence.stockItems.list(), persistence.savedPlanSummaries.listForProject(project.id), persistence.savedPlanContents.get(saved.value.summary.id), persistence.cuttingConfirmations.list()])
    const records = await capture()
    expect(wrapper.text()).not.toContain('Your projects')
    await router.push('/projects')
    await vi.waitFor(() => { expect(wrapper.find('[aria-label="Selected project details"]').exists()).toBe(true) })
    const rename = wrapper.findAll('button').find(button => button.text() === 'Rename project')
    if (!rename) throw new Error('Missing rename action')
    await rename.trigger('click'); await wrapper.get('#project-name').setValue('Renamed cabinet'); await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => { expect(wrapper.text()).toContain('Project renamed.') })
    expect(await service.projects.get(project.id)).toEqual(before.ok ? { ok: true, value: { ...before.value, name: 'Renamed cabinet' } } : before)
    expect(await capture()).toEqual(records)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const remove = wrapper.findAll('button').find(button => button.text() === 'Delete project')
    if (!remove) throw new Error('Missing deletion action')
    await remove.trigger('click')
    await vi.waitFor(() => { expect(wrapper.get('[role="alert"]').text()).toContain('Remove the project’s parts') })
    expect(await capture()).toEqual(records)
    wrapper.unmount(); persistence.close()
    const reopened = await mountAt('/projects', indexedDB)
    await vi.waitFor(() => { expect(reopened.wrapper.text()).toContain('Renamed cabinet') })
    expect(reopened.wrapper.get('[aria-label="Project metrics"]').findAll('dd').map(item => item.text())).toEqual(['1', '1', '1'])
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
    await vi.waitFor(() => { expect(wrapper.find('#cutting-viewer-part').exists()).toBe(true) })
    expect(wrapper.text()).toContain('No parts in this project')
    expect(wrapper.text()).not.toContain('Saved plans')
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
  await vi.waitFor(() => { expect(wrapper.find('[data-finalization-action]').exists()).toBe(true) })
  await wrapper.get('[data-finalization-action]').trigger('click')
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
  await remount.wrapper.get('[data-finalization-action]').trigger('click')
  await vi.waitFor(() => { expect(remount.wrapper.text()).toContain('this plan cannot be confirmed again') })
  const movements = await createCuttingConfirmationService(remount.persistence).forProject(project.id).list()
  expect(movements.ok && movements.value).toHaveLength(1)
})

it('imports an exported project from Home with collision preview and opens its remapped Parts and saved plan', async () => {
  const { wrapper, router, persistence, service } = await mountAt('/')
  await persistence.materials.create(validMaterialInput); await persistence.suppliers.create(validSupplierInput); await persistence.supplierProducts.create(validSupplierProductInput)
  await persistence.stockItems.create(validStockItemInput)
  const stock = await persistence.stockItems.list()
  const project = cuttingProjectSchema.parse({ id: 'portable-ui-project', name: 'Portable cabinet', partIds: [], materialIds: [validMaterialInput.id], supplierProductIds: [validSupplierProductInput.id] })
  await service.projects.create(project); await service.parts(project.id).create(validPartInput)
  const part = partSchema.parse(validPartInput); const product = supplierProductSchema.parse(validSupplierProductInput)
  const settings = { kerfMm: 3, edgeMarginMm: 0 }
  const optimized = optimizeProject({ parts: [part], panels: [{ product, quantity: 1 }], settings })
  if (!optimized.ok) throw new Error('Fixture')
  const { id, name, materialId, lengthMm, widthMm, thicknessMm, grainDirection } = product
  const saved = await createSavedPlanService(persistence).forProject(project.id).save({ id: 'portable-ui-plan', projectId: project.id, name: 'Portable cuts', createdAt: '2026-10-11T12:00:00.000Z' }, { plan: optimized.plan, parts: [part], settings, sources: [{ product: panelSnapshotSchema.parse({ id, name, materialId, lengthMm, widthMm, thicknessMm, grainDirection }), quantity: 1, materialName: validMaterialInput.name, supplierName: validSupplierInput.name }], editedPanelIndices: [] })
  expect(saved.ok).toBe(true)
  const exported = await createProjectTransferService(persistence, projectJson).export(project.id)
  if (!exported.ok) throw new Error('Export')
  await wrapper.get('a[aria-labelledby="import-project-title"]').trigger('click'); await flushPromises()
  const file = new File([exported.value.text], 'project.json', { type: 'application/json' })
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(exported.value.text) })
  const input = wrapper.get('#project-import-file')
  Object.defineProperty(input.element, 'files', { value: [file] }); await input.trigger('change')
  await vi.waitFor(() => { expect(wrapper.text()).toContain('Import preview: Portable cabinet') })
  expect(wrapper.text()).toContain('This project ID already exists')
  expect((await persistence.projects.list())).toMatchObject({ ok: true, value: [{ id: project.id }] })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  await wrapper.get('main button').trigger('click')
  await vi.waitFor(() => { expect(wrapper.text()).toContain('imported successfully') })
  const open = wrapper.findAll('a').find(link => link.text() === 'Open imported project')
  if (!open) throw new Error('Open')
  await open.trigger('click')
  await vi.waitFor(() => { expect(wrapper.get('h1').text()).toBe('Materials') })
  const partsLink = wrapper.findAll('nav[aria-label="Project"] a').find(link => link.text() === 'Parts')
  if (!partsLink) throw new Error('Parts')
  await partsLink.trigger('click')
  await vi.waitFor(() => { expect(wrapper.text()).toContain(part.name) })
  // The route carries the new stable identity; the original project is untouched.
  expect(router.currentRoute.value.params.projectId).not.toBe(project.id)
  const optimizeLink = wrapper.findAll('nav a').find(link => link.text() === 'Optimization')
  if (!optimizeLink) throw new Error('Optimization')
  await optimizeLink.trigger('click')
  await vi.waitFor(() => { expect(wrapper.find('#cutting-viewer-part').exists()).toBe(true) })
  expect(wrapper.text()).toContain(part.name)
  expect(await persistence.stockItems.list()).toEqual(stock)
})
