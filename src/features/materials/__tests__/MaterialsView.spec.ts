import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { cuttingProjectSchema } from '../../../domain/model/cutting-project'
import { createProjectService, type ProjectService } from '../../../application/projects/project-service'
import { projectIdKey, projectServiceKey } from '../../projects/project-service'
import { supplierRepositoryKey, supplierProductRepositoryKey } from '../../suppliers/catalog-repositories'
import type { LocalPersistence, PersistenceResult, Repository } from '../../../application/persistence/repositories'
import { validMaterialInput, validSupplierInput, validSupplierProductInput } from '../../../domain/model/__tests__/fixtures'
import { supplierProductSchema } from '../../../domain/model/supplier-product'
import { materialSchema, type Material } from '../../../domain/model/material'
import { createLocalPersistence } from '../../../infrastructure/persistence/local-database'
import { createMemoryHistory } from 'vue-router'
import { createAppRouter } from '../../../app/router'
import MaterialsView from '../MaterialsView.vue'
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
function render(repository: Repository<Material>, service?: ProjectService, catalog?: Pick<LocalPersistence, 'suppliers' | 'supplierProducts'>, id = project.id) {
  const emptyCatalog = {
    create: vi.fn(), get: vi.fn(), update: vi.fn(), delete: vi.fn(),
    list: vi.fn().mockResolvedValue({ ok: true, value: [] }),
  }
  const source: ProjectService = service ?? {
    projects: projectRepository(), parts: () => { throw new Error('Not used') },
    listLegacyParts: () => Promise.resolve({ ok: true, value: [] }),
    adoptLegacyParts: () => Promise.resolve({ ok: true, value: undefined }),
  }
  const wrapper = mount(MaterialsView, {
    attachTo: document.body,
    global: {
      plugins: [createAppRouter(createMemoryHistory())],
      provide: {
        [materialRepositoryKey]: repository, [projectServiceKey]: source, [projectIdKey]: id,
        [supplierRepositoryKey]: catalog?.suppliers ?? emptyCatalog, [supplierProductRepositoryKey]: catalog?.supplierProducts ?? emptyCatalog,
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
    expect(wrapper.text()).toContain('No catalog materials yet')
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
    expect(wrapper.text()).not.toContain('No catalog materials yet')
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
    expect(wrapper.text()).not.toContain('No catalog materials yet')
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
      await button(wrapper, 'Save project selections').trigger('click')
      await vi.waitFor(() => { expect(wrapper.text()).toContain('Project selections saved.') })
      wrapper.unmount()
      first.close()
      const reopened = render(second.materials, createProjectService(second))
      await vi.waitFor(() => { expect(reopened.find('input[aria-label="Use Birch plywood BB/BB"]').exists()).toBe(true) })
      expect(reopened.get<HTMLInputElement>('input[type="checkbox"]').element.checked).toBe(true)
      expect(await second.materials.list()).toEqual({ ok: true, value: [material] })
    } finally { first.close(); second.close() }
  })
  it('selects supplier/category/products with tri-state checkboxes, persists choices and isolates a second project', async () => {
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
      const supplier = wrapper.get<HTMLInputElement>(`input[aria-label="Use all products from ${validSupplierInput.name}"]`)
      const category = wrapper.get<HTMLInputElement>(`input[aria-label="Use ${material.category} products from ${validSupplierInput.name}"]`)
      await wrapper.get(`input[aria-label="Use panel ${validSupplierProductInput.name}"]`).setValue(true)
      expect(supplier.element.indeterminate).toBe(true)
      expect(category.element.indeterminate).toBe(true)
      expect(supplier.attributes('aria-checked')).toBe('mixed')
      await category.setValue(true)
      expect(supplier.element.checked).toBe(true)
      expect(category.element.indeterminate).toBe(false)
      expect(wrapper.get('input[aria-label="Use panel Unavailable panel"]').attributes('disabled')).toBeDefined()
      await wrapper.get('input[aria-label="Use Birch plywood BB/BB"]').setValue(true)
      await button(wrapper, 'Save project selections').trigger('click')
      await vi.waitFor(() => { expect(wrapper.text()).toContain('Project selections saved.') })
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
      await button(wrapper, 'Save project selections').trigger('click')
      await vi.waitFor(() => { expect(wrapper.text()).toContain('Project selections saved.') })
      const saved = await service.projects.get(project.id)
      expect(saved.ok && saved.value.panelQuantities).toEqual([{ supplierProductId: validSupplierProductInput.id, quantity: 5 }])
      expect((await persistence.supplierProducts.list()).ok).toBe(true)
    } finally { persistence.close() }
  })
  it('preserves failed selection drafts and retries without modifying materials', async () => {
    const persistence = createLocalPersistence('selection-failure-ui', { indexedDB: new IDBFactory(), IDBKeyRange })
    try {
      await persistence.materials.create(material)
      const service = createProjectService(persistence)
      await service.projects.create(project)
      const update = vi.spyOn(service.projects, 'update').mockResolvedValueOnce(storageFailure)
      const wrapper = render(persistence.materials, service, persistence)
      await vi.waitFor(() => { expect(wrapper.find('input[aria-label="Use Birch plywood BB/BB"]').exists()).toBe(true) })
      const checkbox = wrapper.get<HTMLInputElement>('input[type="checkbox"]')
      await checkbox.setValue(true)
      await button(wrapper, 'Save project selections').trigger('click')
      await vi.waitFor(() => { expect(wrapper.find('[role="alert"]').exists()).toBe(true) })
      expect(checkbox.element.checked).toBe(true)
      expect(await service.projects.get(project.id)).toEqual({ ok: true, value: project })
      await button(wrapper, 'Save project selections').trigger('click')
      await vi.waitFor(() => { expect(wrapper.text()).toContain('Project selections saved.') })
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
      expect(await service.projects.get(project.id)).toEqual({ ok: true, value: invalid })
      await button(wrapper, 'Save project selections').trigger('click')
      await vi.waitFor(() => { expect(wrapper.text()).toContain('Project selections saved.') })
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
      expect(await service.projects.get(project.id)).toEqual({ ok: true, value: project })
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
      expect(await persistence.stockItems.list()).toEqual({ ok: true, value: [] })
    } finally { persistence.close() }
  })
  it('warns before refreshing a draft and on page unload, then clears the warning after save', async () => {
    const repository = fakeRepository()
    repository.list.mockResolvedValue({ ok: true, value: [material] })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const wrapper = render(repository)
    await flushPromises()
    await wrapper.get(`input[aria-label="Use ${material.name}"]`).setValue(true)
    expect(wrapper.get('aside').text()).toContain('Unsaved changes')
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    await button(wrapper, 'Refresh').trigger('click')
    expect(confirm).toHaveBeenCalledWith('Discard unsaved project material selections?')
    expect(repository.list).toHaveBeenCalledTimes(1)
    expect(wrapper.get<HTMLInputElement>(`input[aria-label="Use ${material.name}"]`).element.checked).toBe(true)
    await button(wrapper, 'Save project selections').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Project selections saved.')
    const savedEvent = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(savedEvent)
    expect(savedEvent.defaultPrevented).toBe(false)
    await wrapper.get(`input[aria-label="Use ${material.name}"]`).setValue(false)
    confirm.mockReturnValue(true)
    await button(wrapper, 'Refresh').trigger('click')
    await flushPromises()
    expect(wrapper.get<HTMLInputElement>(`input[aria-label="Use ${material.name}"]`).element.checked).toBe(true)
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
      await button(wrapper, 'Save project selections').trigger('click')
      await vi.waitFor(() => { expect(wrapper.text()).toContain('Project selections saved.') })
      expect(await persistence.projects.get(project.id)).toEqual({ ok: true, value: project })
      expect((await persistence.supplierProducts.get(supplierProductSchema.parse(validSupplierProductInput).id)).ok).toBe(true)
    } finally { persistence.close() }
  })

  it('keeps supplier/category bulk scope intact across hidden materials and other suppliers', async () => {
    const persistence = createLocalPersistence('selection-bulk-filter-ui', { indexedDB: new IDBFactory(), IDBKeyRange })
    try {
      const extra = materialSchema.parse({ ...material, id: 'extra-material', name: 'Maple plywood' })
      await persistence.materials.create(material)
      await persistence.materials.create(extra)
      await persistence.suppliers.create(validSupplierInput)
      await persistence.suppliers.create({ ...validSupplierInput, id: 'other-supplier', name: 'Other supplier' })
      await persistence.supplierProducts.create(validSupplierProductInput)
      await persistence.supplierProducts.create({ ...validSupplierProductInput, id: 'extra-panel', materialId: extra.id })
      await persistence.supplierProducts.create({ ...validSupplierProductInput, id: 'other-panel', supplierId: 'other-supplier' })
      const service = createProjectService(persistence)
      await service.projects.create(project)
      const wrapper = render(persistence.materials, service, persistence)
      await vi.waitFor(() => { expect(wrapper.find('input[aria-label="Search materials"]').attributes('disabled') === undefined).toBe(true) })
      await wrapper.get('input[aria-label="Search materials"]').setValue('birch')
      await wrapper.get(`input[aria-label="Use ${material.category} products from ${validSupplierInput.name}"]`).setValue(true)
      expect(wrapper.get('aside').findAll('dd').map(value => value.text())).toEqual(['0', '2'])
      expect(wrapper.get('aside').text()).toContain('Maple plywood')
      expect(wrapper.get<HTMLInputElement>('input[aria-label="Use all products from Other supplier"]').element.checked).toBe(false)
      await wrapper.get(`input[aria-label="Use all products from ${validSupplierInput.name}"]`).setValue(false)
      expect(wrapper.get('aside').findAll('dd').map(value => value.text())).toEqual(['0', '0'])
      expect(await service.projects.get(project.id)).toEqual({ ok: true, value: project })
    } finally { persistence.close() }
  })
  it('does not offer missing-reference removal when a refresh fails to read storage', async () => {
    const repository = fakeRepository()
    repository.list.mockResolvedValueOnce({ ok: true, value: [material] }).mockResolvedValue(storageFailure)
    const projects = projectRepository()
    await projects.update(project.id, { ...project, materialIds: [material.id] })
    const service: ProjectService = {
      projects, parts: () => { throw new Error('Not used') },
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
      await button(wrapper, 'Save project selections').trigger('click')
      await vi.waitFor(() => { expect(wrapper.text()).toContain('Project selections saved.') })
      expect((await service.projects.get(project.id))).toMatchObject({ ok: true, value: { materialIds: [], supplierProductIds: [validSupplierProductInput.id] } })
      expect(await persistence.stockItems.list()).toEqual({ ok: true, value: [] })
    } finally { persistence.close() }
  })
  it('explains that a material without panel references can still be selected for Parts', async () => {
    const repository = fakeRepository()
    repository.list.mockResolvedValue({ ok: true, value: [material] })
    const wrapper = render(repository)
    await flushPromises()
    expect(wrapper.get('.panel-references').text()).toContain('No panel references for this material')
    expect(wrapper.get('.panel-references').text()).toContain('You can still select this material for creating Parts')
    expect(wrapper.get(`button[aria-label="Show panels for ${material.name}"]`).attributes('type')).toBe('button')
    wrapper.get<HTMLButtonElement>(`button[aria-label="Show panels for ${material.name}"]`).element.focus()
    expect(document.activeElement).toBe(wrapper.get(`button[aria-label="Show panels for ${material.name}"]`).element)
    await wrapper.get(`button[aria-label="Show panels for ${material.name}"]`).trigger('click')
    expect(wrapper.get<HTMLInputElement>(`input[aria-label="Use ${material.name}"]`).element.checked).toBe(false)
    expect(wrapper.get('aside').text()).not.toContain('Unsaved changes')
    await wrapper.get(`input[aria-label="Use ${material.name}"]`).setValue(true)
    expect(wrapper.get('aside').findAll('dd').map(value => value.text())).toEqual(['1', '0'])
    expect(wrapper.get('.material-library').text()).toContain('0 available references')
    expect(wrapper.get('.materials-workspace').element.children).toHaveLength(3)
    expect(wrapper.get('.materials-workspace').element.children[0]?.classList.contains('material-library')).toBe(true)
    expect(wrapper.get('.materials-workspace').element.children[1]?.classList.contains('panel-references')).toBe(true)
    expect(wrapper.get('.materials-workspace').element.children[2]?.classList.contains('project-selection')).toBe(true)
    expect(wrapper.get('aside > footer').text()).toContain('Save project selections')
  })

})
