import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { createAppRouter } from '../../../app/router'
import { createCatalogRepositories } from '../../../application/catalog/catalog-repositories'
import type { PersistenceResult, Repository } from '../../../application/persistence/repositories'
import { validMaterialInput, validSupplierInput, validSupplierProductInput, validStockItemInput } from '../../../domain/model/__tests__/fixtures'
import { stockItemSchema } from '../../../domain/model/stock-item'
import { catalogTransferServiceKey } from '../catalog-transfer-service'
import type { CatalogTransferService } from '../../../application/catalog/catalog-transfer-service'
import { catalogTransferSchema } from '../../../application/catalog/catalog-transfer-format'
import { materialSchema } from '../../../domain/model/material'
import { supplierSchema } from '../../../domain/model/supplier'
import { supplierProductSchema } from '../../../domain/model/supplier-product'
import { createLocalPersistence } from '../../../infrastructure/persistence/local-database'
import { materialRepositoryKey } from '../../materials/material-repository'
import { supplierRepositoryKey, supplierProductRepositoryKey, catalogStockRepositoryKey } from '../catalog-repositories'
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
function render(repositories: { suppliers: Repository<typeof supplier>; supplierProducts: Repository<typeof product> & Partial<Pick<ReturnType<typeof createCatalogRepositories>['supplierProducts'], 'saveWithPreset'>>; materials: Repository<typeof material> }, provide: Record<symbol, unknown> = {}) {
  const wrapper = mount(SuppliersView, {
    attachTo: document.body,
    global: {
      plugins: [createAppRouter(createMemoryHistory())],
      provide: { [supplierRepositoryKey]: repositories.suppliers, [supplierProductRepositoryKey]: repositories.supplierProducts, [materialRepositoryKey]: repositories.materials, ...provide },
    },
  })
  wrappers.push(wrapper)
  return wrapper
}
async function selectMaterial(wrapper: VueWrapper, value: string) {
  await wrapper.get('#product-material').trigger('click')
  const option = wrapper.findAll('[role="option"]').find(item => item.attributes('data-value') === value)
  if (!option) throw new Error(`Missing material ${value}`)
  await option.trigger('click')
}
async function openCustomMaterial(wrapper: VueWrapper) {
  await wrapper.get('#product-material').trigger('click')
  await button(wrapper, '+ Create custom material').trigger('click')
}
function button(wrapper: VueWrapper, text: string) {
  const found = wrapper.findAll('button').find((candidate) => (candidate.text() === text || candidate.attributes('aria-label') === text))
  if (!found) throw new Error(`Missing button ${text}`)
  return found
}
async function openForm(wrapper: VueWrapper, entity: 'supplier' | 'product') {
  if (wrapper.find(`#${entity}-name`).exists()) return
  await button(wrapper, entity === 'supplier' ? '+ Add Supplier' : '+ Add Product').trigger('click')
}
async function selectProduct(wrapper: VueWrapper) {
  if (!wrapper.find(`button[aria-label="Edit product ${product.name}"]`).exists()) await wrapper.get(`button[aria-label="View product ${product.name}"]`).trigger('click')
}
async function fillSupplier(wrapper: VueWrapper) {
  await openForm(wrapper, 'supplier')
  await wrapper.get('#supplier-name').setValue(supplier.name)
  await wrapper.get('#supplier-website').setValue(supplier.websiteUrl ?? '')
}
async function fillProduct(wrapper: VueWrapper) {
  await openForm(wrapper, 'product')
  await wrapper.get('#product-name').setValue(product.name)
  await wrapper.get('#product-supplier').setValue(supplier.id)
  await selectMaterial(wrapper, material.id)
  for (const field of ['lengthMm', 'widthMm', 'thicknessMm', 'price'] as const) await wrapper.get(`#product-${field}`).setValue(String(product[field]))
  await wrapper.get('#product-currency').setValue(product.currency)
  await wrapper.get('#product-grain').setValue(product.grainDirection)
  await wrapper.get('#product-availability').setValue(product.availability)
  await wrapper.get('#product-url').setValue(product.productUrl ?? '')
}
async function submit(wrapper: VueWrapper, entity: 'supplier' | 'product') {
  await openForm(wrapper, entity)
  const form = wrapper.findAll('form').find((candidate) => candidate.find(`#${entity}-name`).exists())
  if (!form) throw new Error(`Missing ${entity} form`)
  await form.trigger('submit')
  await flushPromises()
}
afterEach(() => { for (const wrapper of wrappers) wrapper.unmount(); wrappers.length = 0; vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('SuppliersView', () => {
  it('keeps required fields and linked errors accessible in the sectioned product editor', async () => {
    const repositories = setup()
    const wrapper = render(repositories); await flushPromises(); await openForm(wrapper, 'product')
    expect(wrapper.get('#catalog-dialog-title').text()).toBe('New product')
    const form = wrapper.get('form[aria-label="Product editor"]')
    expect(form.findAll('h3').map(heading => heading.text())).toEqual(['General information', 'Panel dimensions', 'Pricing and availability', 'Additional information'])
    for (const field of ['name', 'supplier', 'material', 'lengthMm', 'widthMm', 'thicknessMm', 'price', 'currency', 'grain', 'availability']) {
      const label = form.get(`label[for="product-${field}"]`)
      expect(label.get('span[aria-hidden="true"]').text()).toBe('*')
      expect(label.get('.sr-only').text()).toBe('(required)')
      expect(form.get(`#product-${field}`).attributes('required')).toBeDefined()
    }
    expect(form.get('#product-url').attributes('required')).toBeUndefined()
    expect(form.get<HTMLInputElement>('#product-currency').element.value).toBe('EUR')
    await submit(wrapper, 'product')
    for (const dimension of ['lengthMm', 'widthMm', 'thicknessMm']) {
      expect(form.get(`#product-${dimension}`).attributes('aria-invalid')).toBe('true')
      expect(form.get(`#product-${dimension}`).attributes('aria-describedby')).toBe(`product-${dimension}-error`)
      expect(form.get(`#product-${dimension}-error`).attributes('role')).toBe('alert')
    }
    expect(repositories.supplierProducts.create).not.toHaveBeenCalled()
    await button(wrapper, 'Close form').trigger('click')
    expect(wrapper.find('form[aria-label="Product editor"]').exists()).toBe(false)
    await openForm(wrapper, 'supplier')
    expect(wrapper.get('label[for="supplier-name"]').text()).toContain('(required)')
  })

  it('presents substantial icon summary cards and structured text-based product details without invented imagery', async () => {
    const repositories = setup()
    repositories.supplierProducts.list.mockResolvedValue({ ok: true, value: [product] })
    const inventory = { list: vi.fn().mockResolvedValue({ ok: true, value: [] }) }
    const wrapper = render(repositories, { [catalogStockRepositoryKey]: inventory }); await flushPromises()
    const summary = wrapper.get('[aria-label="Catalog summary"]')
    expect(summary.findAll('.catalog-summary-card')).toHaveLength(4)
    expect(summary.findAll('.catalog-icon svg[aria-hidden="true"]')).toHaveLength(4)
    expect(summary.findAll('dd').map(value => value.text())).toEqual(['1', '1', '1', '0'])
    const details = wrapper.get('#product-details')
    expect(details.find('img').exists()).toBe(false)
    expect(details.get('[aria-label="Product specifications"]').text()).toContain('Thickness18 mm')
    expect(details.get('[aria-label="Owned inventory"]').text()).toContain('0 owned units')
    expect(details.get('[aria-label="Product actions"]').text()).toContain('Edit product')
    const selected = wrapper.get('button[aria-controls="product-details"][aria-pressed="true"]')
    expect(selected.get('.catalog-selection-mark svg').attributes('aria-hidden')).toBe('true')
    await wrapper.get(`button[aria-label="Edit panel ${product.name}"]`).trigger('click')
    expect(wrapper.find('#product-name').exists()).toBe(true)
    expect(inventory.list).toHaveBeenCalledTimes(1)
  })

  it('summarizes real entity counts and full-panel quantities independently of catalog availability', async () => {
    const repositories = setup()
    const secondSupplier = supplierSchema.parse({ ...supplier, id: 'second-supplier' })
    const secondMaterial = materialSchema.parse({ ...material, id: 'second-material' })
    const otherProduct = supplierProductSchema.parse({ ...product, id: 'second-product', availability: 'unavailable' })
    repositories.suppliers.list.mockResolvedValue({ ok: true, value: [supplier, secondSupplier] })
    repositories.materials.list.mockResolvedValue({ ok: true, value: [material, secondMaterial] })
    repositories.supplierProducts.list.mockResolvedValue({ ok: true, value: [product, otherProduct] })
    const panels = stockItemSchema.parse({ ...validStockItemInput, id: 'owned-panels', kind: 'fullPanel', quantity: 4 })
    const purchased = stockItemSchema.parse({ ...panels, id: 'purchased-panels', quantity: 7, provenance: { source: 'purchase', supplierProductId: product.id } })
    const offcuts = stockItemSchema.parse({ ...validStockItemInput, id: 'offcuts', kind: 'offcut', quantity: 20 })
    const inventory = fakeRepository(panels, [panels, purchased, offcuts])
    const wrapper = render(repositories, { [catalogStockRepositoryKey]: inventory }); await flushPromises()
    expect(wrapper.get('[aria-label="Catalog summary"]').findAll('dd').map(value => value.text())).toEqual(['2', '2', '2', '11'])
    expect(wrapper.get('table').text()).toContain('7 owned')
    expect(wrapper.text()).toContain('31 owned units for this material')
    expect(inventory.create).not.toHaveBeenCalled()
    expect(inventory.update).not.toHaveBeenCalled()
    expect(inventory.delete).not.toHaveBeenCalled()
  })

  it('defaults to the first visible product, preserves explicit selections and updates details with filters and supplier changes', async () => {
    const repositories = setup()
    const secondSupplier = supplierSchema.parse({ ...supplier, id: 'second-supplier', name: 'Other supplier' })
    const alternative = supplierProductSchema.parse({ ...product, id: 'alternative', name: 'Alternative panel', thicknessMm: 25 })
    const other = supplierProductSchema.parse({ ...product, id: 'other-panel', name: 'Other panel', supplierId: secondSupplier.id })
    repositories.suppliers.list.mockResolvedValue({ ok: true, value: [supplier, secondSupplier] })
    repositories.supplierProducts.list.mockResolvedValue({ ok: true, value: [product, alternative, other] })
    const wrapper = render(repositories); await flushPromises()
    expect(wrapper.get('#product-details h3').text()).toBe(product.name)
    expect(wrapper.get(`button[aria-label="View product ${product.name}"]`).attributes('aria-pressed')).toBe('true')
    await wrapper.get(`button[aria-label="View product ${alternative.name}"]`).trigger('click')
    await wrapper.get('#catalog-search').setValue('panel')
    expect(wrapper.get('#product-details h3').text()).toBe(alternative.name)
    await wrapper.get('#catalog-search').setValue('2500 × 1250')
    expect(wrapper.get('#product-details h3').text()).toBe(product.name)
    await wrapper.get('#catalog-search').setValue('no match')
    expect(wrapper.get('#product-details').text()).toContain('No visible products')
    expect(wrapper.find('button[aria-label^="Edit product"]').exists()).toBe(false)
    await wrapper.get('#catalog-search').setValue('')
    await wrapper.get(`button[aria-label="Select supplier ${secondSupplier.name}"]`).trigger('click')
    expect(wrapper.get('#product-details h3').text()).toBe(other.name)
    await wrapper.get(`button[aria-label="Select supplier ${secondSupplier.name}"]`).trigger('click')
    expect(wrapper.get('#product-details h3').text()).toBe(other.name)
  })

  it('keeps duplicate product names and independent IDs, details and editing targets', async () => {
    const repositories = setup()
    const duplicate = supplierProductSchema.parse({ ...product, id: 'same-name-panel', thicknessMm: 25, price: 110 })
    repositories.supplierProducts.list.mockResolvedValue({ ok: true, value: [product, duplicate] })
    const wrapper = render(repositories); await flushPromises()
    const controls = wrapper.findAll(`button[aria-label="View product ${product.name}"]`)
    expect(controls).toHaveLength(2)
    expect(controls.map(control => control.text())).toEqual([product.name, product.name])
    await controls[1]?.trigger('click')
    expect(wrapper.get('#product-details').text()).toContain('2500 × 1250 × 25 mm')
    expect(wrapper.get('#product-details [aria-label="Product specifications"] dl').text()).toContain('Thickness25 mm')
    expect(controls[0]?.attributes('aria-pressed')).toBe('false')
    expect(controls[1]?.attributes('aria-pressed')).toBe('true')
    await wrapper.get(`button[aria-label="Edit product ${product.name}"]`).trigger('click')
    expect(wrapper.get<HTMLInputElement>('#product-thicknessMm').element.value).toBe('25')
    await submit(wrapper, 'product')
    expect(repositories.supplierProducts.update.mock.calls[0]?.[0]).toBe(duplicate.id)
  })

  it('keeps mobile default selection unobtrusive and closes details when filtering removes the selection', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    const repositories = setup(); repositories.supplierProducts.list.mockResolvedValue({ ok: true, value: [product] })
    const wrapper = render(repositories); await flushPromises()
    expect(wrapper.find('dialog').exists()).toBe(false)
    const control = wrapper.get<HTMLButtonElement>(`button[aria-label="View product ${product.name}"]`)
    expect(control.attributes('aria-pressed')).toBe('true')
    control.element.focus(); await control.trigger('click')
    expect(wrapper.find('dialog').exists()).toBe(true)
    await button(wrapper, 'Close details').trigger('click')
    expect(document.activeElement).toBe(control.element)
    await wrapper.get('#catalog-search').setValue('no match')
    expect(wrapper.find('dialog').exists()).toBe(false)
    expect(wrapper.find('button[aria-pressed="true"][aria-controls="product-details"]').exists()).toBe(false)
  })

  it('integrates refresh into the supplier toolbar and rereads existing stock and catalog snapshots', async () => {
    const repositories = setup(); repositories.supplierProducts.list.mockResolvedValue({ ok: true, value: [product] })
    const inventory = { list: vi.fn().mockResolvedValue({ ok: true, value: [] }) }
    const wrapper = render(repositories, { [catalogStockRepositoryKey]: inventory }); await flushPromises()
    const toolbar = wrapper.get('[aria-labelledby="supplier-content-title"] > div')
    expect(toolbar.text()).toContain('Refresh catalog')
    expect(wrapper.findAll('button').some(action => action.text() === 'Refresh')).toBe(false)
    expect(wrapper.find('a').text()).toContain(supplier.websiteUrl)
    await button(wrapper, 'Refresh catalog').trigger('click'); await flushPromises()
    expect(inventory.list).toHaveBeenCalledTimes(2)
    expect(repositories.suppliers.list).toHaveBeenCalledTimes(2)
    expect(wrapper.get('#product-details h3').text()).toBe(product.name)
  })

  it('groups separate materials even with the same category and combines name, category, material and availability filters', async () => {
    const repositories = setup()
    const otherMaterial = materialSchema.parse({ ...material, id: 'other-plywood', name: 'Oak plywood' })
    const otherProduct = supplierProductSchema.parse({ ...product, id: 'oak-panel', name: 'Oak panel', materialId: otherMaterial.id, availability: 'unavailable' })
    repositories.materials.list.mockResolvedValue({ ok: true, value: [material, otherMaterial] })
    repositories.supplierProducts.list.mockResolvedValue({ ok: true, value: [product, otherProduct] })
    const wrapper = render(repositories); await flushPromises()
    expect(wrapper.findAll('table')).toHaveLength(2)
    await wrapper.get('#catalog-material').setValue(otherMaterial.id)
    expect(wrapper.findAll('table')).toHaveLength(1); expect(wrapper.find(`button[aria-label="View product ${product.name}"]`).exists()).toBe(false)
    await wrapper.get('#catalog-material').setValue(''); await wrapper.get('#catalog-availability').setValue('available')
    expect(wrapper.find(`button[aria-label="View product ${otherProduct.name}"]`).exists()).toBe(false)
    await wrapper.get('#catalog-category').setValue(material.category); await wrapper.get('#catalog-search').setValue('birch')
    expect(wrapper.findAll('table')).toHaveLength(1)
    await wrapper.get('#catalog-search').setValue('no match'); expect(wrapper.text()).toContain('No products match')
    await wrapper.get('#supplier-search').setValue('no match'); expect(wrapper.text()).toContain('No matching suppliers')
  })

  it('uses an adaptive workspace and native product controls that reveal details on small screens', async () => {
    const repositories = setup(); repositories.supplierProducts.list.mockResolvedValue({ ok: true, value: [product] })
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    const wrapper = render(repositories); await flushPromises()
    const layout = wrapper.get('.catalog-workspace')
    expect(layout.classes()).toContain('md:grid-cols-[200px_minmax(0,1fr)]')
    expect(layout.classes()).toContain('xl:grid-cols-[220px_minmax(0,1fr)_300px]')
    expect(layout.classes()).toContain('2xl:grid-cols-[220px_minmax(0,1fr)_330px]')
    const control = wrapper.get<HTMLButtonElement>(`button[aria-label="View product ${product.name}"]`)
    expect(control.attributes('type')).toBe('button'); expect(control.attributes('aria-controls')).toBe('product-details')
    await control.trigger('click')
    expect(wrapper.get('dialog').attributes('aria-labelledby')).toBe('catalog-dialog-title')
    expect(document.activeElement).toBe(wrapper.get('#product-details-title').element)
    expect(control.attributes('aria-pressed')).toBe('true')
    await button(wrapper, 'Close details').trigger('click')
    expect(wrapper.find('dialog').exists()).toBe(false)
  })

  it('closes mobile details when the viewport expands and detaches its listener on exit', async () => {
    const repositories = setup(); repositories.supplierProducts.list.mockResolvedValue({ ok: true, value: [product] })
    let listener: (() => void) | undefined
    const media = { matches: true, addEventListener: vi.fn((_event: string, callback: () => void) => { listener = callback }), removeEventListener: vi.fn() }
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(media))
    const wrapper = render(repositories); await flushPromises()
    await wrapper.get(`button[aria-label="View product ${product.name}"]`).trigger('click')
    expect(wrapper.find('dialog').exists()).toBe(true)
    media.matches = false; listener?.(); await flushPromises()
    expect(wrapper.find('dialog').exists()).toBe(false); expect(wrapper.find('#product-details').exists()).toBe(true)
    wrapper.unmount(); expect(media.removeEventListener).toHaveBeenCalledWith('change', listener)
  })

  it('shows only real purchase-linked inventory, with its actual dimensions, without writing stock', async () => {
    const repositories = setup(); repositories.supplierProducts.list.mockResolvedValue({ ok: true, value: [product] })
    const purchased = stockItemSchema.parse({ ...validStockItemInput, id: 'purchased', quantity: 3, provenance: { source: 'purchase', supplierProductId: product.id } })
    const unrelated = stockItemSchema.parse({ ...validStockItemInput, id: 'manual', quantity: 9 })
    const inventory = fakeRepository(purchased, [purchased, unrelated])
    const wrapper = render(repositories, { [catalogStockRepositoryKey]: inventory }); await flushPromises()
    expect(wrapper.get('table').text()).toContain('3 owned')
    expect(wrapper.get('[aria-label="Catalog summary"]').findAll('dd').map(value => value.text())).toEqual(['1', '1', '1', '0'])
    expect(wrapper.text()).toContain('12 owned units for this material')
    await selectProduct(wrapper)
    const details = wrapper.get('#product-details')
    expect(details.text()).toContain('3 offcut(s) · 800 × 400.5 × 18 mm')
    expect(details.text()).not.toContain('9 offcut(s)')
    expect(details.text()).toContain('Catalog references are not owned panels')
    expect(inventory.create).not.toHaveBeenCalled(); expect(inventory.update).not.toHaveBeenCalled(); expect(inventory.delete).not.toHaveBeenCalled()
  })

  it('reports unavailable or failed stock reads without blocking catalog interaction', async () => {
    const repositories = setup(); repositories.supplierProducts.list.mockResolvedValue({ ok: true, value: [product] })
    const inventory = { list: vi.fn().mockResolvedValue(failure) }
    const wrapper = render(repositories, { [catalogStockRepositoryKey]: inventory }); await flushPromises(); await selectProduct(wrapper)
    expect(wrapper.get('#product-details [role="alert"]').text()).toContain('Could not access local storage')
    expect(wrapper.get('[aria-label="Catalog summary"]').findAll('dd')[3]?.text()).toBe('—')
    expect(wrapper.get(`button[aria-label="Edit product ${product.name}"]`).attributes('disabled')).toBeUndefined()
  })

  it('opens accessible contextual forms, restores focus after Escape and blocks closing during pending writes', async () => {
    const repositories = setup(); const wrapper = render(repositories); await flushPromises()
    expect(wrapper.findAll('form')).toHaveLength(0)
    const opener = button(wrapper, '+ Add Supplier'); opener.element.focus(); await opener.trigger('click')
    const dialog = wrapper.get('dialog')
    expect(dialog.attributes('aria-labelledby')).toBe('catalog-dialog-title')
    expect(document.activeElement).toBe(wrapper.get('#supplier-name').element)
    await dialog.trigger('cancel'); expect(wrapper.find('dialog').exists()).toBe(false); expect(document.activeElement).toBe(opener.element)
    await fillSupplier(wrapper)
    let resolve: ((result: PersistenceResult<typeof supplier>) => void) | undefined
    repositories.suppliers.create.mockReturnValueOnce(new Promise(done => { resolve = done }))
    await submit(wrapper, 'supplier'); await wrapper.get('dialog').trigger('cancel')
    expect(wrapper.find('dialog').exists()).toBe(true); expect(button(wrapper, 'Close form').attributes('disabled')).toBeDefined()
    resolve?.({ ok: true, value: supplier }); await flushPromises(); expect(wrapper.find('dialog').exists()).toBe(false)
  })

  it('keeps .cocl import preview/confirmation functional and refreshes the new supplier list', async () => {
    const repositories = setup()
    const incoming = supplierSchema.parse({ ...supplier, id: 'imported-supplier', name: 'Imported supplier' })
    const file = catalogTransferSchema.parse({ format: 'opticutlist-catalog', schemaVersion: 1, catalog: { materials: [], suppliers: [incoming], products: [] } })
    const transfer: CatalogTransferService = { export: vi.fn().mockResolvedValue({ ok: true, value: JSON.stringify(file) }), preview: vi.fn().mockResolvedValue({ ok: true, value: { file, conflicts: 0, reused: 0 } }), import: vi.fn().mockImplementation(() => { repositories.suppliers.list.mockResolvedValue({ ok: true, value: [supplier, incoming] }); return Promise.resolve({ ok: true, value: file }) }) }
    const wrapper = render(repositories, { [catalogTransferServiceKey]: transfer }); await flushPromises()
    await button(wrapper, 'Import Catalog').trigger('click')
    const input = wrapper.get('#catalog-import-file'); expect(input.attributes('accept')).toBe('.cocl')
    const selected = new File([''], 'catalog.cocl'); Object.defineProperty(selected, 'text', { value: () => Promise.resolve(JSON.stringify(file)) }); Object.defineProperty(input.element, 'files', { value: [selected] })
    await input.trigger('change'); await flushPromises(); expect(wrapper.text()).toContain('0 materials · 1 suppliers · 0 products')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await button(wrapper, 'Confirm Catalog Import').trigger('click'); await flushPromises()
    expect(wrapper.find(`button[aria-label="Select supplier ${incoming.name}"]`).exists()).toBe(true)
    expect(repositories.suppliers.list).toHaveBeenCalledTimes(2)
  })


  it.each(['create', 'edit'] as const)('creates a material inline and preserves every product field during %s', async (mode) => {
    const repositories = setup()
    if (mode === 'edit') repositories.supplierProducts.list.mockResolvedValue({ ok: true, value: [product] })
    repositories.materials.create.mockImplementation((record) => Promise.resolve({ ok: true, value: materialSchema.parse(record) }))
    const wrapper = render(repositories)
    await flushPromises()
    if (mode === 'edit') { await selectProduct(wrapper); await wrapper.get(`button[aria-label="Edit product ${product.name}"]`).trigger('click') }
    await fillProduct(wrapper)
    await openCustomMaterial(wrapper)
    expect(document.activeElement).toBe(wrapper.get('#inline-material-name').element)
    await wrapper.get('#inline-material-name').setValue(' MDF ')
    await wrapper.get('#inline-material-category').setValue(' Fiberboard ')
    await button(wrapper, 'Create and select material').trigger('click')
    await flushPromises()
    const created = materialSchema.parse(repositories.materials.create.mock.calls[0]?.[0])
    expect(created.name).toBe('MDF')
    expect(created.category).toBe('Fiberboard')
    expect(wrapper.get<HTMLButtonElement>('#product-material').element.value).toBe(created.id)
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

  it.each(['create', 'edit'] as const)('selects a preset directly with an empty catalog during %s and saves atomically', async mode => {
    const indexedDB = new IDBFactory()
    const persistence = createLocalPersistence(`direct-preset-${mode}`, { indexedDB, IDBKeyRange })
    try {
      await persistence.suppliers.create(supplier)
      if (mode === 'edit') {
        await persistence.materials.create(material); await persistence.supplierProducts.create(product)
      }
      const repositories = createCatalogRepositories(persistence)
      const wrapper = render(repositories)
      await vi.waitFor(() => { expect(button(wrapper, '+ Add Product').attributes('disabled')).toBeUndefined() })
      if (mode === 'edit') { await selectProduct(wrapper); await wrapper.get(`button[aria-label="Edit product ${product.name}"]`).trigger('click') }
      else await openForm(wrapper, 'product')
      await wrapper.get('#product-material').trigger('click')
      expect(wrapper.findAll('[role="option"][data-value^="preset:"]')).toHaveLength(20)
      await wrapper.get('input[aria-label="Search materials"]').trigger('keydown', { key: 'Escape' })
      if (mode === 'edit') expect(wrapper.get<HTMLButtonElement>('#product-material').element.value).toBe(material.id)
      await selectMaterial(wrapper, 'preset:pin')
      expect(wrapper.find('#inline-material-fields').exists()).toBe(false)
      expect(wrapper.get('#product-material').attributes('disabled')).toBeUndefined()
      await wrapper.get('#product-name').setValue(product.name)
      for (const field of ['lengthMm', 'widthMm', 'thicknessMm', 'price'] as const) await wrapper.get(`#product-${field}`).setValue(String(product[field]))
      await submit(wrapper, 'product')
      await vi.waitFor(() => { expect(wrapper.text()).toContain(mode === 'edit' ? 'Product updated.' : 'Product created.') })
      const materials = await persistence.materials.list(); const products = await persistence.supplierProducts.list()
      if (!materials.ok || !products.ok) throw new Error('Read failed')
      const resolved = materials.value.find(item => item.libraryPresetId === 'pin')
      expect(resolved).toMatchObject({ name: 'Pin', category: 'Softwoods' })
      expect(products.value[0]?.materialId).toBe(resolved?.id)
      if (mode === 'edit') expect(products.value[0]?.id).toBe(product.id)
      expect(await persistence.stockItems.list()).toEqual({ ok: true, value: [] })
      wrapper.unmount()
    } finally { persistence.close() }
  })

  it('retains the selected preset and product draft after an atomic save failure', async () => {
    const repositories = setup()
    const saveWithPreset = vi.fn().mockResolvedValue(failure)
    const wrapper = render({ ...repositories, supplierProducts: { ...repositories.supplierProducts, saveWithPreset } })
    await flushPromises(); await fillProduct(wrapper)
    await selectMaterial(wrapper, 'preset:chene'); await submit(wrapper, 'product'); await flushPromises()
    expect(saveWithPreset).toHaveBeenCalledOnce()
    expect(repositories.materials.create).not.toHaveBeenCalled()
    expect(wrapper.get<HTMLButtonElement>('#product-material').element.value).toBe('preset:chene')
    expect(wrapper.get<HTMLInputElement>('#product-name').element.value).toBe(product.name)
    expect(wrapper.find('#inline-material-fields').exists()).toBe(false)
    expect(wrapper.text()).toContain('Could not access local storage')
  })

  it('keeps same-name scratch materials distinct and does not interpret an existing opaque ID as a preset', async () => {
    const repositories = setup()
    const custom = materialSchema.parse({ ...material, id: 'preset:pin', name: 'Pin', category: 'Softwoods' })
    repositories.materials.list.mockResolvedValue({ ok: true, value: [custom] })
    repositories.materials.create.mockImplementation(record => Promise.resolve({ ok: true, value: materialSchema.parse(record) }))
    const wrapper = render(repositories); await flushPromises(); await openForm(wrapper, 'product')
    await selectMaterial(wrapper, custom.id)
    expect(wrapper.get<HTMLButtonElement>('#product-material').element.value).toBe(custom.id)
    await wrapper.get('#product-material').trigger('click')
    expect(wrapper.find('[role="option"][data-value="preset:pin:"]').exists()).toBe(true)
    await wrapper.get('input[aria-label="Search materials"]').trigger('keydown', { key: 'Escape' })
    await openCustomMaterial(wrapper)
    await wrapper.get('#inline-material-name').setValue(custom.name); await wrapper.get('#inline-material-category').setValue(custom.category)
    await button(wrapper, 'Create and select material').trigger('click'); await flushPromises()
    expect(repositories.materials.create).toHaveBeenCalledOnce()
    const created = materialSchema.parse(repositories.materials.create.mock.calls[0]?.[0])
    expect(created.id).not.toBe(custom.id); expect(created).not.toHaveProperty('libraryPresetId')
    expect(wrapper.get<HTMLButtonElement>('#product-material').element.value).toBe(created.id)
  })

  it('shows supplier favicons in navigation/header and updates material previews when products are selected', async () => {
    const repositories = setup()
    const pine = materialSchema.parse({ ...material, name: 'Pin Douglas', libraryPresetId: 'pin' })
    const custom = materialSchema.parse({ ...material, id: 'custom-material', name: 'Chêne' })
    const otherProduct = supplierProductSchema.parse({ ...product, id: 'other-product', materialId: custom.id })
    repositories.materials.list.mockResolvedValue({ ok: true, value: [pine, custom] })
    repositories.supplierProducts.list.mockResolvedValue({ ok: true, value: [product, otherProduct] })
    const wrapper = render(repositories); await flushPromises()
    expect(wrapper.get('nav[aria-label="Catalog suppliers"] img').attributes('src')).toBe('https://timber.example.com/favicon.ico')
    expect(wrapper.get('.catalog-supplier-header img').attributes('src')).toBe('https://timber.example.com/favicon.ico')
    expect(wrapper.find('#product-details figure img').exists()).toBe(true)
    const rows = wrapper.findAll('button[aria-label="View product ' + product.name + '"]')
    await rows[1]?.trigger('click')
    expect(wrapper.find('#product-details figure img').exists()).toBe(false)
    expect(wrapper.get('#product-details figure').text()).toContain('No texture available')
    await rows[0]?.trigger('click')
    expect(wrapper.find('#product-details figure img').exists()).toBe(true)
  })

  it('offers the local presets without creating records, keeps a renamed thumbnail and the product draft', async () => {
    const repositories = setup()
    repositories.materials.create.mockImplementation(record => Promise.resolve({ ok: true, value: materialSchema.parse(record) }))
    const wrapper = render(repositories); await flushPromises(); await fillProduct(wrapper)
    await openCustomMaterial(wrapper)
    expect(wrapper.findAll('input[name="material-preset"]')).toHaveLength(21)
    for (const category of ['Hardwoods', 'Softwoods', 'Exotic woods', 'Engineered wood panels']) expect(wrapper.text()).toContain(category)
    await wrapper.get('#material-library-search').setValue('pin')
    expect(wrapper.findAll('input[name="material-preset"]')).toHaveLength(3) // Pin and Sapin, plus custom
    await wrapper.get('input[value="pin"]').setValue(true)
    expect(repositories.materials.create).not.toHaveBeenCalled()
    expect(wrapper.get<HTMLInputElement>('#inline-material-name').element.value).toBe('Pin')
    await wrapper.get('#inline-material-name').setValue('Pin Douglas')
    await button(wrapper, 'Create and select material').trigger('click'); await flushPromises()
    const created = materialSchema.parse(repositories.materials.create.mock.calls[0]?.[0])
    expect(created).toMatchObject({ name: 'Pin Douglas', category: 'Softwoods', libraryPresetId: 'pin' })
    expect(wrapper.get<HTMLButtonElement>('#product-material').element.value).toBe(created.id)
    expect(wrapper.get<HTMLInputElement>('#product-name').element.value).toBe(product.name)
    expect(wrapper.get<HTMLInputElement>('#product-thicknessMm').element.value).toBe(String(product.thicknessMm))
  })

  it('reuses an identical material without creating duplicate records or selection options', async () => {
    const repositories = setup()
    const preset = materialSchema.parse({ ...material, id: 'preset-material', name: 'Pin', category: 'Softwoods', libraryPresetId: 'pin' })
    repositories.materials.list.mockResolvedValue({ ok: true, value: [material, preset] })
    const wrapper = render(repositories); await flushPromises(); await fillProduct(wrapper)
    await openCustomMaterial(wrapper); await wrapper.get('input[value="pin"]').setValue(true)
    await button(wrapper, 'Create and select material').trigger('click'); await flushPromises()
    expect(repositories.materials.create).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Existing material selected; no duplicate created.')
    await wrapper.get('#product-material').trigger('click')
    expect(wrapper.findAll('[role="option"]')).toHaveLength(22)
  })

  it('keeps preset metadata and editable drafts after validation or storage failure; custom clears the image', async () => {
    const repositories = setup(); repositories.materials.create.mockResolvedValue(failure)
    const wrapper = render(repositories); await flushPromises(); await fillProduct(wrapper)
    await openCustomMaterial(wrapper); await wrapper.get('input[value="pin"]').setValue(true)
    await wrapper.get('#inline-material-name').setValue(' ')
    await button(wrapper, 'Create and select material').trigger('click')
    expect(repositories.materials.create).not.toHaveBeenCalled()
    await wrapper.get('#inline-material-name').setValue('Pin Douglas')
    await button(wrapper, 'Create and select material').trigger('click'); await flushPromises()
    expect(wrapper.find('#inline-material-fields [role="alert"]').exists()).toBe(true)
    expect(wrapper.get<HTMLInputElement>('input[value="pin"]').element.checked).toBe(true)
    expect(wrapper.get<HTMLInputElement>('#inline-material-name').element.value).toBe('Pin Douglas')
    await wrapper.get('input[name="material-preset"]:not([value])').setValue(true)
    await wrapper.get('#inline-material-name').setValue('Custom board'); await wrapper.get('#inline-material-category').setValue('Boards')
    await button(wrapper, 'Create and select material').trigger('click'); await flushPromises()
    expect(repositories.materials.create.mock.calls[1]?.[0]).not.toHaveProperty('libraryPresetId')
  })

  it('shows only associated local material thumbnails in catalog headings', async () => {
    const repositories = setup()
    repositories.materials.list.mockResolvedValue({ ok: true, value: [materialSchema.parse({ ...material, libraryPresetId: 'pin' })] })
    repositories.supplierProducts.list.mockResolvedValue({ ok: true, value: [product] })
    const wrapper = render(repositories); await flushPromises()
    const image = wrapper.get('.catalog-material-header img')
    expect(image.attributes('loading')).toBe('lazy')
    expect(image.attributes('alt')).toBe('')
  })

  it('validates only the required Material fields before writing', async () => {
    const repositories = setup()
    const wrapper = render(repositories)
    await flushPromises()
    await fillProduct(wrapper)
    await openCustomMaterial(wrapper)
    await wrapper.get('#inline-material-name').setValue('   ')
    await button(wrapper, 'Create and select material').trigger('click')
    expect(wrapper.get('#inline-material-name').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('#inline-material-category').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('#inline-material-fields').findAll('input[required]')).toHaveLength(2)
    expect(document.activeElement).toBe(wrapper.get('#inline-material-name').element)
    expect(repositories.materials.create).not.toHaveBeenCalled()
    expect(wrapper.get<HTMLInputElement>('#product-name').element.value).toBe(product.name)
    expect(wrapper.get<HTMLButtonElement>('#product-material').element.value).toBe(material.id)
  })

  it.each(['storageFailure', 'duplicateId', 'invalidRecord'] as const)('keeps both drafts after inline %s and supports retry', async (kind) => {
    const repositories = setup()
    const error = kind === 'storageFailure' ? failure.error : kind === 'duplicateId' ? { kind, id: material.id } : { kind, issues: [{ path: ['name'], message: 'Invalid material' }] }
    repositories.materials.create.mockResolvedValueOnce({ ok: false, error })
    const wrapper = render(repositories)
    await flushPromises()
    await fillProduct(wrapper)
    await openCustomMaterial(wrapper)
    await wrapper.get('#inline-material-name').setValue('New material')
    await wrapper.get('#inline-material-category').setValue('Plywood')
    await button(wrapper, 'Create and select material').trigger('click')
    await flushPromises()
    expect(wrapper.get('#inline-material-fields [role="alert"]').text()).not.toBe('')
    expect(wrapper.get<HTMLInputElement>('#inline-material-name').element.value).toBe('New material')
    expect(wrapper.get<HTMLInputElement>('#product-name').element.value).toBe(product.name)
    expect(wrapper.get<HTMLButtonElement>('#product-material').element.value).toBe(material.id)
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
    await openCustomMaterial(wrapper)
    await wrapper.get('#inline-material-name').setValue('Unsaved')
    await button(wrapper, 'Cancel material').trigger('click')
    expect(wrapper.find('#inline-material-fields').exists()).toBe(false)
    expect(wrapper.get<HTMLButtonElement>('#product-material').element.value).toBe(material.id)
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
    await openCustomMaterial(wrapper)
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

  it.each([false, true])('persists an inline material and its product through the existing repositories (preset=%s)', async (preset) => {
    const indexedDB = new IDBFactory()
    const first = createLocalPersistence('inline-material-persistence', { indexedDB, IDBKeyRange })
    const second = createLocalPersistence('inline-material-persistence', { indexedDB, IDBKeyRange })
    try {
      await first.suppliers.create(supplier)
      const wrapper = render(createCatalogRepositories(first))
      await vi.waitFor(() => { expect(button(wrapper, '+ Add Product').attributes('disabled')).toBeUndefined() })
      await openForm(wrapper, 'product')
      await wrapper.get('#product-name').setValue(product.name)
      await wrapper.get('#product-supplier').setValue(supplier.id)
      for (const field of ['lengthMm', 'widthMm', 'thicknessMm', 'price'] as const) await wrapper.get(`#product-${field}`).setValue(String(product[field]))
      await openCustomMaterial(wrapper)
      if (preset) await wrapper.get('input[value="pin"]').setValue(true)
      await wrapper.get('#inline-material-name').setValue(material.name)
      await wrapper.get('#inline-material-category').setValue(material.category)
      await button(wrapper, 'Create and select material').trigger('click')
      await vi.waitFor(() => { expect(wrapper.text()).toContain('Material created and selected.') })
      const selectedId = wrapper.get<HTMLButtonElement>('#product-material').element.value
      await submit(wrapper, 'product')
      await vi.waitFor(() => { expect(wrapper.text()).toContain('Product created.') })
      wrapper.unmount()
      first.close()
      const storedMaterials = await second.materials.list()
      const storedProducts = await second.supplierProducts.list()
      expect(storedMaterials).toMatchObject({ ok: true, value: [{ id: selectedId, name: material.name, category: material.category }] })
      if (preset) expect(storedMaterials).toMatchObject({ ok: true, value: [{ libraryPresetId: 'pin' }] })
      else if (storedMaterials.ok) expect(storedMaterials.value[0]).not.toHaveProperty('libraryPresetId')
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
    expect(wrapper.find('form').exists()).toBe(false)
    resolve?.({ ok: true, value: [] })
    await flushPromises()
    expect(wrapper.text()).toContain('No suppliers yet')
    expect(wrapper.text()).toContain('No catalog products yet')
    expect(button(wrapper, '+ Add Product').attributes('disabled')).toBeDefined()
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
    expect(wrapper.find('#supplier-name').exists()).toBe(false)
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
    await openForm(wrapper, 'supplier')
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
    expect(document.activeElement).toBe(button(wrapper, '+ Add Supplier').element)
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
    expect(wrapper.findAll('nav[aria-label="Catalog suppliers"] button').map(item => item.attributes('aria-label'))).toEqual([`Select supplier ${supplier.name}`, `Select supplier ${secondSupplier.name}`])
    expect(wrapper.findAll('table')).toHaveLength(1)
    expect(wrapper.get('h3').text()).toBe(material.name)
    await selectProduct(wrapper)
    for (const text of [product.name, '2500 × 1250 × 18 mm', 'Thickness18 mm', '89.9 EUR', 'Along length', 'Available']) expect(wrapper.text()).toContain(text)
    expect(wrapper.get(`a[href="${product.productUrl ?? ''}"]`).attributes('rel')).toBe('noopener noreferrer')
    await wrapper.get(`button[aria-label="Select supplier ${secondSupplier.name}"]`).trigger('click')
    expect(wrapper.text()).toContain('Fiberboard'); expect(wrapper.text()).toContain(secondProduct.name)
    expect(wrapper.find(`button[aria-label="View product ${product.name}"]`).exists()).toBe(false)

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
    expect(wrapper.find('#product-name').exists()).toBe(false)
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
    await selectProduct(wrapper)
    await wrapper.get(`button[aria-label="Edit product ${product.name}"]`).trigger('click')
    await wrapper.get('#product-name').setValue('Updated product')
    await wrapper.get('#product-supplier').setValue(alternateSupplier.id)
    await selectMaterial(wrapper, alternateMaterial.id)
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
    if (entity === 'product') await selectProduct(wrapper)
    await wrapper.get(`button[aria-label="Edit ${entity} ${entity === 'supplier' ? supplier.name : product.name}"]`).trigger('click')
    await wrapper.get(`#${entity}-name`).setValue('Unsaved')
    await button(wrapper, 'Cancel').trigger('click')
    expect(wrapper.find(`#${entity}-name`).exists()).toBe(false)
    expect(repositories.suppliers.update).not.toHaveBeenCalled()
    expect(repositories.supplierProducts.update).not.toHaveBeenCalled()
  })

  it('confirms product deletion and clears an edited deleted record', async () => {
    const repositories = setup()
    repositories.supplierProducts.list.mockResolvedValueOnce({ ok: true, value: [product] }).mockResolvedValue({ ok: true, value: [] })
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const wrapper = render(repositories)
    await flushPromises()
    await selectProduct(wrapper)
    await wrapper.get(`button[aria-label="Edit product ${product.name}"]`).trigger('click')
    const action = wrapper.get(`button[aria-label="Delete product ${product.name}"]`)
    await action.trigger('click')
    expect(repositories.supplierProducts.delete).not.toHaveBeenCalled()
    confirmation.mockReturnValue(true)
    await action.trigger('click')
    await flushPromises()
    expect(repositories.supplierProducts.delete).toHaveBeenCalledExactlyOnceWith(product.id)
    expect(wrapper.text()).toContain('No catalog products yet')
    expect(wrapper.find('#product-name').exists()).toBe(false)
  })

  it('requires dimensions, name, price, supplier and material selection', async () => {
    const repositories = setup()
    const wrapper = render(repositories)
    await flushPromises()
    await openForm(wrapper, 'product')
    await wrapper.get('#product-supplier').setValue('')
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
    await wrapper.get('button[aria-label="Select supplier Missing supplier"]').trigger('click')
    expect(wrapper.text()).toContain('Missing material')
    await selectProduct(wrapper)
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
    expect(wrapper.find('#product-supplier').exists()).toBe(false)
    await wrapper.get(`button[aria-label="Add product for ${supplier.name}"]`).trigger('click')
    expect(wrapper.get<HTMLSelectElement>('#product-supplier').element.value).toBe(supplier.id)
    expect(wrapper.get<HTMLButtonElement>('#product-material').element.value).toBe('')
  })

  it('offers inline creation and presets in an empty catalog but requires a material selection', async () => {
    const repositories = setup()
    repositories.materials.list.mockResolvedValue({ ok: true, value: [] })
    const wrapper = render(repositories)
    await flushPromises()
    await openForm(wrapper, 'product')
    await wrapper.get('#product-material').trigger('click')
    expect(button(wrapper, '+ Create custom material').exists()).toBe(true)
    await wrapper.get('input[aria-label="Search materials"]').trigger('keydown', { key: 'Escape' })
    expect(button(wrapper, 'Create product').attributes('disabled')).toBeUndefined()
    await submit(wrapper, 'product')
    expect(wrapper.get('#product-material').attributes('aria-invalid')).toBe('true')
    expect(repositories.supplierProducts.create).not.toHaveBeenCalled()
  })

  it.each(['suppliers', 'supplierProducts', 'materials'] as const)('reports %s read errors and supports retry', async (store) => {
    const repositories = setup()
    repositories[store].list.mockResolvedValueOnce(failure)
    const wrapper = render(repositories)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not access local storage')
    expect(wrapper.text()).not.toContain('No suppliers yet')
    expect(wrapper.find('form').exists()).toBe(false)
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
    if (entity === 'product') await selectProduct(wrapper)
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
    if (entity === 'product') await selectProduct(wrapper)
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
    expect(button(wrapper, 'Close form').attributes('disabled')).toBeDefined()
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
      expect(reopened.get('table').text()).toContain('2500 × 1250')
      expect(reopened.get('table tbody td').text()).toBe('2500 × 1250')
      await selectProduct(reopened)
      expect(reopened.get('#product-details').text()).toContain('2500 × 1250 × 18 mm')
      expect(reopened.get('#product-details [aria-label="Product specifications"] dl').text()).toContain('Thickness18 mm')
      expect(await second.stockItems.list()).toEqual({ ok: true, value: [] })
    } finally { first.close(); second.close() }
  })
})
