import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { createAppRouter } from '../../../app/router'
import { createCatalogRepositories } from '../../../application/catalog/catalog-repositories'
import type { PersistenceResult, Repository } from '../../../application/persistence/repositories'
import { validMaterialInput, validSupplierInput, validSupplierProductInput } from '../../../domain/model/__tests__/fixtures'
import { materialSchema } from '../../../domain/model/material'
import { supplierSchema } from '../../../domain/model/supplier'
import { supplierProductSchema } from '../../../domain/model/supplier-product'
import { createLocalPersistence } from '../../../infrastructure/persistence/local-database'
import { materialRepositoryKey } from '../../materials/material-repository'
import { supplierRepositoryKey, supplierProductRepositoryKey } from '../catalog-repositories'
import SuppliersView from '../SuppliersView.vue'

const supplier = supplierSchema.parse(validSupplierInput)
const material = materialSchema.parse(validMaterialInput)
const product = supplierProductSchema.parse(validSupplierProductInput)
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
  return { suppliers: fakeRepository(supplier, [supplier]), supplierProducts: fakeRepository(product), materials: fakeRepository(material, [material]) }
}
function render(repositories: { suppliers: Repository<typeof supplier>; supplierProducts: Repository<typeof product>; materials: Repository<typeof material> }) {
  const wrapper = mount(SuppliersView, {
    attachTo: document.body,
    global: {
      plugins: [createAppRouter(createMemoryHistory())],
      provide: { [supplierRepositoryKey]: repositories.suppliers, [supplierProductRepositoryKey]: repositories.supplierProducts, [materialRepositoryKey]: repositories.materials },
    },
  })
  wrappers.push(wrapper)
  return wrapper
}
function button(wrapper: VueWrapper, text: string) {
  const found = wrapper.findAll('button').find((candidate) => candidate.text() === text)
  if (!found) throw new Error(`Missing button ${text}`)
  return found
}
async function fillSupplier(wrapper: VueWrapper) {
  await wrapper.get('#supplier-name').setValue(supplier.name)
  await wrapper.get('#supplier-website').setValue(supplier.websiteUrl ?? '')
}
async function fillProduct(wrapper: VueWrapper) {
  await wrapper.get('#product-name').setValue(product.name)
  await wrapper.get('#product-supplier').setValue(supplier.id)
  await wrapper.get('#product-material').setValue(material.id)
  for (const field of ['lengthMm', 'widthMm', 'thicknessMm', 'price'] as const) await wrapper.get(`#product-${field}`).setValue(String(product[field]))
  await wrapper.get('#product-currency').setValue(product.currency)
  await wrapper.get('#product-grain').setValue(product.grainDirection)
  await wrapper.get('#product-availability').setValue(product.availability)
  await wrapper.get('#product-url').setValue(product.productUrl ?? '')
}
async function submit(wrapper: VueWrapper, entity: 'supplier' | 'product') {
  const form = wrapper.findAll('form').find((candidate) => candidate.find(`#${entity}-name`).exists())
  if (!form) throw new Error(`Missing ${entity} form`)
  await form.trigger('submit')
  await flushPromises()
}
afterEach(() => { for (const wrapper of wrappers) wrapper.unmount(); wrappers.length = 0; vi.restoreAllMocks() })

