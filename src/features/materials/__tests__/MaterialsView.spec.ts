import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PersistenceResult, Repository } from '../../../application/persistence/repositories'
import { validMaterialInput } from '../../../domain/model/__tests__/fixtures'
import { materialSchema, type Material } from '../../../domain/model/material'
import { createLocalPersistence } from '../../../infrastructure/persistence/local-database'
import { createMemoryHistory } from 'vue-router'
import { createAppRouter } from '../../../app/router'
import MaterialsView from '../MaterialsView.vue'
import { materialRepositoryKey } from '../material-repository'

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
function render(repository: Repository<Material>) {
  const wrapper = mount(MaterialsView, {
    attachTo: document.body,
    global: { plugins: [createAppRouter(createMemoryHistory())], provide: { [materialRepositoryKey]: repository } },
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
    expect(wrapper.get('tbody').text()).toContain(material.category)
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
    expect(wrapper.get('tbody').text()).toContain(material.name)
  })
  it('reports invalid saved records without silently ignoring them', async () => {
    const repository = fakeRepository()
    repository.list.mockResolvedValue({ ok: false, error: { kind: 'invalidRecord', issues: [{ path: ['name'], message: 'Invalid name' }] } })
    const wrapper = render(repository)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Material data is invalid')
    expect(wrapper.text()).not.toContain('No catalog materials yet')
  })
  it('rereads persisted materials on remount and keeps selection transient', async () => {
    const indexedDB = new IDBFactory()
    const first = createLocalPersistence('materials-ui-test', { indexedDB, IDBKeyRange })
    const second = createLocalPersistence('materials-ui-test', { indexedDB, IDBKeyRange })
    try {
      expect((await first.materials.create(material)).ok).toBe(true)
      const wrapper = render(first.materials)
      await vi.waitFor(() => { expect(wrapper.find('tbody').exists()).toBe(true) })
      await wrapper.get('input[type="checkbox"]').setValue(true)
      expect(wrapper.get('aside').text()).toContain(material.name)
      wrapper.unmount()
      first.close()
      const reopened = render(second.materials)
      await vi.waitFor(() => { expect(reopened.find('tbody').exists()).toBe(true) })
      expect(reopened.get<HTMLInputElement>('input[type="checkbox"]').element.checked).toBe(false)
      expect(await second.materials.list()).toEqual({ ok: true, value: [material] })
    } finally { first.close(); second.close() }
  })
})
