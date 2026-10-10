import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'

import { createAppRouter } from '../../../app/router'
import type { PersistenceResult, Repository } from '../../../application/persistence/repositories'
import { validMaterialInput, validPartInput } from '../../../domain/model/__tests__/fixtures'
import { materialSchema } from '../../../domain/model/material'
import { partSchema } from '../../../domain/model/part'
import { createLocalPersistence } from '../../../infrastructure/persistence/local-database'
import { materialRepositoryKey } from '../../materials/material-repository'
import PartsView from '../PartsView.vue'
import { partRepositoryKey } from '../part-repository'

const material = materialSchema.parse(validMaterialInput)
const part = partSchema.parse(validPartInput)
const updated = partSchema.parse({ ...part, name: 'Updated panel', quantity: 3, grainDirection: 'width', rotation: 'allowed' })
const wrappers: VueWrapper[] = []
const failure = { ok: false, error: { kind: 'storageFailure', message: 'Disk full' } } as const

function fakeRepository<Entity extends { id: string }>(record: Entity, records: readonly Entity[] = []) {
  return {
    create: vi.fn<Repository<Entity>['create']>().mockResolvedValue({ ok: true, value: record }),
    get: vi.fn<Repository<Entity>['get']>().mockResolvedValue({ ok: true, value: record }),
    update: vi.fn<Repository<Entity>['update']>().mockResolvedValue({ ok: true, value: record }),
    delete: vi.fn<Repository<Entity>['delete']>().mockResolvedValue({ ok: true, value: undefined }),
    list: vi.fn<Repository<Entity>['list']>().mockResolvedValue({ ok: true, value: records }),
  }
}
function setup() {
  return { parts: fakeRepository(part), materials: fakeRepository(material, [material]) }
}
function render(repositories: { parts: Repository<typeof part>; materials: Repository<typeof material> }) {
  const wrapper = mount(PartsView, {
    attachTo: document.body,
    global: {
      plugins: [createAppRouter(createMemoryHistory())],
      provide: { [partRepositoryKey]: repositories.parts, [materialRepositoryKey]: repositories.materials },
    },
  })
  wrappers.push(wrapper)
  return wrapper
}
async function fill(wrapper: VueWrapper) {
  await wrapper.get('#part-name').setValue(part.name)
  await wrapper.get('#part-material').setValue(material.id)
  await wrapper.get('#part-length').setValue(String(part.lengthMm))
  await wrapper.get('#part-width').setValue(String(part.widthMm))
  await wrapper.get('#part-thickness').setValue(String(part.thicknessMm))
  await wrapper.get('#part-quantity').setValue(String(part.quantity))
  await wrapper.get('#part-grain').setValue(part.grainDirection)
  await wrapper.get('#part-rotation').setValue(part.rotation)
}
async function submit(wrapper: VueWrapper) {
  await wrapper.get('form').trigger('submit')
  await flushPromises()
}
function button(wrapper: VueWrapper, text: string) {
  const result = wrapper.findAll('button').find((candidate) => candidate.text() === text)
  if (!result) throw new Error(`Missing button ${text}`)
  return result
}
afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  wrappers.length = 0
  vi.restoreAllMocks()
})

