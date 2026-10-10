import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PersistenceResult, Repository } from '../../../application/persistence/repositories'
import { validMaterialInput } from '../../../domain/model/__tests__/fixtures'
import { materialSchema, type Material } from '../../../domain/model/material'
import { createLocalPersistence } from '../../../infrastructure/persistence/local-database'
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
    global: { provide: { [materialRepositoryKey]: repository } },
  })
  wrappers.push(wrapper)
  return wrapper
}
async function fill(wrapper: VueWrapper, name = material.name, category = material.category) {
  await wrapper.get<HTMLInputElement>('#material-name').setValue(name)
  await wrapper.get<HTMLInputElement>('#material-category').setValue(category)
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
  it('shows loading then an empty state', async () => {
    const repository = fakeRepository()
    let resolveList: ((result: PersistenceResult<readonly Material[]>) => void) | undefined
    repository.list.mockReturnValue(new Promise((resolve) => { resolveList = resolve }))
    const wrapper = render(repository)
    expect(wrapper.text()).toContain('Loading materials')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    resolveList?.({ ok: true, value: [] })
    await flushPromises()
    expect(wrapper.text()).toContain('Your library starts here')
  })

  it('renders stored records with accessible actions', async () => {
    const repository = fakeRepository()
    repository.list.mockResolvedValue({ ok: true, value: [material] })
    const wrapper = render(repository)
    await flushPromises()
    expect(wrapper.get('tbody').text()).toContain(material.name)
    expect(wrapper.get('tbody').text()).toContain(material.category)
    expect(wrapper.find(`button[aria-label="Edit ${material.name}"]`).exists()).toBe(true)
  })

  it('validates required fields and focuses the first error without writing', async () => {
    const repository = fakeRepository()
    const wrapper = render(repository)
    await flushPromises()
    await fill(wrapper, '   ', '')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get<HTMLInputElement>('#material-name').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get<HTMLInputElement>('#material-category').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('#material-name-error').text()).not.toBe('')
    expect(wrapper.get('#material-category-error').text()).not.toBe('')
    expect(document.activeElement).toBe(wrapper.get<HTMLInputElement>('#material-name').element)
    expect(repository.create).not.toHaveBeenCalled()
  })

  it('creates a schema-validated material and rereads IndexedDB', async () => {
    const repository = fakeRepository()
    repository.list.mockResolvedValueOnce({ ok: true, value: [] }).mockResolvedValue({ ok: true, value: [material] })
    const wrapper = render(repository)
    await flushPromises()
    await fill(wrapper, ` ${material.name} `, ` ${material.category} `)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(repository.create).toHaveBeenCalledTimes(1)
    const created = materialSchema.parse(repository.create.mock.calls[0]?.[0])
    expect(created).toEqual({ id: created.id, name: material.name, category: material.category })
    expect(repository.list).toHaveBeenCalledTimes(2)
    expect(wrapper.get('tbody').text()).toContain(material.name)
    expect(wrapper.get('[role="status"]').text()).toBe('Material created.')
    expect(wrapper.get<HTMLInputElement>('#material-name').element.value).toBe('')
    expect(document.activeElement).toBe(wrapper.get<HTMLInputElement>('#material-name').element)
  })

  it('edits an existing material while retaining its stable ID', async () => {
    const repository = fakeRepository()
    repository.list.mockResolvedValueOnce({ ok: true, value: [material] }).mockResolvedValue({ ok: true, value: [updated] })
    const wrapper = render(repository)
    await flushPromises()
    await wrapper.get(`button[aria-label="Edit ${material.name}"]`).trigger('click')
    expect(wrapper.get<HTMLInputElement>('#material-name').element.value).toBe(material.name)
    await fill(wrapper, updated.name, updated.category)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(repository.update).toHaveBeenCalledExactlyOnceWith(material.id, updated)
    expect(repository.create).not.toHaveBeenCalled()
    expect(wrapper.get('tbody').text()).toContain(updated.name)
    expect(wrapper.get('[role="status"]').text()).toBe('Material updated.')
  })

  it('cancels editing without writing', async () => {
    const repository = fakeRepository()
    repository.list.mockResolvedValue({ ok: true, value: [material] })
    const wrapper = render(repository)
    await flushPromises()
    await wrapper.get(`button[aria-label="Edit ${material.name}"]`).trigger('click')
    await fill(wrapper, 'Unsaved', 'Unsaved')
    await button(wrapper, 'Cancel').trigger('click')
    expect(wrapper.get('#material-form-title').text()).toBe('New material')
    expect(wrapper.get<HTMLInputElement>('#material-name').element.value).toBe('')
    expect(repository.update).not.toHaveBeenCalled()
  })

  it('requires confirmation before deleting and refreshes after a confirmed deletion', async () => {
    const repository = fakeRepository()
    repository.list.mockResolvedValueOnce({ ok: true, value: [material] }).mockResolvedValue({ ok: true, value: [] })
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const wrapper = render(repository)
    await flushPromises()
    const action = wrapper.get(`button[aria-label="Delete ${material.name}"]`)
    await action.trigger('click')
    expect(confirmation).toHaveBeenCalledWith(expect.stringContaining(material.name))
    expect(repository.delete).not.toHaveBeenCalled()
    confirmation.mockReturnValue(true)
    await action.trigger('click')
    await flushPromises()
    expect(repository.delete).toHaveBeenCalledExactlyOnceWith(material.id)
    expect(wrapper.text()).toContain('Your library starts here')
    expect(wrapper.get('[role="status"]').text()).toBe('Material deleted.')
    expect(document.activeElement).toBe(wrapper.get<HTMLInputElement>('#material-name').element)
  })

  it('shows read errors and allows retry', async () => {
    const repository = fakeRepository()
    repository.list.mockResolvedValueOnce(storageFailure).mockResolvedValue({ ok: true, value: [material] })
    const wrapper = render(repository)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not access local storage')
    expect(wrapper.text()).not.toContain('Your library starts here')
    await button(wrapper, 'Try again').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('tbody').text()).toContain(material.name)
  })

  it('retains form input after create failure and supports a retry', async () => {
    const repository = fakeRepository()
    repository.create.mockResolvedValueOnce(storageFailure).mockResolvedValue({ ok: true, value: material })
    const wrapper = render(repository)
    await flushPromises()
    await fill(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not access local storage')
    expect(wrapper.get<HTMLInputElement>('#material-name').element.value).toBe(material.name)
    expect(repository.list).toHaveBeenCalledTimes(1)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toBe('Material created.')
  })

  it('reports a missing material during update without claiming success', async () => {
    const repository = fakeRepository()
    repository.list.mockResolvedValue({ ok: true, value: [material] })
    repository.update.mockResolvedValue({ ok: false, error: { kind: 'notFound', id: material.id } })
    const wrapper = render(repository)
    await flushPromises()
    await wrapper.get(`button[aria-label="Edit ${material.name}"]`).trigger('click')
    await fill(wrapper, updated.name, updated.category)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('no longer exists')
    expect(wrapper.get<HTMLInputElement>('#material-name').element.value).toBe(updated.name)
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })

  it('reports delete failure and keeps the material visible', async () => {
    const repository = fakeRepository()
    repository.list.mockResolvedValue({ ok: true, value: [material] })
    repository.delete.mockResolvedValue(storageFailure)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = render(repository)
    await flushPromises()
    await wrapper.get(`button[aria-label="Delete ${material.name}"]`).trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not access local storage')
    expect(wrapper.get('tbody').text()).toContain(material.name)
  })

  it('reports invalid saved records without showing an empty library', async () => {
    const repository = fakeRepository()
    repository.list.mockResolvedValue({ ok: false, error: { kind: 'invalidRecord', issues: [{ path: ['name'], message: 'Invalid name' }] } })
    const wrapper = render(repository)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Material data is invalid')
    expect(wrapper.text()).not.toContain('Your library starts here')
  })

  it('reports duplicate IDs and leaves the draft available', async () => {
    const repository = fakeRepository()
    repository.create.mockResolvedValue({ ok: false, error: { kind: 'duplicateId', id: material.id } })
    const wrapper = render(repository)
    await flushPromises()
    await fill(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('already exists')
    expect(wrapper.get<HTMLInputElement>('#material-name').element.value).toBe(material.name)
    expect(repository.list).toHaveBeenCalledTimes(1)
  })

  it('distinguishes a committed write from a failed library refresh', async () => {
    const repository = fakeRepository()
    repository.list.mockResolvedValueOnce({ ok: true, value: [] }).mockResolvedValue(storageFailure)
    const wrapper = render(repository)
    await flushPromises()
    await fill(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toBe('Material created.')
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not access local storage')
  })

  it('round-trips through the existing Dexie repositories across page remounts', async () => {
    const indexedDB = new IDBFactory()
    const first = createLocalPersistence('materials-ui-test', { indexedDB, IDBKeyRange })
    const second = createLocalPersistence('materials-ui-test', { indexedDB, IDBKeyRange })
    try {
      const wrapper = render(first.materials)
      await vi.waitFor(() => { expect(wrapper.text()).toContain('Your library starts here') })
      await fill(wrapper)
      await wrapper.get('form').trigger('submit')
      await vi.waitFor(() => { expect(wrapper.get('tbody').text()).toContain(material.name) })
      wrapper.unmount()
      first.close()
      const reopened = render(second.materials)
      await vi.waitFor(() => { expect(reopened.get('tbody').text()).toContain(material.name) })
    } finally {
      first.close()
      second.close()
    }
  })
})
