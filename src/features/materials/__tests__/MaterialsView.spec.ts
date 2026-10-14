import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { cuttingProjectSchema } from '../../../domain/model/cutting-project'
import { createProjectService, type ProjectService } from '../../../application/projects/project-service'
import { projectIdKey, projectServiceKey } from '../../projects/project-service'
import { supplierRepositoryKey, supplierProductRepositoryKey } from '../../suppliers/catalog-repositories'
import type { LocalPersistence, PersistenceResult, Repository } from '../../../application/persistence/repositories'
import { validMaterialInput, validSupplierInput, validSupplierProductInput, validStockItemInput } from '../../../domain/model/__tests__/fixtures'
import { supplierProductSchema } from '../../../domain/model/supplier-product'
import { materialSchema, type Material } from '../../../domain/model/material'
import { createLocalPersistence } from '../../../infrastructure/persistence/local-database'
import { createMemoryHistory } from 'vue-router'
import { createAppRouter } from '../../../app/router'
import MaterialsView from '../MaterialsView.vue'
import { stockRepositoryKey } from '../../inventory/stock-repository'
import { createStockRepository } from '../../../application/inventory/stock-repository'
import { stockItemSchema } from '../../../domain/model/stock-item'
import { materialRepositoryKey } from '../material-repository'

const project = cuttingProjectSchema.parse({ id: 'materials-project', name: 'Cabinet', partIds: [], materialIds: [], supplierProductIds: [] })
const material = materialSchema.parse(validMaterialInput)
const updated = materialSchema.parse({ ...material, name: 'Updated birch', category: 'Sheet goods' })
const wrappers: VueWrapper[] = []
const storageFailure = { ok: false, error: { kind: 'storageFailure', message: 'Disk full' } } as const

function fakeRepository() {
  return {
    create: vi.fn<Repository<Material>['create']>().mockResolvedValue({ ok: true, value: material }),
    get: vi.fn<Repository<Material>['get']>().mockResolvedValue({ ok: true, value: material }),
    update: vi.fn<Repository<Material>['update']>().mockResolvedValue({ ok: true, value: updated }),
    delete: vi.fn<Repository<Material>['delete']>().mockResolvedValue({ ok: true, value: undefined }),
    list: vi.fn<Repository<Material>['list']>().mockResolvedValue({ ok: true, value: [] }),
  }
}
function projectRepository() {
  let current = project
  return {
    create: vi.fn<ProjectService['projects']['create']>().mockResolvedValue({ ok: true, value: project }),
    get: vi.fn<ProjectService['projects']['get']>().mockImplementation(() => Promise.resolve({ ok: true, value: current })),
    list: vi.fn<ProjectService['projects']['list']>().mockResolvedValue({ ok: true, value: [project] }),
    delete: vi.fn<ProjectService['projects']['delete']>().mockResolvedValue({ ok: true, value: undefined }),
    update: vi.fn<ProjectService['projects']['update']>().mockImplementation((_id, record) => {
      current = cuttingProjectSchema.parse(record)
      return Promise.resolve({ ok: true, value: current })
    }),
  }
}
function render(repository: Repository<Material>, service?: ProjectService, catalog?: Pick<LocalPersistence, 'suppliers' | 'supplierProducts'> & Partial<LocalPersistence>, id = project.id) {
  const emptyCatalog = {
    create: vi.fn(), get: vi.fn(), update: vi.fn(), delete: vi.fn(),
    list: vi.fn().mockResolvedValue({ ok: true, value: [] }),
  }
  const source: ProjectService = service ?? {
    projects: projectRepository(), parts: () => { throw new Error('Not used') },
    deletionPreview: () => Promise.resolve({ ok: true, value: { restorationIssues: [] } }), deleteProject: () => Promise.resolve({ ok: true, value: undefined }),
    listLegacyParts: () => Promise.resolve({ ok: true, value: [] }),
    adoptLegacyParts: () => Promise.resolve({ ok: true, value: undefined }),
  }
  const wrapper = mount(MaterialsView, {
    attachTo: document.body,
    global: {
      plugins: [createAppRouter(createMemoryHistory())],
      provide: {
        [materialRepositoryKey]: repository, [projectServiceKey]: source, [projectIdKey]: id,
        [supplierRepositoryKey]: catalog?.suppliers ?? { ...emptyCatalog, list: vi.fn().mockResolvedValue({ ok: true, value: [validSupplierInput] }) }, [supplierProductRepositoryKey]: catalog?.supplierProducts ?? { ...emptyCatalog, list: vi.fn().mockResolvedValue({ ok: true, value: [validSupplierProductInput, { ...validSupplierProductInput, id: 'oak-panel', materialId: 'oak' }] }) },
        ...(catalog?.stockItems ? { [stockRepositoryKey]: catalog.stockItems } : {}),
      },
    },
  })
  wrappers.push(wrapper)
  return wrapper
}
function button(wrapper: VueWrapper, text: string) {
  const found = wrapper.findAll('button').find((candidate) => candidate.text() === text)
  if (found === undefined) throw new Error(`Missing button ${text}`)
  return found
}

async function autosaved(wrapper: VueWrapper): Promise<void> {
  await flushPromises()
  await vi.waitFor(() => { expect(wrapper.find('.project-selection > footer').exists()).toBe(false) })
}

afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  wrappers.length = 0
  vi.restoreAllMocks()
})