describe('SuppliersView', () => {
  it.each(['create', 'edit'] as const)('creates a material inline and preserves every product field during %s', async (mode) => {
    const repositories = setup()
    if (mode === 'edit') repositories.supplierProducts.list.mockResolvedValue({ ok: true, value: [product] })
    repositories.materials.create.mockImplementation((record) => Promise.resolve({ ok: true, value: materialSchema.parse(record) }))
    const wrapper = render(repositories)
    await flushPromises()
    if (mode === 'edit') await wrapper.get(`button[aria-label="Edit product ${product.name}"]`).trigger('click')
    await fillProduct(wrapper)
    await button(wrapper, '+ New material').trigger('click')
    expect(document.activeElement).toBe(wrapper.get('#inline-material-name').element)
    await wrapper.get('#inline-material-name').setValue(' MDF ')
    await wrapper.get('#inline-material-category').setValue(' Fiberboard ')
    await button(wrapper, 'Create and select material').trigger('click')
    await flushPromises()
    const created = materialSchema.parse(repositories.materials.create.mock.calls[0]?.[0])
    expect(created.name).toBe('MDF')
    expect(created.category).toBe('Fiberboard')
    expect(wrapper.get<HTMLSelectElement>('#product-material').element.value).toBe(created.id)
    expect(wrapper.text()).toContain('Material created and selected.')
    expect(document.activeElement).toBe(wrapper.get('#product-material').element)
    for (const [field, value] of [
      ['name', product.name], ['supplier', product.supplierId], ['lengthMm', String(product.lengthMm)],
      ['widthMm', String(product.widthMm)], ['thicknessMm', String(product.thicknessMm)], ['price', String(product.price)],
      ['currency', product.currency], ['grain', product.grainDirection], ['availability', product.availability], ['url', product.productUrl ?? ''],
    ]) {
      expect(wrapper.get<HTMLInputElement | HTMLSelectElement>(`#product-${field ?? ''}`).element.value).toBe(value)
    }
    await submit(wrapper, 'product')
    if (mode === 'edit') expect(repositories.supplierProducts.update).toHaveBeenCalledExactlyOnceWith(product.id, { ...product, materialId: created.id })
    else {
      const saved = supplierProductSchema.parse(repositories.supplierProducts.create.mock.calls[0]?.[0])
      expect(saved).toEqual({ ...product, id: saved.id, materialId: created.id })
    }
  })

  it('validates only the required Material fields before writing', async () => {
    const repositories = setup()
    const wrapper = render(repositories)
    await flushPromises()
    await fillProduct(wrapper)
    await button(wrapper, '+ New material').trigger('click')
    await wrapper.get('#inline-material-name').setValue('   ')
    await button(wrapper, 'Create and select material').trigger('click')
    expect(wrapper.get('#inline-material-name').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('#inline-material-category').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('#inline-material-fields').findAll('input')).toHaveLength(2)
    expect(document.activeElement).toBe(wrapper.get('#inline-material-name').element)
    expect(repositories.materials.create).not.toHaveBeenCalled()
    expect(wrapper.get<HTMLInputElement>('#product-name').element.value).toBe(product.name)
    expect(wrapper.get<HTMLSelectElement>('#product-material').element.value).toBe(material.id)
  })

  it.each(['storageFailure', 'duplicateId', 'invalidRecord'] as const)('keeps both drafts after inline %s and supports retry', async (kind) => {
    const repositories = setup()
    const error = kind === 'storageFailure' ? failure.error : kind === 'duplicateId' ? { kind, id: material.id } : { kind, issues: [{ path: ['name'], message: 'Invalid material' }] }
    repositories.materials.create.mockResolvedValueOnce({ ok: false, error })
    const wrapper = render(repositories)
    await flushPromises()
    await fillProduct(wrapper)
    await button(wrapper, '+ New material').trigger('click')
    await wrapper.get('#inline-material-name').setValue('New material')
    await wrapper.get('#inline-material-category').setValue('Plywood')
    await button(wrapper, 'Create and select material').trigger('click')
    await flushPromises()
    expect(wrapper.get('#inline-material-fields [role="alert"]').text()).not.toBe('')
    expect(wrapper.get<HTMLInputElement>('#inline-material-name').element.value).toBe('New material')
    expect(wrapper.get<HTMLInputElement>('#product-name').element.value).toBe(product.name)
    expect(wrapper.get<HTMLSelectElement>('#product-material').element.value).toBe(material.id)
    expect(repositories.supplierProducts.create).not.toHaveBeenCalled()
    await button(wrapper, 'Create and select material').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Material created and selected.')
    expect(repositories.materials.create).toHaveBeenCalledTimes(2)
  })

  it('cancels inline creation without changing the existing selection or draft', async () => {
    const repositories = setup()
    const wrapper = render(repositories)
    await flushPromises()
    await fillProduct(wrapper)
    await button(wrapper, '+ New material').trigger('click')
    await wrapper.get('#inline-material-name').setValue('Unsaved')
    await button(wrapper, 'Cancel material').trigger('click')
    expect(wrapper.find('#inline-material-fields').exists()).toBe(false)
    expect(wrapper.get<HTMLSelectElement>('#product-material').element.value).toBe(material.id)
    expect(wrapper.get<HTMLInputElement>('#product-name').element.value).toBe(product.name)
    expect(repositories.materials.create).not.toHaveBeenCalled()
  })

  it('blocks duplicate material writes and product submission while saving inline', async () => {
    const repositories = setup()
    let resolve: ((result: PersistenceResult<typeof material>) => void) | undefined
    repositories.materials.create.mockReturnValue(new Promise((done) => { resolve = done }))
    const wrapper = render(repositories)
    await flushPromises()
    await fillProduct(wrapper)
    await button(wrapper, '+ New material').trigger('click')
    await wrapper.get('#inline-material-name').setValue('MDF')
    await wrapper.get('#inline-material-category').setValue('Fiberboard')
    await button(wrapper, 'Create and select material').trigger('click')
    expect(wrapper.get('#inline-material-fields').attributes('disabled')).toBeDefined()
    await submit(wrapper, 'product')
    await button(wrapper, 'Saving material…').trigger('click')
    expect(repositories.materials.create).toHaveBeenCalledTimes(1)
    expect(repositories.supplierProducts.create).not.toHaveBeenCalled()
    resolve?.({ ok: true, value: material })
    await flushPromises()
  })

  it('persists an inline material and its product through the existing repositories', async () => {
    const indexedDB = new IDBFactory()
    const first = createLocalPersistence('inline-material-persistence', { indexedDB, IDBKeyRange })
    const second = createLocalPersistence('inline-material-persistence', { indexedDB, IDBKeyRange })
    try {
      await first.suppliers.create(supplier)
      const wrapper = render(createCatalogRepositories(first))
      await vi.waitFor(() => { expect(wrapper.get('#product-name').attributes('disabled')).toBeUndefined() })
      await wrapper.get('#product-name').setValue(product.name)
      await wrapper.get('#product-supplier').setValue(supplier.id)
      for (const field of ['lengthMm', 'widthMm', 'thicknessMm', 'price'] as const) await wrapper.get(`#product-${field}`).setValue(String(product[field]))
      await button(wrapper, '+ New material').trigger('click')
      await wrapper.get('#inline-material-name').setValue(material.name)
      await wrapper.get('#inline-material-category').setValue(material.category)
      await button(wrapper, 'Create and select material').trigger('click')
      await vi.waitFor(() => { expect(wrapper.text()).toContain('Material created and selected.') })
      const selectedId = wrapper.get<HTMLSelectElement>('#product-material').element.value
      await submit(wrapper, 'product')
      await vi.waitFor(() => { expect(wrapper.text()).toContain('Product created.') })
      wrapper.unmount()
      first.close()
      const storedMaterials = await second.materials.list()
      const storedProducts = await second.supplierProducts.list()
      expect(storedMaterials).toMatchObject({ ok: true, value: [{ id: selectedId, name: material.name, category: material.category }] })
      expect(storedProducts).toMatchObject({ ok: true, value: [{ materialId: selectedId, thicknessMm: product.thicknessMm }] })
      expect(await second.stockItems.list()).toEqual({ ok: true, value: [] })
    } finally { first.close(); second.close() }
  })
  it('shows loading and empty supplier/product states', async () => {
    const repositories = setup()
    let resolve: ((result: PersistenceResult<readonly typeof supplier[]>) => void) | undefined
    repositories.suppliers.list.mockReturnValue(new Promise((done) => { resolve = done }))
    const wrapper = render(repositories)
    expect(wrapper.text()).toContain('Loading supplier catalog')
    expect(wrapper.get('#supplier-name').attributes('disabled')).toBeDefined()
    resolve?.({ ok: true, value: [] })
    await flushPromises()
    expect(wrapper.text()).toContain('No suppliers yet')
    expect(wrapper.text()).toContain('No catalog products yet')
    expect(button(wrapper, 'Create product').attributes('disabled')).toBeDefined()
  })

  it('creates a supplier with a stable validated ID and optional website', async () => {
    const repositories = setup()
    const wrapper = render(repositories)
    await flushPromises()
    await fillSupplier(wrapper)
    await wrapper.get('#supplier-name').setValue(` ${supplier.name} `)
    await submit(wrapper, 'supplier')
    const created = supplierSchema.parse(repositories.suppliers.create.mock.calls[0]?.[0])
    expect(created).toEqual({ ...supplier, id: created.id })
    expect(repositories.suppliers.list).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[role="status"]').text()).toBe('Supplier created.')
    expect(wrapper.get<HTMLInputElement>('#supplier-name').element.value).toBe('')
  })

  it('edits a supplier, clears an optional URL, and retains its ID', async () => {
    const repositories = setup()
    const wrapper = render(repositories)
    await flushPromises()
    await wrapper.get(`button[aria-label="Edit supplier ${supplier.name}"]`).trigger('click')
    expect(wrapper.get<HTMLInputElement>('#supplier-website').element.value).toBe(supplier.websiteUrl)
    await wrapper.get('#supplier-name').setValue('Updated supplier')
    await wrapper.get('#supplier-website').setValue('')
    await submit(wrapper, 'supplier')
    expect(repositories.suppliers.update).toHaveBeenCalledExactlyOnceWith(supplier.id, { id: supplier.id, name: 'Updated supplier' })
    expect(wrapper.get('[role="status"]').text()).toBe('Supplier updated.')
  })

  it('validates supplier name and http(s) website and focuses invalid input', async () => {
    const repositories = setup()
    const wrapper = render(repositories)
    await flushPromises()
    await wrapper.get('#supplier-name').setValue('   ')
    await wrapper.get('#supplier-website').setValue('javascript:alert(1)')
    await submit(wrapper, 'supplier')
    expect(wrapper.get('#supplier-name').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('#supplier-website').attributes('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(wrapper.get('#supplier-name').element)
    expect(repositories.suppliers.create).not.toHaveBeenCalled()
  })

  it('confirms supplier deletion, reports success, and refreshes', async () => {
    const repositories = setup()
    repositories.suppliers.list.mockResolvedValueOnce({ ok: true, value: [supplier] }).mockResolvedValue({ ok: true, value: [] })
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const wrapper = render(repositories)
    await flushPromises()
    const action = wrapper.get(`button[aria-label="Delete supplier ${supplier.name}"]`)
    await action.trigger('click')
    expect(repositories.suppliers.delete).not.toHaveBeenCalled()
    confirmation.mockReturnValue(true)
    await action.trigger('click')
    await flushPromises()
    expect(repositories.suppliers.delete).toHaveBeenCalledExactlyOnceWith(supplier.id)
    expect(wrapper.text()).toContain('No suppliers yet')
    expect(wrapper.get('[role="status"]').text()).toBe('Supplier deleted.')
    expect(document.activeElement).toBe(wrapper.get('#supplier-name').element)
  })

  it('groups products by supplier and material category and displays every constraint', async () => {
    const repositories = setup()
    const secondMaterial = materialSchema.parse({ ...material, id: 'mat-mdf', name: 'MDF', category: 'Fiberboard' })
    const secondSupplier = supplierSchema.parse({ ...supplier, id: 'sup-second', name: 'Second supplier' })
    const secondProduct = supplierProductSchema.parse({ ...product, id: 'prod-second', name: 'Second product', materialId: secondMaterial.id, supplierId: secondSupplier.id })
    repositories.materials.list.mockResolvedValue({ ok: true, value: [material, secondMaterial] })
    repositories.suppliers.list.mockResolvedValue({ ok: true, value: [supplier, secondSupplier] })
    repositories.supplierProducts.list.mockResolvedValue({ ok: true, value: [product, secondProduct] })
    const wrapper = render(repositories)
    await flushPromises()
    const groups = wrapper.findAll('h3').map((heading) => heading.text())
    expect(groups).toEqual([supplier.name, secondSupplier.name])
    expect(wrapper.findAll('h4').map((heading) => heading.text())).toEqual(['Plywood', 'Fiberboard'])
    for (const text of [product.name, '2500 × 1250 × 18', '89.9 EUR', 'Along length', 'Available']) expect(wrapper.text()).toContain(text)
    expect(wrapper.get(`a[href="${product.productUrl ?? ''}"]`).attributes('rel')).toBe('noopener noreferrer')
  })

  it('creates a schema-validated product and rereads storage', async () => {
    const repositories = setup()
    repositories.supplierProducts.list.mockResolvedValueOnce({ ok: true, value: [] }).mockResolvedValue({ ok: true, value: [product] })
    const wrapper = render(repositories)
    await flushPromises()
    await fillProduct(wrapper)
    await submit(wrapper, 'product')
    const created = supplierProductSchema.parse(repositories.supplierProducts.create.mock.calls[0]?.[0])
    expect(created).toEqual({ ...product, id: created.id })
    expect(repositories.supplierProducts.list).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[role="status"]').text()).toBe('Product created.')
    expect(wrapper.get<HTMLInputElement>('#product-name').element.value).toBe('')
  })

  it('edits all product attributes, retains ID, and omits a cleared optional URL', async () => {
    const repositories = setup()
    const alternateSupplier = supplierSchema.parse({ ...supplier, id: 'sup-other', name: 'Other supplier' })
    const alternateMaterial = materialSchema.parse({ ...material, id: 'mat-other', name: 'Other material' })
    repositories.suppliers.list.mockResolvedValue({ ok: true, value: [supplier, alternateSupplier] })
    repositories.materials.list.mockResolvedValue({ ok: true, value: [material, alternateMaterial] })
    repositories.supplierProducts.list.mockResolvedValue({ ok: true, value: [product] })
    const wrapper = render(repositories)
    await flushPromises()
    await wrapper.get(`button[aria-label="Edit product ${product.name}"]`).trigger('click')
    await wrapper.get('#product-name').setValue('Updated product')
    await wrapper.get('#product-supplier').setValue(alternateSupplier.id)
    await wrapper.get('#product-material').setValue(alternateMaterial.id)
    await wrapper.get('#product-lengthMm').setValue('2400')
    await wrapper.get('#product-widthMm').setValue('1200')
    await wrapper.get('#product-thicknessMm').setValue('18.5')
    await wrapper.get('#product-price').setValue('0')
    await wrapper.get('#product-currency').setValue('USD')
    await wrapper.get('#product-grain').setValue('width')
    await wrapper.get('#product-availability').setValue('unavailable')
    await wrapper.get('#product-url').setValue('')
    await submit(wrapper, 'product')
    expect(repositories.supplierProducts.update).toHaveBeenCalledExactlyOnceWith(product.id, {
      id: product.id, name: 'Updated product', supplierId: alternateSupplier.id, materialId: alternateMaterial.id,
      lengthMm: 2400, widthMm: 1200, thicknessMm: 18.5, price: 0, currency: 'USD', grainDirection: 'width', availability: 'unavailable',
    })
    expect(wrapper.get('[role="status"]').text()).toBe('Product updated.')
  })

  it.each(['supplier', 'product'] as const)('cancels %s editing without writing', async (entity) => {
    const repositories = setup()
    repositories.supplierProducts.list.mockResolvedValue({ ok: true, value: [product] })
    const wrapper = render(repositories)
    await flushPromises()
    await wrapper.get(`button[aria-label="Edit ${entity} ${entity === 'supplier' ? supplier.name : product.name}"]`).trigger('click')
    await wrapper.get(`#${entity}-name`).setValue('Unsaved')
    await button(wrapper, 'Cancel').trigger('click')
    expect(wrapper.get<HTMLInputElement>(`#${entity}-name`).element.value).toBe('')
    expect(repositories.suppliers.update).not.toHaveBeenCalled()
    expect(repositories.supplierProducts.update).not.toHaveBeenCalled()
  })

  it('confirms product deletion and clears an edited deleted record', async () => {
    const repositories = setup()
    repositories.supplierProducts.list.mockResolvedValueOnce({ ok: true, value: [product] }).mockResolvedValue({ ok: true, value: [] })
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const wrapper = render(repositories)
    await flushPromises()
    await wrapper.get(`button[aria-label="Edit product ${product.name}"]`).trigger('click')
    const action = wrapper.get(`button[aria-label="Delete product ${product.name}"]`)
    await action.trigger('click')
    expect(repositories.supplierProducts.delete).not.toHaveBeenCalled()
    confirmation.mockReturnValue(true)
    await action.trigger('click')
    await flushPromises()
    expect(repositories.supplierProducts.delete).toHaveBeenCalledExactlyOnceWith(product.id)
    expect(wrapper.text()).toContain('No catalog products yet')
    expect(wrapper.get('#product-form-title').text()).toBe('New catalog product')
    expect(document.activeElement).toBe(wrapper.get('#product-name').element)
  })

  it('requires dimensions, name, price, supplier and material selection', async () => {
    const repositories = setup()
    const wrapper = render(repositories)
    await flushPromises()
    await submit(wrapper, 'product')
    for (const field of ['name', 'lengthMm', 'widthMm', 'thicknessMm', 'price', 'supplier', 'material']) {
      expect(wrapper.get(`#product-${field}`).attributes('aria-invalid')).toBe('true')
      expect(wrapper.get(`#product-${field}-error`).text()).not.toBe('')
    }
    expect(repositories.supplierProducts.create).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(wrapper.get('#product-name').element)
  })

  it.each(['lengthMm', 'widthMm', 'thicknessMm'])('rejects zero, negative, empty and nonnumeric %s', async (field) => {
    const repositories = setup()
    const wrapper = render(repositories)
    await flushPromises()
    await fillProduct(wrapper)
    for (const invalid of ['0', '-1', '', 'invalid']) {
      await wrapper.get(`#product-${field}`).setValue(invalid)
      await submit(wrapper, 'product')
      expect(wrapper.get(`#product-${field}`).attributes('aria-invalid')).toBe('true')
    }
    expect(repositories.supplierProducts.create).not.toHaveBeenCalled()
  })

  it.each(['', '-1', 'invalid', '1e309'])('rejects invalid price %j', async (price) => {
    const repositories = setup()
    const wrapper = render(repositories)
    await flushPromises()
    await fillProduct(wrapper)
    await wrapper.get('#product-price').setValue(price)
    await submit(wrapper, 'product')
    expect(wrapper.get('#product-price').attributes('aria-invalid')).toBe('true')
    expect(repositories.supplierProducts.create).not.toHaveBeenCalled()
  })

  it('rejects invalid currency and URL without writing', async () => {
    const repositories = setup()
    const wrapper = render(repositories)
    await flushPromises()
    await fillProduct(wrapper)
    await wrapper.get('#product-currency').setValue('eur')
    await wrapper.get('#product-url').setValue('ftp://example.com')
    await submit(wrapper, 'product')
    expect(wrapper.get('#product-currency').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('#product-url').attributes('aria-invalid')).toBe('true')
    expect(repositories.supplierProducts.create).not.toHaveBeenCalled()
  })

  it('makes missing references explicit and requires replacement selections', async () => {
    const repositories = setup()
    const orphan = supplierProductSchema.parse({ ...product, supplierId: 'missing-supplier', materialId: 'missing-material' })
    repositories.supplierProducts.list.mockResolvedValue({ ok: true, value: [orphan] })
    const wrapper = render(repositories)
    await flushPromises()
    expect(wrapper.text()).toContain('Missing supplier')
    expect(wrapper.text()).toContain('Missing material')
    await wrapper.get(`button[aria-label="Edit product ${product.name}"]`).trigger('click')
    await submit(wrapper, 'product')
    expect(wrapper.get('#product-supplier-error').text()).toContain('Choose an existing supplier')
    expect(wrapper.get('#product-material-error').text()).toContain('Choose an existing material')
    expect(repositories.supplierProducts.update).not.toHaveBeenCalled()
  })

  it('preselects only the supplier explicitly chosen by Add product', async () => {
    const repositories = setup()
    const wrapper = render(repositories)
    await flushPromises()
    expect(wrapper.get<HTMLSelectElement>('#product-supplier').element.value).toBe('')
    await wrapper.get(`button[aria-label="Add product for ${supplier.name}"]`).trigger('click')
    expect(wrapper.get<HTMLSelectElement>('#product-supplier').element.value).toBe(supplier.id)
    expect(wrapper.get<HTMLSelectElement>('#product-material').element.value).toBe('')
  })

  it('offers inline creation and prevents product writes until a material exists', async () => {
    const repositories = setup()
    repositories.materials.list.mockResolvedValue({ ok: true, value: [] })
    const wrapper = render(repositories)
    await flushPromises()
    expect(wrapper.text()).toContain('Create a material directly in the product form')
    expect(button(wrapper, 'Create product').attributes('disabled')).toBeDefined()
  })

  it.each(['suppliers', 'supplierProducts', 'materials'] as const)('reports %s read errors and supports retry', async (store) => {
    const repositories = setup()
    repositories[store].list.mockResolvedValueOnce(failure)
    const wrapper = render(repositories)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not access local storage')
    expect(wrapper.text()).not.toContain('No suppliers yet')
    expect(button(wrapper, 'Create product').attributes('disabled')).toBeDefined()
    await button(wrapper, 'Try again').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it.each(['supplier', 'product'] as const)('retains %s drafts after failure and supports retry', async (entity) => {
    const repositories = setup()
    if (entity === 'supplier') repositories.suppliers.create.mockResolvedValueOnce(failure)
    else repositories.supplierProducts.create.mockResolvedValueOnce(failure)
    const wrapper = render(repositories)
    await flushPromises()
    if (entity === 'supplier') await fillSupplier(wrapper)
    else await fillProduct(wrapper)
    await submit(wrapper, entity)
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not access local storage')
    expect(wrapper.get<HTMLInputElement>(`#${entity}-name`).element.value).toBe(entity === 'supplier' ? supplier.name : product.name)
    await submit(wrapper, entity)
    expect(wrapper.get('[role="status"]').text()).toContain('created.')
  })

  it.each(['supplier', 'product'] as const)('reports %s deletion constraints and keeps the record', async (entity) => {
    const repositories = setup()
    repositories.supplierProducts.list.mockResolvedValue({ ok: true, value: [product] })
    const conflict = { ok: false, error: { kind: 'referenceConflict', message: 'Cannot delete: referenced by existing records.' } } as const
    if (entity === 'supplier') repositories.suppliers.delete.mockResolvedValue(conflict)
    else repositories.supplierProducts.delete.mockResolvedValue(conflict)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = render(repositories)
    await flushPromises()
    await wrapper.get(`button[aria-label="Delete ${entity} ${entity === 'supplier' ? supplier.name : product.name}"]`).trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('referenced by existing records')
    expect(wrapper.text()).toContain(entity === 'supplier' ? supplier.name : product.name)
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })

  it('reports a deleted reference on product save without discarding the draft', async () => {
    const repositories = setup()
    repositories.supplierProducts.create.mockResolvedValue({ ok: false, error: { kind: 'notFound', id: material.id } })
    const wrapper = render(repositories)
    await flushPromises()
    await fillProduct(wrapper)
    await submit(wrapper, 'product')
    expect(wrapper.get('[role="alert"]').text()).toContain('no longer exists')
    expect(wrapper.get<HTMLInputElement>('#product-name').element.value).toBe(product.name)
  })

  it.each(['supplier', 'product'] as const)('retains %s edits after update failure', async (entity) => {
    const repositories = setup()
    repositories.supplierProducts.list.mockResolvedValue({ ok: true, value: [product] })
    if (entity === 'supplier') repositories.suppliers.update.mockResolvedValue(failure)
    else repositories.supplierProducts.update.mockResolvedValue(failure)
    const wrapper = render(repositories)
    await flushPromises()
    await wrapper.get(`button[aria-label="Edit ${entity} ${entity === 'supplier' ? supplier.name : product.name}"]`).trigger('click')
    await wrapper.get(`#${entity}-name`).setValue('Unsaved edit')
    await submit(wrapper, entity)
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not access local storage')
    expect(wrapper.get<HTMLInputElement>(`#${entity}-name`).element.value).toBe('Unsaved edit')
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })

  it('prevents duplicate submissions while product persistence is pending', async () => {
    const repositories = setup()
    let resolve: ((result: PersistenceResult<typeof product>) => void) | undefined
    repositories.supplierProducts.create.mockReturnValue(new Promise((done) => { resolve = done }))
    const wrapper = render(repositories)
    await flushPromises()
    await fillProduct(wrapper)
    await submit(wrapper, 'product')
    expect(wrapper.get('#supplier-name').attributes('disabled')).toBeDefined()
    await submit(wrapper, 'product')
    expect(repositories.supplierProducts.create).toHaveBeenCalledTimes(1)
    resolve?.({ ok: true, value: product })
    await flushPromises()
  })

  it('distinguishes successful writes from a failed refresh', async () => {
    const repositories = setup()
    repositories.supplierProducts.list.mockResolvedValueOnce({ ok: true, value: [] }).mockResolvedValue(failure)
    const wrapper = render(repositories)
    await flushPromises()
    await fillProduct(wrapper)
    await submit(wrapper, 'product')
    expect(wrapper.get('[role="status"]').text()).toBe('Product created.')
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not access local storage')
  })

  it('round-trips supplier and product UI writes through guarded Dexie repositories', async () => {
    const indexedDB = new IDBFactory()
    const first = createLocalPersistence('supplier-ui-reopen', { indexedDB, IDBKeyRange })
    const second = createLocalPersistence('supplier-ui-reopen', { indexedDB, IDBKeyRange })
    try {
      await first.materials.create(material)
      const wrapper = render(createCatalogRepositories(first))
      await vi.waitFor(() => { expect(wrapper.text()).toContain('No suppliers yet') })
      await fillSupplier(wrapper)
      await submit(wrapper, 'supplier')
      await vi.waitFor(() => { expect(wrapper.text()).toContain('Supplier created.') })
      const storedSuppliers = await first.suppliers.list()
      if (!storedSuppliers.ok || !storedSuppliers.value[0]) throw new Error('Missing saved supplier')
      await fillProduct(wrapper)
      await wrapper.get('#product-supplier').setValue(storedSuppliers.value[0].id)
      await submit(wrapper, 'product')
      await vi.waitFor(() => { expect(wrapper.text()).toContain('Product created.') })
      wrapper.unmount()
      first.close()
      const reopened = render(createCatalogRepositories(second))
      await vi.waitFor(() => { expect(reopened.text()).toContain(product.name) })
      expect(reopened.text()).toContain('2500 × 1250 × 18')
      expect(await second.stockItems.list()).toEqual({ ok: true, value: [] })
    } finally { first.close(); second.close() }
  })
})
