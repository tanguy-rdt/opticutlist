import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'

import { createAppRouter } from '../../../app/router'
import { createProjectService } from '../../../application/projects/project-service'
import { cuttingProjectSchema } from '../../../domain/model/cutting-project'
import { cuttingProjectIdSchema } from '../../../domain/model/ids'
import { supplierSchema } from '../../../domain/model/supplier'
import { supplierProductSchema } from '../../../domain/model/supplier-product'
import { projectIdKey, projectServiceKey } from '../../projects/project-service'
import { supplierRepositoryKey, supplierProductRepositoryKey } from '../../suppliers/catalog-repositories'
import type { PersistenceResult, Repository } from '../../../application/persistence/repositories'
import { validMaterialInput, validPartInput, validSupplierInput, validSupplierProductInput, validStockItemInput } from '../../../domain/model/__tests__/fixtures'
import { materialSchema } from '../../../domain/model/material'
import { partSchema } from '../../../domain/model/part'
import { createLocalPersistence } from '../../../infrastructure/persistence/local-database'
import { materialRepositoryKey } from '../../materials/material-repository'
import MaterialSelector from '../../materials/MaterialSelector.vue'
import PartsView from '../PartsView.vue'
import AppSplitButton from '../../../shared/ui/AppSplitButton.vue'
import PartsJsonTransfer from '../PartsJsonTransfer.vue'
import { partsTransferServiceKey } from '../parts-transfer-service'
import type { PartsTransferService } from '../../../application/projects/parts-transfer-service'
import { stockRepositoryKey } from '../../inventory/stock-repository'
import { stockItemSchema, type StockItem } from '../../../domain/model/stock-item'
import { partRepositoryKey } from '../part-repository'