describe('MaterialsView', () => {
  it('shows loading and then an empty catalog without creation controls', async () => {
    const repository = fakeRepository()
    let resolveList: ((result: PersistenceResult<readonly Material[]>) => void) | undefined
    repository.list.mockReturnValue(new Promise((resolve) => { resolveList = resolve }))
    const wrapper = render(repository)
    expect(wrapper.text()).toContain('Loading materials')
    expect(button(wrapper, 'Refresh').attributes('disabled')).toBeDefined()
    resolveList?.({ ok: true, value: [] })
    await flushPromises()
    expect(wrapper.text()).toContain('No panel sources available')
    expect(wrapper.get('a[href="/suppliers"]').text()).toBe('Open supplier catalog')
    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.findAll('button').some((candidate) => candidate.text() === 'Create material')).toBe(false)
    expect(repository.create).not.toHaveBeenCalled()
  })
  it('selects existing materials without changing catalog records', async () => {
    const repository = fakeRepository()
    repository.list.mockResolvedValue({ ok: true, value: [material] })
    const wrapper = render(repository)
    await flushPromises()
    expect(wrapper.get('[aria-labelledby="library-title"]').text()).toContain(material.category)
    const checkbox = wrapper.get<HTMLInputElement>(`input[aria-label="Use ${material.name}"]`)
    await checkbox.setValue(true)
    expect(wrapper.get('aside').text()).toContain(material.name)
    await checkbox.setValue(false)
    expect(wrapper.get('aside').text()).toContain('Choose materials')
    for (const method of [repository.create, repository.update, repository.delete]) expect(method).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('Edit material')
  })
  it('shows read errors and supports retry without showing an empty catalog', async () => {
    const repository = fakeRepository()
    repository.list.mockResolvedValueOnce(storageFailure).mockResolvedValue({ ok: true, value: [material] })
    const wrapper = render(repository)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not access local storage')
    expect(wrapper.text()).not.toContain('No panel sources available')
    await button(wrapper, 'Try again').trigger('click')
    await flushPromises()
    expect(wrapper.get('[aria-labelledby="library-title"]').text()).toContain(material.name)
  })
  it('reports invalid saved records without silently ignoring them', async () => {
    const repository = fakeRepository()
    repository.list.mockResolvedValue({ ok: false, error: { kind: 'invalidRecord', issues: [{ path: ['name'], message: 'Invalid name' }] } })
    const wrapper = render(repository)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Material data is invalid')
    expect(wrapper.text()).not.toContain('No panel sources available')
  })
  it('persists selections on remount without changing catalog records', async () => {
    const indexedDB = new IDBFactory()
    const first = createLocalPersistence('materials-ui-test', { indexedDB, IDBKeyRange })
    const second = createLocalPersistence('materials-ui-test', { indexedDB, IDBKeyRange })
    try {
      expect((await first.materials.create(material)).ok).toBe(true)
      const service = createProjectService(first)
      expect((await service.projects.create(project)).ok).toBe(true)
      const wrapper = render(first.materials, service)
      await vi.waitFor(() => { expect(wrapper.find('input[aria-label="Use Birch plywood BB/BB"]').exists()).toBe(true) })
      await wrapper.get('input[type="checkbox"]').setValue(true)
      expect(wrapper.get('aside').text()).toContain(material.name)
      await autosaved(wrapper)
      wrapper.unmount()
      first.close()
      const reopened = render(second.materials, createProjectService(second))
      await vi.waitFor(() => { expect(reopened.find('input[aria-label="Use Birch plywood BB/BB"]').exists()).toBe(true) })
      expect(reopened.get<HTMLInputElement>('input[type="checkbox"]').element.checked).toBe(true)
      expect(await second.materials.list()).toEqual({ ok: true, value: [material] })
    } finally { first.close(); second.close() }
  })
  it('selects individual products, persists choices and isolates a second project', async () => {
    const persistence = createLocalPersistence('product-selection-ui', { indexedDB: new IDBFactory(), IDBKeyRange })
    try {
      expect((await persistence.materials.create(material)).ok).toBe(true)
      expect((await persistence.suppliers.create(validSupplierInput)).ok).toBe(true)
      expect((await persistence.supplierProducts.create(validSupplierProductInput)).ok).toBe(true)
      const extra = { ...validSupplierProductInput, id: 'second-panel', name: 'Second panel' }
      expect((await persistence.supplierProducts.create(extra)).ok).toBe(true)
      const unavailable = { ...extra, id: 'unavailable-panel', name: 'Unavailable panel', availability: 'unavailable' }
      expect((await persistence.supplierProducts.create(unavailable)).ok).toBe(true)
      const service = createProjectService(persistence)
      expect((await service.projects.create(project)).ok).toBe(true)
      const second = cuttingProjectSchema.parse({ ...project, id: 'second-project' })
      expect((await service.projects.create(second)).ok).toBe(true)
      const wrapper = render(persistence.materials, service, persistence)
      await vi.waitFor(() => { expect(wrapper.find('input[aria-label="Search materials"]').attributes('disabled') === undefined).toBe(true) })
      const panelColumn = wrapper.get('.panel-references')
      expect(panelColumn.findAll('input[type="checkbox"]')).toHaveLength(3)
      expect(wrapper.text()).not.toContain('All material panels')
      expect(wrapper.text()).not.toContain('Bulk panel selection')
      expect(wrapper.find('input[aria-label^="Use all"]').exists()).toBe(false)
      await wrapper.get(`input[aria-label="Use panel ${validSupplierProductInput.name}"]`).setValue(true)
      expect(wrapper.get<HTMLInputElement>('input[aria-label="Use panel Second panel"]').element.checked).toBe(false)
      await wrapper.get('input[aria-label="Use panel Second panel"]').setValue(true)
      expect(wrapper.get('input[aria-label="Use panel Unavailable panel"]').attributes('disabled')).toBeDefined()
      await wrapper.get('input[aria-label="Use Birch plywood BB/BB"]').setValue(true)
      await autosaved(wrapper)
      const saved = await service.projects.get(project.id)
      if (!saved.ok) throw new Error('Project not saved')
      expect(saved.value.materialIds).toEqual([material.id])
      expect(saved.value.supplierProductIds).toEqual([validSupplierProductInput.id, extra.id])
      expect(await service.projects.get(second.id)).toEqual({ ok: true, value: second })
      expect(await persistence.materials.list()).toEqual({ ok: true, value: [material] })
      expect(await persistence.supplierProducts.list()).toMatchObject({ ok: true, value: [validSupplierProductInput, extra, unavailable] })
      expect(await persistence.stockItems.list()).toEqual({ ok: true, value: [] })
      wrapper.unmount()
      const other = render(persistence.materials, service, persistence, second.id)
      await vi.waitFor(() => { expect(other.find('input[aria-label="Use Birch plywood BB/BB"]').exists()).toBe(true) })
      expect(other.get<HTMLInputElement>('input[aria-label="Use Birch plywood BB/BB"]').element.checked).toBe(false)
      expect(other.findAll('input:checked')).toHaveLength(0)
    } finally { persistence.close() }
  })
  it('preserves quantities for retained selections and removes only explicitly deselected references', async () => {
    const persistence = createLocalPersistence('selection-quantities-ui', { indexedDB: new IDBFactory(), IDBKeyRange })
    try {
      await persistence.materials.create(material)
      await persistence.suppliers.create(validSupplierInput)
      await persistence.supplierProducts.create(validSupplierProductInput)
      await persistence.supplierProducts.create({ ...validSupplierProductInput, id: 'second-panel', name: 'Second panel' })
      const selected = cuttingProjectSchema.parse({ ...project, supplierProductIds: [validSupplierProductInput.id, 'second-panel'], panelQuantities: [{ supplierProductId: validSupplierProductInput.id, quantity: 5 }, { supplierProductId: 'second-panel', quantity: 2 }] })
      const service = createProjectService(persistence)
      await service.projects.create(selected)
      const wrapper = render(persistence.materials, service, persistence)
      await vi.waitFor(() => { expect(wrapper.find('input[aria-label="Search materials"]').attributes('disabled') === undefined).toBe(true) })
      const productCheckbox = wrapper.findAll('label').find(label => label.text().includes('Second panel'))?.get('input')
      if (!productCheckbox) throw new Error('Missing product checkbox')
      await productCheckbox.setValue(false)
      await autosaved(wrapper)
      const saved = await service.projects.get(project.id)
      expect(saved.ok && saved.value.panelQuantities).toEqual([{ supplierProductId: validSupplierProductInput.id, quantity: 5 }])
      expect((await persistence.supplierProducts.list()).ok).toBe(true)
    } finally { persistence.close() }
  })
  it('preserves failed selection drafts and retries without modifying materials', async () => {
    const persistence = createLocalPersistence('selection-failure-ui', { indexedDB: new IDBFactory(), IDBKeyRange })
    try {
      await persistence.materials.create(material)
      await persistence.suppliers.create(validSupplierInput)
      await persistence.supplierProducts.create(validSupplierProductInput)
      const service = createProjectService(persistence)
      await service.projects.create(project)
      const update = vi.spyOn(service.projects, 'update').mockResolvedValueOnce(storageFailure)
      const wrapper = render(persistence.materials, service, persistence)
      await vi.waitFor(() => { expect(wrapper.find('input[aria-label="Use Birch plywood BB/BB"]').exists()).toBe(true) })
      const checkbox = wrapper.get<HTMLInputElement>('input[type="checkbox"]')
      await checkbox.setValue(true)
      await vi.waitFor(() => { expect(wrapper.find('[role="alert"]').exists()).toBe(true) })
      expect(checkbox.element.checked).toBe(true)
      expect(await service.projects.get(project.id)).toEqual({ ok: true, value: project })
      await button(wrapper, 'Retry').trigger('click')
      await autosaved(wrapper)
      expect(update).toHaveBeenCalledTimes(2)
      expect(await persistence.materials.list()).toEqual({ ok: true, value: [material] })
    } finally { persistence.close() }
  })
  it('retains missing catalog selections until the user explicitly removes them', async () => {
    const persistence = createLocalPersistence('missing-selection-ui', { indexedDB: new IDBFactory(), IDBKeyRange })
    try {
      const invalid = cuttingProjectSchema.parse({ ...project, materialIds: ['deleted-material'], supplierProductIds: ['deleted-product'] })
      // Simulate preexisting/dangling references at the raw storage boundary.
      await persistence.projects.create(invalid)
      const service = createProjectService(persistence)
      const wrapper = render(persistence.materials, service, persistence)
      await vi.waitFor(() => { expect(wrapper.text()).toContain('Some selected catalog references are missing') })
      expect(await service.projects.get(project.id)).toEqual({ ok: true, value: invalid })
      await button(wrapper, 'Remove missing selections').trigger('click')
      await autosaved(wrapper)
      expect(await service.projects.get(project.id)).toEqual({ ok: true, value: project })
    } finally { persistence.close() }
  })

  it('filters grouped materials without changing hidden selections and focuses their panel references', async () => {
    const persistence = createLocalPersistence('selection-filter-ui', { indexedDB: new IDBFactory(), IDBKeyRange })
    try {
      const oak = materialSchema.parse({ ...material, id: 'oak-material', name: 'Oak', category: 'Hardwoods', libraryPresetId: 'chene' })
      await persistence.materials.create(material)
      await persistence.materials.create(oak)
      await persistence.suppliers.create(validSupplierInput)
      await persistence.supplierProducts.create(validSupplierProductInput)
      await persistence.supplierProducts.create({ ...validSupplierProductInput, id: 'oak-panel', materialId: oak.id, name: 'Oak panel' })
      const service = createProjectService(persistence)
      await service.projects.create(project)
      const wrapper = render(persistence.materials, service, persistence)
      await vi.waitFor(() => { expect(wrapper.find('input[aria-label="Use Oak"]').exists()).toBe(true) })
      await wrapper.get('button[aria-label="Show panels for Oak"]').trigger('click')
      await wrapper.get('input[aria-label="Use Oak"]').setValue(true)
      expect(wrapper.get('.panel-references > header').text()).toContain('Oak')
      expect(wrapper.get('aside').text()).toContain('Oak')
      // Material choice does not select any of its products.
      expect(wrapper.get<HTMLInputElement>('input[aria-label="Use panel Oak panel"]').element.checked).toBe(false)
      await wrapper.get('input[aria-label="Search materials"]').setValue('birch')
      expect(wrapper.find('input[aria-label="Use Oak"]').exists()).toBe(false)
      expect(wrapper.get('aside').text()).toContain('Oak')
      expect(wrapper.get('.panel-references > header').text()).toContain(material.name)
      await wrapper.get('select[aria-label="Filter material category"]').setValue('Hardwoods')
      expect(wrapper.text()).toContain('No materials match your search.')
      await wrapper.get('input[aria-label="Search materials"]').setValue('')
      expect(wrapper.get('[aria-labelledby="library-title"]').text()).toContain('Hardwoods')
      expect(wrapper.find(`input[aria-label="Use ${material.name}"]`).exists()).toBe(false)
      expect(wrapper.get('img').attributes('src')).toContain('/textures/')
      await autosaved(wrapper)
      expect((await service.projects.get(project.id))).toMatchObject({ ok: true, value: { materialIds: [oak.id], supplierProductIds: [] } })
    } finally { persistence.close() }
  })
  it('summarizes separate material and panel choices and removes each without affecting the other', async () => {
    const persistence = createLocalPersistence('selection-summary-ui', { indexedDB: new IDBFactory(), IDBKeyRange })
    try {
      await persistence.materials.create(material)
      await persistence.suppliers.create(validSupplierInput)
      await persistence.supplierProducts.create(validSupplierProductInput)
      const service = createProjectService(persistence)
      await service.projects.create(project)
      const wrapper = render(persistence.materials, service, persistence)
      await vi.waitFor(() => { expect(wrapper.find('input[aria-label="Search materials"]').attributes('disabled') === undefined).toBe(true) })
      await wrapper.get(`input[aria-label="Use panel ${validSupplierProductInput.name}"]`).setValue(true)
      expect(wrapper.get('aside').text()).toContain('Panel references only')
      expect(wrapper.get('aside').findAll('dd').map(value => value.text())).toEqual(['0', '1'])
      await wrapper.get(`input[aria-label="Use ${material.name}"]`).setValue(true)
      await wrapper.get(`button[aria-label="Remove material ${material.name}"]`).trigger('click')
      expect(wrapper.get('aside').findAll('dd').map(value => value.text())).toEqual(['0', '1'])
      await wrapper.get(`button[aria-label="Remove panel ${validSupplierProductInput.name}"]`).trigger('click')
      expect(wrapper.get('aside').findAll('dd').map(value => value.text())).toEqual(['0', '0'])
      expect(wrapper.get('aside').text()).toContain('Choose materials')
      expect(wrapper.get('aside').text()).not.toContain('Unsaved changes')
      await autosaved(wrapper)
      expect((await service.projects.get(project.id))).toMatchObject({ ok: true, value: { materialIds: [], supplierProductIds: [] } })
      expect(await persistence.stockItems.list()).toEqual({ ok: true, value: [] })
    } finally { persistence.close() }
  })
  it('warns on page unload only while saving, and cleans up its listener', async () => {
    const repository = fakeRepository()
    repository.list.mockResolvedValue({ ok: true, value: [material] })
    const projects = projectRepository()
    let resolveWrite: (() => void) | undefined
    const original = projects.update.getMockImplementation()
    projects.update.mockImplementationOnce(async (id, record) => {
      await new Promise<void>(resolve => { resolveWrite = resolve })
      if (!original) throw new Error('Missing repository implementation')
      return original(id, record)
    })
    const source: ProjectService = { projects, parts: () => { throw new Error('Not used') }, deletionPreview: () => Promise.resolve({ ok: true, value: { restorationIssues: [] } }), deleteProject: () => Promise.resolve({ ok: true, value: undefined }),
    listLegacyParts: () => Promise.resolve({ ok: true, value: [] }), adoptLegacyParts: () => Promise.resolve({ ok: true, value: undefined }) }
    const wrapper = render(repository, source)
    await flushPromises()
    expect(wrapper.text()).not.toContain('Selections up to date')
    expect(wrapper.text()).not.toContain('Save project selections')
    expect(wrapper.find('.project-selection > footer').exists()).toBe(false)
    await wrapper.get(`input[aria-label="Use ${material.name}"]`).setValue(true)
    await flushPromises()
    expect(wrapper.get('.project-selection > footer').text()).toBe('Saving…')
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    resolveWrite?.()
    await autosaved(wrapper)
    const savedEvent = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(savedEvent)
    expect(savedEvent.defaultPrevented).toBe(false)
    wrapper.unmount()
    const closedEvent = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(closedEvent)
    expect(closedEvent.defaultPrevented).toBe(false)
  })
  it('keeps products with a missing material visible and removable in the summary', async () => {
    const persistence = createLocalPersistence('selection-broken-product-ui', { indexedDB: new IDBFactory(), IDBKeyRange })
    try {
      await persistence.suppliers.create(validSupplierInput)
      await persistence.supplierProducts.create(validSupplierProductInput)
      await persistence.projects.create({ ...project, supplierProductIds: [validSupplierProductInput.id] })
      const wrapper = render(persistence.materials, createProjectService(persistence), persistence)
      await vi.waitFor(() => { expect(wrapper.get('aside').text()).toContain('Missing material · reference retained') })
      await wrapper.get(`button[aria-label="Remove panel ${validSupplierProductInput.name}"]`).trigger('click')
      await autosaved(wrapper)
      expect(await persistence.projects.get(project.id)).toEqual({ ok: true, value: project })
      expect((await persistence.supplierProducts.get(supplierProductSchema.parse(validSupplierProductInput).id)).ok).toBe(true)
    } finally { persistence.close() }
  })

  it('does not offer missing-reference removal when a refresh fails to read storage', async () => {
    const repository = fakeRepository()
    repository.list.mockResolvedValueOnce({ ok: true, value: [material] }).mockResolvedValue(storageFailure)
    const projects = projectRepository()
    await projects.update(project.id, { ...project, materialIds: [material.id] })
    const service: ProjectService = {
      projects, parts: () => { throw new Error('Not used') },
      deletionPreview: () => Promise.resolve({ ok: true, value: { restorationIssues: [] } }), deleteProject: () => Promise.resolve({ ok: true, value: undefined }),
    listLegacyParts: () => Promise.resolve({ ok: true, value: [] }),
      adoptLegacyParts: () => Promise.resolve({ ok: true, value: undefined }),
    }
    const wrapper = render(repository, service)
    await flushPromises()
    await button(wrapper, 'Refresh').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not access local storage')
    expect(wrapper.text()).not.toContain('Remove missing selections')
    expect(wrapper.find('button[aria-label="Remove material Birch plywood BB/BB"]').exists()).toBe(false)
    expect((await projects.get(project.id))).toMatchObject({ ok: true, value: { materialIds: [material.id] } })
  })

  it('views materials independently from saved material and panel selections, preserving checks across switches', async () => {
    const persistence = createLocalPersistence('three-column-view-ui', { indexedDB: new IDBFactory(), IDBKeyRange })
    try {
      const oak = materialSchema.parse({ ...material, id: 'second-material', name: 'Oak', category: 'Hardwoods' })
      await persistence.materials.create(material)
      await persistence.materials.create(oak)
      await persistence.suppliers.create(validSupplierInput)
      await persistence.supplierProducts.create(validSupplierProductInput)
      await persistence.supplierProducts.create({ ...validSupplierProductInput, id: 'oak-panel', name: 'Oak panel', materialId: oak.id })
      const service = createProjectService(persistence)
      const saved = cuttingProjectSchema.parse({ ...project, materialIds: [oak.id], supplierProductIds: ['oak-panel'] })
      await service.projects.create(saved)
      const wrapper = render(persistence.materials, service, persistence)
      await vi.waitFor(() => { expect(wrapper.get('input[aria-label="Search materials"]').attributes('disabled')).toBeUndefined() })
      expect(wrapper.get(`button[aria-label="Show panels for ${material.name}"]`).attributes('aria-pressed')).toBe('true')
      expect(wrapper.get<HTMLInputElement>(`input[aria-label="Use ${material.name}"]`).element.checked).toBe(false)
      expect(wrapper.get('aside').findAll('dd').map(value => value.text())).toEqual(['1', '1'])
      expect(wrapper.get('aside').text()).toContain('Oak panel')
      // Clicking a row changes the view only; even an unselected row stays unselected.
      await wrapper.get('button[aria-label="Show panels for Oak"]').trigger('click')
      expect(wrapper.get<HTMLInputElement>('input[aria-label="Use panel Oak panel"]').element.checked).toBe(true)
      await wrapper.get('input[aria-label="Use Oak"]').setValue(false)
      expect(wrapper.get('button[aria-label="Show panels for Oak"]').attributes('aria-pressed')).toBe('true')
      await wrapper.get(`input[aria-label="Use ${material.name}"]`).setValue(true)
      expect(wrapper.get('button[aria-label="Show panels for Oak"]').attributes('aria-pressed')).toBe('true')
      await wrapper.get(`button[aria-label="Show panels for ${material.name}"]`).trigger('click')
      expect(wrapper.get<HTMLInputElement>(`input[aria-label="Use panel ${validSupplierProductInput.name}"]`).element.checked).toBe(false)
      await wrapper.get(`input[aria-label="Use panel ${validSupplierProductInput.name}"]`).setValue(true)
      await wrapper.get(`input[aria-label="Use ${material.name}"]`).setValue(false)
      expect(wrapper.get('aside').findAll('dd').map(value => value.text())).toEqual(['0', '2'])
      expect(wrapper.get('aside').text()).toContain('Oak panel')
      await wrapper.get('button[aria-label="Show panels for Oak"]').trigger('click')
      expect(wrapper.get<HTMLInputElement>('input[aria-label="Use Oak"]').element.checked).toBe(false)
      await wrapper.get('input[aria-label="Use panel Oak panel"]').setValue(false)
      await autosaved(wrapper)
      expect((await service.projects.get(project.id))).toMatchObject({ ok: true, value: { materialIds: [], supplierProductIds: [validSupplierProductInput.id] } })
      expect(await persistence.stockItems.list()).toEqual({ ok: true, value: [] })
    } finally { persistence.close() }
  })
  it.each([
    { name: 'catalog only', catalog: true, quantities: [], expected: 1 },
    { name: 'stock offcut only', catalog: false, quantities: [1], expected: 1 },
    { name: 'stock quantity greater than one', catalog: false, quantities: [4], expected: 4 },
    { name: 'catalog and purchased stock', catalog: true, quantities: [3], expected: 4 },
    { name: 'multiple stock items linked to the same catalog product', catalog: true, quantities: [2, 3], expected: 6 },
    { name: 'zero-quantity stock alongside catalog', catalog: true, quantities: [0], expected: 1 },
    { name: 'no stock or catalog', catalog: false, quantities: [], expected: 0 },
    { name: 'only depleted stock', catalog: false, quantities: [0], expected: 0 },
  ])('counts available panels consistently for $name', async ({ catalog, quantities, expected }) => {
    const repository = fakeRepository()
    repository.list.mockResolvedValue({ ok: true, value: [material] })
    const item = stockItemSchema.parse(validStockItemInput)
    // A defensive depleted-source fixture; persistence still rejects zero quantities.
    const items = quantities.map((quantity, index) => ({ ...item, id: stockItemSchema.shape.id.parse(`stock-${String(index)}`), quantity, provenance: { source: 'purchase' as const, supplierProductId: supplierProductSchema.shape.id.parse(validSupplierProductInput.id) } }))
    const empty = { create: vi.fn(), get: vi.fn(), update: vi.fn(), delete: vi.fn(), list: vi.fn().mockResolvedValue({ ok: true, value: [] }) }
    const source = {
      suppliers: { ...empty, list: vi.fn().mockResolvedValue({ ok: true, value: [validSupplierInput] }) },
      supplierProducts: { ...empty, list: vi.fn().mockResolvedValue({ ok: true, value: catalog ? [validSupplierProductInput] : [] }) },
      stockItems: { ...empty, list: vi.fn().mockResolvedValue({ ok: true, value: items }) },
    }
    const wrapper = render(repository, undefined, source)
    await flushPromises()
    const row = wrapper.find(`button[aria-label="Show panels for ${material.name}"]`)
    if (expected) expect(row.text()).toContain(`${String(expected)} available panels`)
    else expect(row.exists()).toBe(false)
    expect(wrapper.text()).not.toContain('available references')
    const panels = wrapper.get('.panel-references')
    expect(panels.findAll('input[aria-label^="Use panel "]')).toHaveLength(catalog ? 1 : 0)
    expect(panels.findAll('input[aria-label^="Use stock "]')).toHaveLength(quantities.filter(quantity => quantity > 0).length)
    for (const stock of items) {
      const checkbox = panels.find(`input[aria-label="Use stock ${stock.id}"]`)
      if (stock.quantity > 0) expect(checkbox.element.closest('label')?.textContent).toContain(`${String(stock.quantity)} available`)
      else expect(checkbox.exists()).toBe(false)
    }
    expect(source.stockItems.list).toHaveBeenCalledTimes(1)
    expect(source.stockItems.update).not.toHaveBeenCalled()
  })

  it('excludes unavailable catalog references from the available panel count without hiding their rows', async () => {
    const repository = fakeRepository()
    repository.list.mockResolvedValue({ ok: true, value: [material] })
    const empty = { create: vi.fn(), get: vi.fn(), update: vi.fn(), delete: vi.fn(), list: vi.fn().mockResolvedValue({ ok: true, value: [] }) }
    const wrapper = render(repository, undefined, {
      suppliers: { ...empty, list: vi.fn().mockResolvedValue({ ok: true, value: [validSupplierInput] }) },
      supplierProducts: { ...empty, list: vi.fn().mockResolvedValue({ ok: true, value: [{ ...validSupplierProductInput, availability: 'unavailable' }] }) },
      stockItems: empty,
    })
    await flushPromises()
    expect(wrapper.get(`button[aria-label="Show panels for ${material.name}"]`).text()).toContain('0 available panels')
    expect(wrapper.get(`input[aria-label="Use panel ${validSupplierProductInput.name}"]`).attributes('disabled')).toBeDefined()
  })

  it('shows catalog-only, stock-only and mixed materials and persists stock choices without consumption', async () => {
    const indexedDB = new IDBFactory()
    const persistence = createLocalPersistence('stock-source-selections', { indexedDB, IDBKeyRange })
    const next = createLocalPersistence('stock-source-selections', { indexedDB, IDBKeyRange })
    try {
      const stockOnly = materialSchema.parse({ ...material, id: 'stock-only', name: 'Stock only' })
      const hidden = materialSchema.parse({ ...material, id: 'no-panels', name: 'No panels' })
      const mixed = materialSchema.parse({ ...material, id: 'both-sources', name: 'Both sources' })
      for (const record of [material, stockOnly, hidden, mixed]) await persistence.materials.create(record)
      await persistence.suppliers.create(validSupplierInput)
      await persistence.supplierProducts.create(validSupplierProductInput)
      await persistence.supplierProducts.create({ ...validSupplierProductInput, id: 'mixed-product', materialId: mixed.id })
      const item = stockItemSchema.parse({ ...validStockItemInput, materialId: stockOnly.id })
      await createStockRepository(persistence).create({ ...item, provenance: { source: 'manual' } })
      await createStockRepository(persistence).create({ ...item, id: 'mixed-stock', materialId: mixed.id, kind: 'fullPanel', provenance: { source: 'manual' } })
      const inventory = await persistence.stockItems.list()
      const service = createProjectService(persistence)
      await service.projects.create(project)
      const wrapper = render(persistence.materials, service, persistence)
      await vi.waitFor(() => { expect(wrapper.get('input[aria-label="Search materials"]').attributes('disabled')).toBeUndefined() })
      expect(wrapper.find(`input[aria-label="Use ${hidden.name}"]`).exists()).toBe(false)
      for (const name of [material.name, stockOnly.name, mixed.name]) expect(wrapper.find(`input[aria-label="Use ${name}"]`).exists()).toBe(true)
      await wrapper.get(`button[aria-label="Show panels for ${stockOnly.name}"]`).trigger('click')
      expect(wrapper.get('.panel-references').text()).toContain(`${String(item.quantity)} available`)
      expect(wrapper.get('.panel-references').text()).toContain('Stock · Offcut')
      await wrapper.get(`input[aria-label="Use stock ${item.id}"]`).setValue(true)
      await autosaved(wrapper)
      expect(await service.projects.get(project.id)).toMatchObject({ ok: true, value: { materialIds: [], supplierProductIds: [], stockItemIds: [item.id] } })
      expect(wrapper.get('aside').findAll('dd').map(value => value.text())).toEqual(['0', '1'])
      expect(await persistence.stockItems.list()).toEqual(inventory)
      wrapper.unmount()
      const reopened = render(next.materials, createProjectService(next), next)
      await vi.waitFor(() => { expect(reopened.get('input[aria-label="Search materials"]').attributes('disabled')).toBeUndefined() })
      await reopened.get(`button[aria-label="Show panels for ${stockOnly.name}"]`).trigger('click')
      expect(reopened.get<HTMLInputElement>(`input[aria-label="Use stock ${item.id}"]`).element.checked).toBe(true)
      await reopened.get(`button[aria-label="Remove stock ${item.id}"]`).trigger('click')
      await autosaved(reopened)
      expect(await next.projects.get(project.id)).toMatchObject({ ok: true, value: { stockItemIds: [] } })
      await reopened.get(`button[aria-label="Show panels for ${mixed.name}"]`).trigger('click')
      expect(reopened.get('.panel-references').findAll('input[type="checkbox"]')).toHaveLength(2)
      expect(await next.stockItems.list()).toEqual(inventory)
    } finally { persistence.close(); next.close() }
  })

  it('hides own generated offcuts but preserves circular selections with an actionable warning after reopening', async () => {
    const persistence = createLocalPersistence('offcut-eligibility-ui', { indexedDB: new IDBFactory(), IDBKeyRange })
    try {
      await persistence.materials.create(material)
      const own = stockItemSchema.parse({ ...validStockItemInput, provenance: { source: 'cutting', projectId: project.id, savedPlanId: 'origin-plan', supplierProductId: validSupplierProductInput.id, panelIndex: 0, wasteIndex: 0 } })
      const unrelated = stockItemSchema.parse({ ...own, id: 'unrelated-stock', provenance: { source: 'manual' } })
      await persistence.stockItems.create(own)
      await persistence.stockItems.create(unrelated)
      // Raw persistence represents a previously saved circular selection; guarded writes reject new ones.
      await persistence.projects.create({ ...project, stockItemIds: [own.id] })
      const other = cuttingProjectSchema.parse({ ...project, id: 'another-project' })
      await persistence.projects.create(other)
      const inventory = await persistence.stockItems.list()
      for (let index = 0; index < 2; index++) {
        const wrapper = render(persistence.materials, createProjectService(persistence), persistence)
        await vi.waitFor(() => { expect(wrapper.find(`input[aria-label="Use stock ${unrelated.id}"]`).exists()).toBe(true) })
        expect(wrapper.find(`input[aria-label="Use stock ${own.id}"]`).exists()).toBe(false)
        expect(wrapper.get('aside').text()).toContain('Generated by this project · cannot be used here')
        expect(wrapper.get(`button[aria-label="Show panels for ${material.name}"]`).text()).toContain('1 available panels')
        wrapper.unmount()
      }
      const otherView = render(persistence.materials, createProjectService(persistence), persistence, other.id)
      await vi.waitFor(() => { expect(otherView.find(`input[aria-label="Use stock ${own.id}"]`).exists()).toBe(true) })
      await otherView.get(`input[aria-label="Use stock ${own.id}"]`).setValue(true)
      await autosaved(otherView)
      expect(await persistence.projects.get(other.id)).toMatchObject({ ok: true, value: { stockItemIds: [own.id] } })
      const sourceView = render(persistence.materials, createProjectService(persistence), persistence)
      await vi.waitFor(() => { expect(sourceView.find(`button[aria-label="Remove stock ${own.id}"]`).exists()).toBe(true) })
      await sourceView.get(`button[aria-label="Remove stock ${own.id}"]`).trigger('click')
      await autosaved(sourceView)
      expect(await persistence.projects.get(project.id)).toMatchObject({ ok: true, value: { stockItemIds: [] } })
      expect(await createStockRepository(persistence).list()).toEqual(inventory)
      // With only its own offcut as a source, the material also disappears from the available library.
      await persistence.stockItems.delete(unrelated.id)
      const onlyOwn = render(persistence.materials, createProjectService(persistence), persistence)
      await vi.waitFor(() => { expect(onlyOwn.get('.material-library').text()).toContain('No panel sources available') })
      expect(onlyOwn.find(`input[aria-label="Use ${material.name}"]`).exists()).toBe(false)
      expect(await persistence.stockItems.get(own.id)).toEqual({ ok: true, value: own })
    } finally { persistence.close() }
  })

  it('hides a material after its last stock source disappears while retaining saved choices until explicit removal', async () => {
    const persistence = createLocalPersistence('lost-stock-source', { indexedDB: new IDBFactory(), IDBKeyRange })
    try {
      await persistence.materials.create(material)
      const stock = stockItemSchema.parse(validStockItemInput)
      await persistence.stockItems.create(stock)
      const selected = { ...project, materialIds: [material.id], stockItemIds: [stock.id] }
      const service = createProjectService(persistence)
      await service.projects.create(selected)
      const wrapper = render(persistence.materials, service, persistence)
      await vi.waitFor(() => { expect(wrapper.find(`input[aria-label="Use ${material.name}"]`).exists()).toBe(true) })
      await createStockRepository(persistence).delete(stock.id)
      await button(wrapper, 'Refresh').trigger('click')
      await vi.waitFor(() => { expect(wrapper.get('.material-library').text()).toContain('No panel sources available') })
      expect(wrapper.find(`input[aria-label="Use ${material.name}"]`).exists()).toBe(false)
      expect(wrapper.get('aside').text()).toContain('material selection retained')
      expect(wrapper.get('aside').text()).toContain(stock.id)
      expect(await service.projects.get(project.id)).toEqual({ ok: true, value: cuttingProjectSchema.parse(selected) })
      await button(wrapper, 'Remove missing selections').trigger('click')
      await autosaved(wrapper)
      expect(await service.projects.get(project.id)).toMatchObject({ ok: true, value: { materialIds: [material.id], stockItemIds: [] } })
      expect(await persistence.materials.list()).toEqual({ ok: true, value: [material] })
      expect(await persistence.cuttingConfirmations.list()).toEqual({ ok: true, value: [] })
    } finally { persistence.close() }
  })

  it('hides materials with no panels without deleting stored selections or materials', async () => {
    const repository = fakeRepository()
    repository.list.mockResolvedValue({ ok: true, value: [material] })
    const projects = projectRepository()
    projects.get.mockResolvedValue({ ok: true, value: { ...project, materialIds: [material.id] } })
    const empty = { create: vi.fn(), get: vi.fn(), update: vi.fn(), delete: vi.fn(), list: vi.fn().mockResolvedValue({ ok: true, value: [] }) }
    const source: ProjectService = { projects, parts: () => { throw new Error('Not used') }, deletionPreview: () => Promise.resolve({ ok: true, value: { restorationIssues: [] } }), deleteProject: () => Promise.resolve({ ok: true, value: undefined }),
    listLegacyParts: () => Promise.resolve({ ok: true, value: [] }), adoptLegacyParts: () => Promise.resolve({ ok: true, value: undefined }) }
    const wrapper = render(repository, source, { suppliers: empty, supplierProducts: empty })
    await flushPromises()
    expect(wrapper.get('.material-library').text()).not.toContain(material.name)
    expect(wrapper.find(`input[aria-label="Use ${material.name}"]`).exists()).toBe(false)
    expect(wrapper.get('aside').text()).toContain(material.name)
    expect(wrapper.get('aside').text()).toContain('material selection retained')
    expect(projects.update).not.toHaveBeenCalled()
    expect(repository.delete).not.toHaveBeenCalled()
    expect(wrapper.get('.materials-workspace').element.children).toHaveLength(3)
  })

  it('retains previously saved panel choices, including unavailable panels, without writing on open', async () => {
    const persistence = createLocalPersistence('existing-individual-selections-ui', { indexedDB: new IDBFactory(), IDBKeyRange })
    try {
      await persistence.materials.create(material)
      await persistence.suppliers.create(validSupplierInput)
      await persistence.supplierProducts.create(validSupplierProductInput)
      await persistence.supplierProducts.create({ ...validSupplierProductInput, id: 'unavailable-panel', name: 'Unavailable panel', availability: 'unavailable' })
      const saved = cuttingProjectSchema.parse({ ...project, materialIds: [material.id], supplierProductIds: [validSupplierProductInput.id, 'unavailable-panel'], panelQuantities: [{ supplierProductId: validSupplierProductInput.id, quantity: 3 }, { supplierProductId: 'unavailable-panel', quantity: 2 }] })
      // Legacy selections may reference a panel that is no longer available.
      await persistence.projects.create(saved)
      const service = createProjectService(persistence)
      const update = vi.spyOn(service.projects, 'update')
      const wrapper = render(persistence.materials, service, persistence)
      await vi.waitFor(() => { expect(wrapper.get('input[aria-label="Search materials"]').attributes('disabled')).toBeUndefined() })
      expect(wrapper.get<HTMLInputElement>(`input[aria-label="Use panel ${validSupplierProductInput.name}"]`).element.checked).toBe(true)
      const unavailable = wrapper.get<HTMLInputElement>('input[aria-label="Use panel Unavailable panel"]')
      expect(unavailable.element.checked).toBe(true)
      expect(unavailable.attributes('disabled')).toBeUndefined()
      expect(wrapper.get('aside').findAll('dd').map(value => value.text())).toEqual(['1', '2'])
      expect(await service.projects.get(project.id)).toEqual({ ok: true, value: saved })
      expect(update).not.toHaveBeenCalled()
      await unavailable.setValue(false)
      expect(wrapper.get<HTMLInputElement>(`input[aria-label="Use panel ${validSupplierProductInput.name}"]`).element.checked).toBe(true)
      expect(unavailable.attributes('disabled')).toBeDefined()
      await autosaved(wrapper)
      expect((await service.projects.get(project.id))).toMatchObject({ ok: true, value: { supplierProductIds: [validSupplierProductInput.id], panelQuantities: [{ supplierProductId: validSupplierProductInput.id, quantity: 3 }] } })
    } finally { persistence.close() }
  })

  it('serializes rapid changes without replacing newer draft selections with an older completion', async () => {
    const repository = fakeRepository()
    const oak = materialSchema.parse({ ...material, id: 'oak', name: 'Oak' })
    repository.list.mockResolvedValue({ ok: true, value: [material, oak] })
    const projects = projectRepository()
    let release: (() => void) | undefined
    const original = projects.update.getMockImplementation()
    projects.update.mockImplementationOnce(async (id, record) => {
      await new Promise<void>(resolve => { release = resolve })
      if (!original) throw new Error('Missing repository implementation')
      return original(id, record)
    })
    const source: ProjectService = { projects, parts: () => { throw new Error('Not used') }, deletionPreview: () => Promise.resolve({ ok: true, value: { restorationIssues: [] } }), deleteProject: () => Promise.resolve({ ok: true, value: undefined }),
    listLegacyParts: () => Promise.resolve({ ok: true, value: [] }), adoptLegacyParts: () => Promise.resolve({ ok: true, value: undefined }) }
    const wrapper = render(repository, source)
    await flushPromises()
    await wrapper.get(`input[aria-label="Use ${material.name}"]`).setValue(true)
    await flushPromises()
    expect(projects.update).toHaveBeenCalledTimes(1)
    await wrapper.get('input[aria-label="Use Oak"]').setValue(true)
    await wrapper.get(`input[aria-label="Use ${material.name}"]`).setValue(false)
    await wrapper.get('button[aria-label="Remove material Oak"]').trigger('click')
    await wrapper.get('input[aria-label="Use Oak"]').setValue(true)
    expect(wrapper.get<HTMLInputElement>('input[aria-label="Use Oak"]').element.checked).toBe(true)
    expect(projects.update).toHaveBeenCalledTimes(1)
    release?.()
    await autosaved(wrapper)
    expect(projects.update).toHaveBeenCalledTimes(2)
    expect((await projects.get(project.id))).toMatchObject({ ok: true, value: { materialIds: [oak.id] } })
    expect(wrapper.get<HTMLInputElement>(`input[aria-label="Use ${material.name}"]`).element.checked).toBe(false)
    expect(wrapper.find('.project-selection > footer').exists()).toBe(false)
  })

})