describe('PartsView', () => {
  it('shows loading, disables writes, and then shows an empty library', async () => {
    const repositories = setup()
    let resolve: ((result: PersistenceResult<readonly typeof part[]>) => void) | undefined
    repositories.parts.list.mockReturnValue(new Promise((done) => { resolve = done }))
    const wrapper = render(repositories)
    expect(wrapper.text()).toContain('Loading parts…')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    resolve?.({ ok: true, value: [] })
    await flushPromises()
    expect(wrapper.text()).toContain('No parts yet')
  })

  it('renders every dimension, quantity, material and orientation constraint', async () => {
    const repositories = setup()
    repositories.parts.list.mockResolvedValue({ ok: true, value: [part] })
    const wrapper = render(repositories)
    await flushPromises()
    const table = wrapper.get('table')
    for (const text of [part.name, material.name, '720 × 560 × 18', '2', 'Along length', 'Forbidden']) {
      expect(table.text()).toContain(text)
    }
    expect(wrapper.get('[role="region"]').attributes('tabindex')).toBe('0')
  })

  it('validates required fields and focuses the first error without writing', async () => {
    const repositories = setup()
    const wrapper = render(repositories)
    await flushPromises()
    await wrapper.get('#part-quantity').setValue('')
    await submit(wrapper)
    for (const field of ['name', 'material', 'length', 'width', 'thickness', 'quantity']) {
      expect(wrapper.get(`#part-${field}`).attributes('aria-invalid')).toBe('true')
      expect(wrapper.get(`#part-${field}-error`).text()).not.toBe('')
      expect(wrapper.get(`#part-${field}`).attributes('required')).toBeDefined()
    }
    expect(document.activeElement).toBe(wrapper.get('#part-name').element)
    expect(repositories.parts.create).not.toHaveBeenCalled()
  })

  it.each(['length', 'width', 'thickness'])('rejects empty, zero, negative and nonnumeric %s', async (field) => {
    const repositories = setup()
    const wrapper = render(repositories)
    await flushPromises()
    await fill(wrapper)
    for (const invalid of ['', '0', '-1', 'not a number']) {
      await wrapper.get(`#part-${field}`).setValue(invalid)
      await submit(wrapper)
      expect(wrapper.get(`#part-${field}`).attributes('aria-invalid')).toBe('true')
    }
    expect(repositories.parts.create).not.toHaveBeenCalled()
  })

  it.each(['', '0', '-1', '1.5', '9007199254740992', 'not a number'])('rejects invalid quantity %j', async (quantity) => {
    const repositories = setup()
    const wrapper = render(repositories)
    await flushPromises()
    await fill(wrapper)
    await wrapper.get('#part-quantity').setValue(quantity)
    await submit(wrapper)
    expect(wrapper.get('#part-quantity').attributes('aria-invalid')).toBe('true')
    expect(repositories.parts.create).not.toHaveBeenCalled()
  })

  it('requires material selection and never chooses one silently', async () => {
    const repositories = setup()
    const wrapper = render(repositories)
    await flushPromises()
    await fill(wrapper)
    await wrapper.get('#part-material').setValue('')
    await submit(wrapper)
    expect(wrapper.get('#part-material-error').text()).toBe('Choose an existing material.')
    expect(repositories.parts.create).not.toHaveBeenCalled()
  })

  it('saves the explicitly chosen alternative material', async () => {
    const repositories = setup()
    const alternative = materialSchema.parse({ ...material, id: 'mat-mdf', name: 'MDF' })
    repositories.materials.list.mockResolvedValue({ ok: true, value: [material, alternative] })
    repositories.materials.get.mockResolvedValue({ ok: true, value: alternative })
    const wrapper = render(repositories)
    await flushPromises()
    await fill(wrapper)
    await wrapper.get('#part-material').setValue(alternative.id)
    await submit(wrapper)
    const created = partSchema.parse(repositories.parts.create.mock.calls[0]?.[0])
    expect(created.materialId).toBe(alternative.id)
    expect(repositories.materials.get).toHaveBeenCalledExactlyOnceWith(alternative.id)
  })

  it.each(['grain', 'rotation'])('rejects invalid %s values through the existing schema', async (field) => {
    const repositories = setup()
    const wrapper = render(repositories)
    await flushPromises()
    await fill(wrapper)
    const select = wrapper.get<HTMLSelectElement>(`#part-${field}`)
    select.element.add(new Option('Invalid', 'invalid'))
    await select.setValue('invalid')
    await submit(wrapper)
    expect(select.attributes('aria-invalid')).toBe('true')
    expect(repositories.parts.create).not.toHaveBeenCalled()
  })

  it('directs users to Materials when none exist and prevents saving', async () => {
    const repositories = setup()
    repositories.materials.list.mockResolvedValue({ ok: true, value: [] })
    const wrapper = render(repositories)
    await flushPromises()
    expect(wrapper.text()).toContain('Add a material before creating or editing parts')
    expect(wrapper.get('a').attributes('href')).toBe('/materials')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    await submit(wrapper)
    expect(repositories.parts.create).not.toHaveBeenCalled()
  })

  it('creates a validated part, rereads storage, and clears the draft', async () => {
    const repositories = setup()
    repositories.parts.list.mockResolvedValueOnce({ ok: true, value: [] }).mockResolvedValue({ ok: true, value: [part] })
    const wrapper = render(repositories)
    await flushPromises()
    await fill(wrapper)
    await wrapper.get('#part-name').setValue(` ${part.name} `)
    await wrapper.get('#part-thickness').setValue('18.5')
    await submit(wrapper)
    const created = partSchema.parse(repositories.parts.create.mock.calls[0]?.[0])
    expect(created).toEqual({ ...part, id: created.id, thicknessMm: 18.5 })
    expect(repositories.materials.get).toHaveBeenCalledExactlyOnceWith(material.id)
    expect(repositories.parts.list).toHaveBeenCalledTimes(2)
    expect(wrapper.get('tbody').text()).toContain(part.name)
    expect(wrapper.get('[role="status"]').text()).toBe('Part created.')
    expect(wrapper.get<HTMLInputElement>('#part-name').element.value).toBe('')
    expect(document.activeElement).toBe(wrapper.get('#part-name').element)
  })

  it('edits with a stable ID and preserves all constraints', async () => {
    const repositories = setup()
    repositories.parts.list.mockResolvedValueOnce({ ok: true, value: [part] }).mockResolvedValue({ ok: true, value: [updated] })
    const wrapper = render(repositories)
    await flushPromises()
    await wrapper.get(`button[aria-label="Edit ${part.name}"]`).trigger('click')
    expect(wrapper.get<HTMLInputElement>('#part-thickness').element.value).toBe('18')
    expect(wrapper.get<HTMLSelectElement>('#part-rotation').element.value).toBe('forbidden')
    await wrapper.get('#part-name').setValue(updated.name)
    await wrapper.get('#part-quantity').setValue('3')
    await wrapper.get('#part-grain').setValue('width')
    await wrapper.get('#part-rotation').setValue('allowed')
    await submit(wrapper)
    expect(repositories.parts.update).toHaveBeenCalledExactlyOnceWith(part.id, updated)
    expect(repositories.parts.create).not.toHaveBeenCalled()
    expect(wrapper.get('tbody').text()).toContain(updated.name)
    expect(wrapper.get('[role="status"]').text()).toBe('Part updated.')
  })

  it('cancels an edit without writing', async () => {
    const repositories = setup()
    repositories.parts.list.mockResolvedValue({ ok: true, value: [part] })
    const wrapper = render(repositories)
    await flushPromises()
    await wrapper.get(`button[aria-label="Edit ${part.name}"]`).trigger('click')
    await wrapper.get('#part-name').setValue('Unsaved')
    await button(wrapper, 'Cancel').trigger('click')
    expect(wrapper.get('#part-form-title').text()).toBe('New part')
    expect(wrapper.get<HTMLInputElement>('#part-name').element.value).toBe('')
    expect(repositories.parts.update).not.toHaveBeenCalled()
  })

  it('requires confirmation and clears an edited part after deleting it', async () => {
    const repositories = setup()
    repositories.parts.list.mockResolvedValueOnce({ ok: true, value: [part] }).mockResolvedValue({ ok: true, value: [] })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const wrapper = render(repositories)
    await flushPromises()
    await wrapper.get(`button[aria-label="Edit ${part.name}"]`).trigger('click')
    const action = wrapper.get(`button[aria-label="Delete ${part.name}"]`)
    await action.trigger('click')
    expect(repositories.parts.delete).not.toHaveBeenCalled()
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining(part.name))
    confirm.mockReturnValue(true)
    await action.trigger('click')
    await flushPromises()
    expect(repositories.parts.delete).toHaveBeenCalledExactlyOnceWith(part.id)
    expect(wrapper.text()).toContain('No parts yet')
    expect(wrapper.get('#part-form-title').text()).toBe('New part')
    expect(wrapper.get('[role="status"]').text()).toBe('Part deleted.')
    expect(document.activeElement).toBe(wrapper.get('#part-name').element)
  })

  it('handles read errors with retry without claiming the library is empty', async () => {
    const repositories = setup()
    repositories.parts.list.mockResolvedValueOnce(failure).mockResolvedValue({ ok: true, value: [part] })
    const wrapper = render(repositories)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not access local storage')
    expect(wrapper.text()).not.toContain('No parts yet')
    await button(wrapper, 'Try again').trigger('click')
    await flushPromises()
    expect(wrapper.get('tbody').text()).toContain(part.name)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('handles material read failure explicitly and allows retry', async () => {
    const repositories = setup()
    repositories.parts.list.mockResolvedValue({ ok: true, value: [part] })
    repositories.materials.list.mockResolvedValueOnce(failure).mockResolvedValue({ ok: true, value: [material] })
    const wrapper = render(repositories)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not load materials')
    expect(wrapper.get('tbody').text()).toContain('Material unavailable')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    await button(wrapper, 'Retry loading').trigger('click')
    await flushPromises()
    expect(wrapper.get('tbody').text()).toContain(material.name)
  })

  it('makes orphaned material references explicit and requires a replacement', async () => {
    const repositories = setup()
    const orphan = partSchema.parse({ ...part, materialId: 'deleted-material' })
    repositories.parts.list.mockResolvedValue({ ok: true, value: [orphan] })
    const wrapper = render(repositories)
    await flushPromises()
    expect(wrapper.get('tbody').text()).toContain('Missing material')
    await wrapper.get(`button[aria-label="Edit ${part.name}"]`).trigger('click')
    await submit(wrapper)
    expect(wrapper.get('#part-material-error').text()).toBe('Choose an existing material.')
    expect(repositories.parts.update).not.toHaveBeenCalled()
    await wrapper.get('#part-material').setValue(material.id)
    await submit(wrapper)
    expect(repositories.parts.update).toHaveBeenCalledExactlyOnceWith(part.id, part)
  })

  it('rejects a material deleted since loading and preserves the draft', async () => {
    const repositories = setup()
    repositories.materials.get.mockResolvedValue({ ok: false, error: { kind: 'notFound', id: material.id } })
    const wrapper = render(repositories)
    await flushPromises()
    await fill(wrapper)
    await submit(wrapper)
    expect(wrapper.get('[role="alert"]').text()).toContain('selected material no longer exists')
    expect(wrapper.get<HTMLInputElement>('#part-name').element.value).toBe(part.name)
    expect(repositories.parts.create).not.toHaveBeenCalled()
  })

  it.each(['storageFailure', 'duplicateId', 'invalidRecord'] as const)('retains drafts after create %s and supports retry', async (kind) => {
    const repositories = setup()
    const error = kind === 'storageFailure' ? failure.error
      : kind === 'duplicateId' ? { kind, id: part.id }
        : { kind, issues: [{ path: ['quantity'], message: 'Invalid quantity' }] }
    repositories.parts.create.mockResolvedValueOnce({ ok: false, error })
    const wrapper = render(repositories)
    await flushPromises()
    await fill(wrapper)
    await submit(wrapper)
    expect(wrapper.get('[role="alert"]').text()).not.toBe('')
    expect(wrapper.get<HTMLInputElement>('#part-name').element.value).toBe(part.name)
    expect(repositories.parts.list).toHaveBeenCalledTimes(1)
    await submit(wrapper)
    expect(wrapper.get('[role="status"]').text()).toBe('Part created.')
  })

  it('retains edits if the part was removed before updating', async () => {
    const repositories = setup()
    repositories.parts.list.mockResolvedValue({ ok: true, value: [part] })
    repositories.parts.update.mockResolvedValue({ ok: false, error: { kind: 'notFound', id: part.id } })
    const wrapper = render(repositories)
    await flushPromises()
    await wrapper.get(`button[aria-label="Edit ${part.name}"]`).trigger('click')
    await wrapper.get('#part-name').setValue(updated.name)
    await submit(wrapper)
    expect(wrapper.get('[role="alert"]').text()).toContain('no longer exists')
    expect(wrapper.get<HTMLInputElement>('#part-name').element.value).toBe(updated.name)
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })

  it('keeps records visible after delete failure', async () => {
    const repositories = setup()
    repositories.parts.list.mockResolvedValue({ ok: true, value: [part] })
    repositories.parts.delete.mockResolvedValue(failure)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = render(repositories)
    await flushPromises()
    await wrapper.get(`button[aria-label="Delete ${part.name}"]`).trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not access local storage')
    expect(wrapper.get('tbody').text()).toContain(part.name)
  })

  it('prevents duplicate submissions while a write is pending', async () => {
    const repositories = setup()
    let resolve: ((result: PersistenceResult<typeof part>) => void) | undefined
    repositories.parts.create.mockReturnValue(new Promise((done) => { resolve = done }))
    const wrapper = render(repositories)
    await flushPromises()
    await fill(wrapper)
    await submit(wrapper)
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    await submit(wrapper)
    expect(repositories.parts.create).toHaveBeenCalledTimes(1)
    resolve?.({ ok: true, value: part })
    await flushPromises()
  })

  it('distinguishes a committed write from a failed refresh', async () => {
    const repositories = setup()
    repositories.parts.list.mockResolvedValueOnce({ ok: true, value: [] }).mockResolvedValue(failure)
    const wrapper = render(repositories)
    await flushPromises()
    await fill(wrapper)
    await submit(wrapper)
    expect(wrapper.get('[role="status"]').text()).toBe('Part created.')
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not access local storage')
  })

  it('persists through the existing Dexie adapter across connections and remounts', async () => {
    const indexedDB = new IDBFactory()
    const first = createLocalPersistence('parts-ui-test', { indexedDB, IDBKeyRange })
    const second = createLocalPersistence('parts-ui-test', { indexedDB, IDBKeyRange })
    try {
      expect((await first.materials.create(material)).ok).toBe(true)
      const wrapper = render(first)
      await vi.waitFor(() => { expect(wrapper.text()).toContain('No parts yet') })
      await fill(wrapper)
      await wrapper.get('form').trigger('submit')
      await vi.waitFor(() => { expect(wrapper.get('tbody').text()).toContain(part.name) })
      wrapper.unmount()
      first.close()
      const reopened = render(second)
      await vi.waitFor(() => { expect(reopened.get('tbody').text()).toContain('720 × 560 × 18') })
    } finally {
      first.close()
      second.close()
    }
  })
})