const projectId = cuttingProjectIdSchema.parse('parts-project')
const project = cuttingProjectSchema.parse({ id: projectId, name: 'Workshop', partIds: [], materialIds: [validMaterialInput.id, 'mat-mdf'], supplierProductIds: [] })
const material = materialSchema.parse(validMaterialInput)
const part = partSchema.parse(validPartInput)
const updated = partSchema.parse({ ...part, name: 'Updated panel', quantity: 3, grainDirection: 'width', rotation: 'forbidden' })
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
  return { parts: fakeRepository(part), materials: fakeRepository(material, [material]), projects: fakeRepository(project), products: fakeRepository(supplierProductSchema.parse(validSupplierProductInput)) }
}
function render(repositories: { parts: Repository<typeof part>; materials: Repository<typeof material>; projects?: Repository<typeof project>; products?: Repository<ReturnType<typeof supplierProductSchema.parse>>; stock?: Repository<StockItem> }, transfer?: PartsTransferService) {
  const wrapper = mount(PartsView, {
    attachTo: document.body,
    global: {
      plugins: [createAppRouter(createMemoryHistory())],
      provide: {
        ...(transfer ? { [partsTransferServiceKey]: transfer } : {}),
        ...(repositories.stock ? { [stockRepositoryKey]: repositories.stock } : {}),
        [partRepositoryKey]: repositories.parts, [materialRepositoryKey]: repositories.materials,
        [projectIdKey]: projectId,
        [projectServiceKey]: { projects: repositories.projects ?? fakeRepository(project) },
        [supplierRepositoryKey]: fakeRepository(supplierSchema.parse(validSupplierInput)),
        [supplierProductRepositoryKey]: repositories.products ?? fakeRepository(supplierProductSchema.parse(validSupplierProductInput)),
      },
    },
  })
  wrappers.push(wrapper)
  return wrapper
}
async function chooseMaterial(wrapper: VueWrapper, id: string) {
  await wrapper.get('#part-material').trigger('click')
  const option = wrapper.findAll('[role="option"]').find(option => option.attributes('data-value') === id)
  if (!option) throw new Error('Missing material option')
  await option.trigger('click')
}
async function fill(wrapper: VueWrapper) {
  if (!wrapper.find('#part-name').exists()) { await button(wrapper, 'New part').trigger('click'); await flushPromises() }
  await wrapper.get('#part-name').setValue(part.name)
  await chooseMaterial(wrapper, material.id)
  await wrapper.get('#part-length').setValue(String(part.lengthMm))
  await wrapper.get('#part-width').setValue(String(part.widthMm))
  await wrapper.get('#part-thickness').setValue(String(part.thicknessMm))
  await wrapper.get('#part-quantity').setValue(String(part.quantity))
  await wrapper.get('#part-rotation').setValue(part.rotation)
  await wrapper.get('#part-grain').setValue(part.grainDirection)
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
  it('reloads once after a successful import while preserving search without a manual Refresh action', async () => {
    const repositories = setup()
    const wrapper = render(repositories); await flushPromises()
    expect(repositories.parts.list).toHaveBeenCalledTimes(1)
    expect(wrapper.findAll('button').some(control => control.text() === 'Refresh')).toBe(false)
    await wrapper.get('input[aria-label="Search parts by name"]').setValue(part.name)
    repositories.parts.list.mockResolvedValue({ ok: true, value: [part] })
    wrapper.findComponent(PartsJsonTransfer).vm.$emit('imported')
    await flushPromises()
    expect(repositories.parts.list).toHaveBeenCalledTimes(2)
    expect(wrapper.get('tbody').text()).toContain(part.name)
    expect(wrapper.get<HTMLInputElement>('input[aria-label="Search parts by name"]').element.value).toBe(part.name)
  })

  it('shows loading, disables writes, and then shows an empty library', async () => {
    const repositories = setup()
    let resolve: ((result: PersistenceResult<readonly typeof part[]>) => void) | undefined
    repositories.parts.list.mockReturnValue(new Promise((done) => { resolve = done }))
    const wrapper = render(repositories)
    expect(wrapper.text()).toContain('Loading parts…')
    expect(button(wrapper, 'New part').attributes('disabled')).toBeDefined()
    resolve?.({ ok: true, value: [] })
    await flushPromises()
    expect(wrapper.text()).toContain('No parts yet')
  })

  it('keeps the table compact while preserving dimensions and orientation constraints in details', async () => {
    const repositories = setup()
    repositories.parts.list.mockResolvedValue({ ok: true, value: [part] })
    const wrapper = render(repositories)
    await flushPromises()
    const table = wrapper.get('table')
    for (const text of [part.name, material.name, '720 × 560', '18', '2']) {
      expect(table.text()).toContain(text)
    }
    expect(table.findAll('thead th').map(cell => cell.text())).toEqual(['Part', 'Material', 'Dimensions (mm)', 'Thickness (mm)', 'Quantity', 'Actions'])
    expect(table.findAll('tbody tr')[0]?.findAll('th, td')).toHaveLength(6)
    expect(table.text()).not.toContain('Along length')
    expect(table.text()).not.toContain('Forbidden')
    const details = wrapper.get('[aria-label="Part details"]')
    expect(details.text()).toContain('Grain direction')
    expect(details.text()).toContain('Along length')
    expect(details.text()).toContain('90° rotation')
    expect(details.text()).toContain('Forbidden')
    expect(wrapper.get('[role="region"]').attributes('tabindex')).toBe('0')
  })

  it('validates required fields and focuses the first error without writing', async () => {
    const repositories = setup()
    const wrapper = render(repositories)
    await flushPromises()
    await button(wrapper, 'New part').trigger('click')
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
    wrapper.findComponent(MaterialSelector).vm.$emit('update:modelValue', '')
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
    await chooseMaterial(wrapper, alternative.id)
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
    if (field === 'rotation') await wrapper.get('#part-grain').setValue('none')
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
    expect(wrapper.text()).toContain('Select materials for this project')
    expect(wrapper.get('a').attributes('href')).toBe('/projects/parts-project/materials')
    expect(button(wrapper, 'New part').attributes('disabled')).toBeDefined()
    expect(wrapper.find('form').exists()).toBe(false)
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
    expect(wrapper.find('dialog').exists()).toBe(false)
  })

  it('edits with a stable ID and preserves all constraints', async () => {
    const repositories = setup()
    repositories.parts.list.mockResolvedValueOnce({ ok: true, value: [part] }).mockResolvedValue({ ok: true, value: [updated] })
    const wrapper = render(repositories)
    await flushPromises()
    await wrapper.get(`button[aria-label="Edit ${part.name}"]`).trigger('click')
    expect(wrapper.get<HTMLInputElement>('#part-thickness').element.value).toBe('18')
    expect(wrapper.find('#part-rotation').exists()).toBe(false)
    await wrapper.get('#part-name').setValue(updated.name)
    await wrapper.get('#part-quantity').setValue('3')
    await wrapper.get('#part-grain').setValue('width')
    expect(wrapper.find('#part-rotation').exists()).toBe(false)
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
    expect(wrapper.find('dialog').exists()).toBe(false)
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
    expect(wrapper.find('dialog').exists()).toBe(false)
    expect(wrapper.get('[role="status"]').text()).toBe('Part deleted.')
    expect(wrapper.find('dialog').exists()).toBe(false)
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
    expect(button(wrapper, 'New part').attributes('disabled')).toBeDefined()
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
    await chooseMaterial(wrapper, material.id)
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
    expect(wrapper.get('[aria-label="Close part form"]').attributes('disabled')).toBeDefined()
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
      expect((await first.projects.create(project)).ok).toBe(true)
      const otherProject = cuttingProjectSchema.parse({ ...project, id: 'other-project' })
      expect((await first.projects.create(otherProject)).ok).toBe(true)
      const unrelated = partSchema.parse({ ...part, id: 'unrelated-part', name: 'Other project only' })
      expect((await createProjectService(first).parts(otherProject.id).create(unrelated)).ok).toBe(true)
      const firstService = createProjectService(first)
      const wrapper = render({ ...first, parts: firstService.parts(projectId) })
      await vi.waitFor(() => { expect(wrapper.text()).toContain('No parts yet') })
      await fill(wrapper)
      await wrapper.get('form').trigger('submit')
      await vi.waitFor(() => { expect(wrapper.get('tbody').text()).toContain(part.name) })
      wrapper.unmount()
      first.close()
      const reopened = render({ ...second, parts: createProjectService(second).parts(projectId) })
      await vi.waitFor(() => { expect(reopened.get('tbody').text()).toContain('720 × 560') })
      expect(reopened.text()).not.toContain('Other project only')
      expect(await second.parts.get(unrelated.id)).toEqual({ ok: true, value: unrelated })
      const owner = await second.projects.get(projectId)
      expect(owner.ok && owner.value.materialIds).toEqual(project.materialIds)
      expect((await second.stockItems.list())).toEqual({ ok: true, value: [] })
    } finally {
      first.close()
      second.close()
    }
  })
  it('selects parts by stable ID, updates details and searches by name', async () => {
    const repositories = setup()
    const secondPart = partSchema.parse({ ...part, id: 'second-part', name: 'Shelf', lengthMm: 300, widthMm: 100, grainDirection: 'width' })
    repositories.parts.list.mockResolvedValue({ ok: true, value: [part, secondPart] })
    const wrapper = render(repositories)
    await flushPromises()
    expect(wrapper.get('aside').text()).toContain(part.name)
    await wrapper.get('button[aria-label="Select Shelf"]').trigger('click')
    expect(wrapper.get('aside').text()).toContain('Shelf')
    expect(wrapper.get('button[aria-label="Select Shelf"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-grain="width"]').exists()).toBe(true)
    await wrapper.get('[aria-label="Search parts by name"]').setValue('shelf')
    expect(wrapper.get('tbody').findAll('tr')).toHaveLength(1)
    await wrapper.get('[aria-label="Search parts by name"]').setValue('missing')
    expect(wrapper.text()).toContain('No parts match your search.')
    expect(wrapper.find('table').exists()).toBe(false)
  })

  it('reuses the shared split button for independent creation and accessible import actions', async () => {
    const repositories = setup()
    const transfer = { preview: vi.fn<PartsTransferService['preview']>(), import: vi.fn<PartsTransferService['import']>() }
    const wrapper = render(repositories, transfer); await flushPromises()
    expect(wrapper.findComponent(AppSplitButton).exists()).toBe(true)
    expect(wrapper.findAll('button').filter(control => control.text() === 'Import JSON')).toHaveLength(0)
    expect(wrapper.findAll('button').some(control => control.text() === 'Export JSON')).toBe(false)
    await button(wrapper, 'New part').trigger('click')
    expect(wrapper.get('dialog h2').text()).toBe('New part')
    expect(transfer.preview).not.toHaveBeenCalled()
    await wrapper.get('[aria-label="Close part form"]').trigger('click')
    const trigger = wrapper.get('button[aria-label="More part actions"]')
    await trigger.trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.get('[role="menuitem"]').text()).toBe('Import parts')
    expect(document.activeElement).toBe(wrapper.get('[role="menuitem"]').element)
    await wrapper.get('[role="menuitem"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    expect(document.activeElement).toBe(trigger.element)
    await trigger.trigger('click')
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await flushPromises()
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    await trigger.trigger('click')
    await wrapper.get('[role="menuitem"]').trigger('click')
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    expect(wrapper.get('dialog h2').text()).toBe('Import Parts JSON')
    expect(wrapper.find('#parts-json-file').exists()).toBe(true)
    expect(wrapper.find('#part-name').exists()).toBe(false)
    await wrapper.get('dialog').trigger('cancel')
    expect(wrapper.find('dialog').exists()).toBe(false)
    expect(repositories.parts.create).not.toHaveBeenCalled()
    expect(transfer.import).not.toHaveBeenCalled()
  })

  it('opens and closes the drawer without writes, restoring trigger focus', async () => {
    const repositories = setup()
    const wrapper = render(repositories)
    await flushPromises()
    expect(wrapper.find('form').exists()).toBe(false)
    const trigger = button(wrapper, 'New part')
    trigger.element.focus()
    await trigger.trigger('click')
    await flushPromises()
    expect(wrapper.get('dialog').classes()).toContain('h-dvh')
    expect(wrapper.get('dialog h2').text()).toBe('New part')
    await wrapper.get('#part-name').setValue('Uncommitted')
    await wrapper.get('[aria-label="Close part form"]').trigger('click')
    expect(wrapper.find('dialog').exists()).toBe(false)
    expect(document.activeElement).toBe(trigger.element)
    await trigger.trigger('click')
    expect(wrapper.get<HTMLInputElement>('#part-name').element.value).toBe('')
    await wrapper.get('dialog').trigger('cancel')
    expect(wrapper.find('dialog').exists()).toBe(false)
    expect(repositories.parts.create).not.toHaveBeenCalled()
  })

  it('offers only project selections, including selected products, without catalog creation', async () => {
    const repositories = setup()
    const alternative = materialSchema.parse({ ...material, id: 'product-material', name: 'Selected plywood', libraryPresetId: 'contreplaque' })
    const outside = materialSchema.parse({ ...material, id: 'other-project-material', name: 'Other project' })
    const product = supplierProductSchema.parse({ ...validSupplierProductInput, materialId: alternative.id })
    repositories.materials.list.mockResolvedValue({ ok: true, value: [material, alternative, outside] })
    repositories.products.list.mockResolvedValue({ ok: true, value: [product] })
    repositories.projects.get.mockResolvedValue({ ok: true, value: { ...project, materialIds: [material.id], supplierProductIds: [product.id] } })
    const wrapper = render(repositories)
    await flushPromises()
    await button(wrapper, 'New part').trigger('click')
    await wrapper.get('#part-material').trigger('click')
    expect(wrapper.findAll('[role="option"]').map(option => option.text())).toEqual([material.name, alternative.name])
    expect(wrapper.text()).not.toContain('Create custom material')
    expect(wrapper.text()).not.toContain(outside.name)
    expect(repositories.materials.create).not.toHaveBeenCalled()
    expect(repositories.projects.update).not.toHaveBeenCalled()
    expect(wrapper.findComponent(MaterialSelector).props('allowCustomCreation')).toBe(false)
  })

  it.each([
    { name: 'catalogue only', catalog: true, stockCount: 0, origin: 'manual', expected: true },
    { name: 'stock only', catalog: false, stockCount: 1, origin: 'manual', expected: true },
    { name: 'both sources', catalog: true, stockCount: 1, origin: 'manual', expected: true },
    { name: 'another project offcut', catalog: false, stockCount: 1, origin: 'other-project', expected: true },
    { name: 'several stock sources for one material', catalog: false, stockCount: 2, origin: 'manual', expected: true },
    { name: 'no selected panels', catalog: false, stockCount: 0, origin: 'manual', expected: false },
    { name: 'own project offcut', catalog: false, stockCount: 1, origin: projectId, expected: false },
  ])('derives Parts material eligibility for $name', async ({ catalog, stockCount, origin, expected }) => {
    const repositories = setup()
    const stock = Array.from({ length: stockCount }, (_, index) => stockItemSchema.parse({ ...validStockItemInput, id: `selected-stock-${String(index)}`, provenance: origin === 'manual' ? { source: 'manual' } : { source: 'cutting', projectId: origin, savedPlanId: 'origin-plan', supplierProductId: validSupplierProductInput.id, panelIndex: 0, wasteIndex: index } }))
    const selected = cuttingProjectSchema.parse({ ...project, materialIds: [], supplierProductIds: catalog ? [validSupplierProductInput.id] : [], stockItemIds: stock.map(item => item.id) })
    repositories.projects.get.mockResolvedValue({ ok: true, value: selected })
    repositories.products.list.mockResolvedValue({ ok: true, value: [supplierProductSchema.parse(validSupplierProductInput)] })
    const inventory = fakeRepository(stockItemSchema.parse(validStockItemInput), stock)
    for (let pass = 0; pass < 2; pass++) {
      const wrapper = render({ ...repositories, stock: inventory })
      await flushPromises()
      expect(button(wrapper, 'New part').attributes('disabled') === undefined).toBe(expected)
      if (expected) {
        await fill(wrapper)
        await wrapper.get('#part-material').trigger('click')
        expect(wrapper.findAll('[role="option"]').map(option => option.attributes('data-value'))).toEqual([material.id])
        await wrapper.get('input[role="combobox"]').trigger('keydown', { key: 'Escape' })
        await submit(wrapper)
        expect(repositories.parts.create).toHaveBeenCalledWith(expect.objectContaining({ materialId: material.id, thicknessMm: part.thicknessMm }))
      } else expect(wrapper.text()).toContain('Select materials')
      wrapper.unmount()
    }
    expect(inventory.update).not.toHaveBeenCalled()
    expect(repositories.projects.update).not.toHaveBeenCalled()
  })

  it('rechecks project selections and retains a draft after a material is deselected', async () => {
    const repositories = setup()
    const wrapper = render(repositories)
    await flushPromises()
    await fill(wrapper)
    repositories.projects.get.mockResolvedValue({ ok: true, value: { ...project, materialIds: [] } })
    await submit(wrapper)
    expect(wrapper.get('[role="alert"]').text()).toContain('no longer available to this project')
    expect(wrapper.get<HTMLInputElement>('#part-name').element.value).toBe(part.name)
    expect(repositories.parts.create).not.toHaveBeenCalled()
    expect(repositories.materials.create).not.toHaveBeenCalled()
  })

  it('preserves parts outside current selections while requiring an explicit replacement on edit', async () => {
    const repositories = setup()
    const outside = materialSchema.parse({ ...material, id: 'historic-material', name: 'Historic oak' })
    const historicPart = partSchema.parse({ ...part, materialId: outside.id })
    repositories.materials.list.mockResolvedValue({ ok: true, value: [material, outside] })
    repositories.parts.list.mockResolvedValue({ ok: true, value: [historicPart] })
    const wrapper = render(repositories)
    await flushPromises()
    expect(wrapper.get('tbody').text()).toContain(outside.name)
    expect(wrapper.get('aside').text()).toContain('saved association has been preserved')
    await wrapper.get(`button[aria-label="Edit ${part.name}"]`).trigger('click')
    await submit(wrapper)
    expect(wrapper.get('#part-material-error').text()).toContain('Choose an existing material')
    expect(repositories.parts.update).not.toHaveBeenCalled()
    expect(historicPart.materialId).toBe(outside.id)
  })

  it('keeps workspace and field groups responsive without changing navigation', async () => {
    const repositories = setup()
    repositories.parts.list.mockResolvedValue({ ok: true, value: [part] })
    const wrapper = render(repositories)
    await flushPromises()
    expect(wrapper.findAll('div').some(element => element.classes().includes('xl:grid-cols-[minmax(0,1fr)_320px]'))).toBe(true)
    await button(wrapper, 'New part').trigger('click')
    expect(wrapper.get('#part-length').element.parentElement?.parentElement?.classList.contains('sm:grid-cols-2')).toBe(true)
    expect(wrapper.findComponent(MaterialSelector).exists()).toBe(true)
  })

  it('uses shared picker search and keyboard selection only within allowed materials', async () => {
    const repositories = setup()
    const second = materialSchema.parse({ ...material, id: 'mat-mdf', name: 'MDF' })
    repositories.materials.list.mockResolvedValue({ ok: true, value: [material, second] })
    const wrapper = render(repositories)
    await flushPromises()
    await button(wrapper, 'New part').trigger('click')
    await wrapper.get('#part-material').trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    const search = wrapper.get('input[role="combobox"]')
    await search.setValue('MDF')
    expect(wrapper.findAll('[role="option"]')).toHaveLength(1)
    await search.trigger('keydown', { key: 'Enter' })
    expect(wrapper.get('#part-material').text()).toContain('MDF')
    expect(wrapper.get('#part-material').attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('dialog').exists()).toBe(true)
    await wrapper.get('#part-material').trigger('click')
    await wrapper.get('input[role="combobox"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.get('#part-material').attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('dialog').exists()).toBe(true)
    expect(repositories.materials.create).not.toHaveBeenCalled()
  })

  it('keeps material list thumbnails and uniform technical drawings on part selection', async () => {
    const repositories = setup()
    const textured = materialSchema.parse({ ...material, libraryPresetId: 'contreplaque' })
    const second = materialSchema.parse({ ...material, id: 'mat-mdf', name: 'Custom renamed MDF', libraryPresetId: 'mdf' })
    const secondPart = partSchema.parse({ ...part, id: 'mdf-part', name: 'Drawer bottom', materialId: second.id })
    repositories.materials.list.mockResolvedValue({ ok: true, value: [textured, second] })
    repositories.parts.list.mockResolvedValue({ ok: true, value: [part, secondPart] })
    const wrapper = render(repositories)
    await flushPromises()
    expect(wrapper.find('aside image').exists()).toBe(false)
    const fill = wrapper.get('aside [data-panel-outline]').attributes('fill')
    expect(fill).toBe('var(--quiet-surface)')
    expect(wrapper.get('aside svg').attributes('aria-label')).toContain(`${String(part.lengthMm)} × ${String(part.widthMm)} mm`)
    expect(wrapper.findAll('aside [data-dimension-arrow]')).toHaveLength(4)
    expect(wrapper.get('tbody img').attributes('src')).toContain('/previews/contreplaque.webp')
    await wrapper.get('button[aria-label="Select Drawer bottom"]').trigger('click')
    expect(wrapper.find('aside image').exists()).toBe(false)
    expect(wrapper.get('aside [data-panel-outline]').attributes('fill')).toBe(fill)
    expect(wrapper.get('aside').text()).toContain('Custom renamed MDF')
    expect(repositories.parts.update).not.toHaveBeenCalled()
  })

})
