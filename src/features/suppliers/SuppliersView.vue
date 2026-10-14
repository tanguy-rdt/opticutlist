<script setup lang="ts">
import { computed, watch, nextTick, onMounted, onBeforeUnmount, ref, shallowRef } from 'vue'
import type { StockItem } from '../../domain/model/stock-item'
import type { Material } from '../../domain/model/material'
import type { Supplier } from '../../domain/model/supplier'
import type { SupplierProduct } from '../../domain/model/supplier-product'
import { persistenceErrorMessage } from '../../shared/ui/persistence-error-message'
import { useMaterialRepository } from '../materials/material-repository'
import { useCatalogRepositories, useCatalogStockRepository } from './catalog-repositories'
import SupplierForm from './SupplierForm.vue'
import ProductForm from './ProductForm.vue'
import MaterialThumbnail from '../materials/MaterialThumbnail.vue'
import { useDataImportRefresh } from '../../app/settings/use-data-import-refresh'
import ProductDetails from './ProductDetails.vue'
import SupplierLogo from './SupplierLogo.vue'
import AppIcon from '../../shared/ui/AppIcon.vue'
import CatalogFormDialog from './CatalogFormDialog.vue'

const repositories = useCatalogRepositories()
const stockRepository = useCatalogStockRepository()
const stock = shallowRef<readonly StockItem[]>([])
const stockError = ref('')
const selectedSupplierId = ref('')
const selectedProductId = ref('')
const detailsOpen = ref(false)
const compactDetails = ref(false)
const viewport = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 767px)') : null
function updateViewport(): void { compactDetails.value = viewport?.matches ?? false; if (!compactDetails.value) detailsOpen.value = false }
updateViewport()
onMounted(() => { if (typeof viewport?.addEventListener === 'function') viewport.addEventListener('change', updateViewport) })
onBeforeUnmount(() => { if (typeof viewport?.removeEventListener === 'function') viewport.removeEventListener('change', updateViewport) })
const search = ref('')
const supplierSearch = ref('')
const categoryFilter = ref('')
const materialFilter = ref('')
const availabilityFilter = ref('')
const formMode = ref<'supplier' | 'product' | null>(null)
const addSupplierButton = ref<HTMLButtonElement | null>(null)
let generation = 0
onBeforeUnmount(() => { generation++ })
const materialRepository = useMaterialRepository()
const suppliers = shallowRef<readonly Supplier[]>([])
const products = shallowRef<readonly SupplierProduct[]>([])
const materials = shallowRef<readonly Material[]>([])
const loading = ref(true)
const busy = ref(false)
const loadError = ref('')
const operationError = ref('')
const notice = ref('')
const editingSupplier = shallowRef<Supplier | null>(null)
const editingProduct = shallowRef<SupplierProduct | null>(null)
const supplierVersion = ref(0)
const productVersion = ref(0)
const initialSupplierId = ref('')
const supplierForm = ref<InstanceType<typeof SupplierForm> | null>(null)
const productForm = ref<InstanceType<typeof ProductForm> | null>(null)
useDataImportRefresh(() => { void load() }, () => !loading.value && !busy.value && formMode.value === null)
const disabled = computed(() => loading.value || busy.value || Boolean(loadError.value))
const supplierNavigation = computed(() => [...new Set([...suppliers.value.map(item => item.id), ...products.value.map(item => item.supplierId)])].map(id => ({ id, supplier: suppliers.value.find(item => item.id === id), name: suppliers.value.find(item => item.id === id)?.name ?? 'Missing supplier', count: products.value.filter(item => item.supplierId === id).length })))
const selectedSupplier = computed(() => suppliers.value.find(item => item.id === selectedSupplierId.value))
const selectedProduct = computed(() => products.value.find(item => item.id === selectedProductId.value))
const supplierMaterials = computed(() => materials.value.filter(material => products.value.some(product => product.supplierId === selectedSupplierId.value && product.materialId === material.id)))
const categories = computed(() => [...new Set(supplierMaterials.value.map(material => material.category))])
const sections = computed(() => {
  const grouped = new Map<string, SupplierProduct[]>()
  for (const product of products.value) {
    const material = materials.value.find(item => item.id === product.materialId)
    if (product.supplierId !== selectedSupplierId.value || (categoryFilter.value && material?.category !== categoryFilter.value) || (materialFilter.value && product.materialId !== materialFilter.value) || (availabilityFilter.value && product.availability !== availabilityFilter.value)) continue
    if (search.value && !`${product.name} ${material?.name ?? ''} ${material?.category ?? ''}`.toLocaleLowerCase().includes(search.value.toLocaleLowerCase().trim())) continue
    const group = grouped.get(product.materialId) ?? []; group.push(product); grouped.set(product.materialId, group)
  }
  return [...grouped].map(([id, items]) => ({ id, material: materials.value.find(item => item.id === id), items }))
})
watch(sections, visibleSections => {
  const visibleProducts = visibleSections.flatMap(section => section.items)
  if (!visibleProducts.some(product => product.id === selectedProductId.value)) {
    selectedProductId.value = visibleProducts[0]?.id ?? ''
    detailsOpen.value = false
  }
})
const ownedPanelQuantity = computed(() => stock.value
  .filter(item => item.kind === 'fullPanel')
  .reduce((quantity, item) => quantity + item.quantity, 0))

function selectSupplier(id: string): void {
  selectedSupplierId.value = id
  detailsOpen.value = false
  materialFilter.value = ''
  categoryFilter.value = ''
  selectedProductId.value = sections.value[0]?.items[0]?.id ?? ''
}
async function inspectProduct(id: string): Promise<void> {
  selectedProductId.value = id
  if (compactDetails.value) detailsOpen.value = true
  await nextTick()
  if (compactDetails.value) document.getElementById('product-details-title')?.focus()
}

function linkedStock(product: SupplierProduct): readonly StockItem[] { return stock.value.filter(item => item.provenance.source === 'purchase' && item.provenance.supplierProductId === product.id) }
function stockLabel(product: SupplierProduct): string { return !stockRepository ? 'Not available' : stockError.value ? 'Read error' : `${String(linkedStock(product).reduce((quantity, item) => quantity + item.quantity, 0))} owned` }
function availability(product: SupplierProduct): string { return product.availability === 'available' ? 'Available' : product.availability === 'unavailable' ? 'Unavailable' : 'Unknown' }
function closeForm(): void { if (!busy.value) { formMode.value = null; operationError.value = '' } }

async function load(): Promise<void> {
  const current = ++generation
  loading.value = true
  const [supplierResult, productResult, materialResult] = await Promise.all([repositories.suppliers.list(), repositories.supplierProducts.list(), materialRepository.list()])
  if (current !== generation) return
  const errors: string[] = []
  if (supplierResult.ok) suppliers.value = supplierResult.value
  else errors.push(persistenceErrorMessage(supplierResult.error, 'Supplier'))
  if (productResult.ok) products.value = productResult.value
  else errors.push(persistenceErrorMessage(productResult.error, 'Product'))
  if (materialResult.ok) materials.value = materialResult.value
  else errors.push(persistenceErrorMessage(materialResult.error, 'Material'))
  loadError.value = errors.join(' ')
  if (!supplierNavigation.value.some(item => item.id === selectedSupplierId.value)) selectedSupplierId.value = supplierNavigation.value[0]?.id ?? ''
  if (!products.value.some(item => item.id === selectedProductId.value)) selectedProductId.value = ''
  stockError.value = ''
  if (stockRepository) {
    const result = await stockRepository.list()
    if (current !== generation) return
    if (result.ok) stock.value = result.value
    else { stock.value = []; stockError.value = persistenceErrorMessage(result.error, 'Product') }
  }
  loading.value = false
}
async function editSupplier(supplier: Supplier | null): Promise<void> {
  if (disabled.value) return
  detailsOpen.value = false
  formMode.value = 'supplier'
  editingSupplier.value = supplier
  supplierVersion.value++
  operationError.value = ''
  notice.value = ''
  await nextTick()
  supplierForm.value?.focusName()
}
async function editProduct(product: SupplierProduct | null, supplierId = ''): Promise<void> {
  if (disabled.value) return
  detailsOpen.value = false
  formMode.value = 'product'
  editingProduct.value = product
  initialSupplierId.value = supplierId
  productVersion.value++
  operationError.value = ''
  notice.value = ''
  await nextTick()
  productForm.value?.focusName()
}
async function saveSupplier(supplier: Supplier): Promise<void> {
  if (disabled.value) return
  busy.value = true
  notice.value = ''
  operationError.value = ''
  const result = editingSupplier.value ? await repositories.suppliers.update(supplier.id, supplier) : await repositories.suppliers.create(supplier)
  if (result.ok) {
    notice.value = editingSupplier.value ? 'Supplier updated.' : 'Supplier created.'
    selectedSupplierId.value = result.value.id
    editingSupplier.value = null
    formMode.value = null
    supplierVersion.value++
    await load()
  } else operationError.value = persistenceErrorMessage(result.error, 'Supplier')
  busy.value = false
  await nextTick()
  if (formMode.value) supplierForm.value?.focusName()
  else addSupplierButton.value?.focus()
}
async function saveProduct(product: SupplierProduct, presetId?: string): Promise<void> {
  if (disabled.value) return
  busy.value = true
  notice.value = ''
  operationError.value = ''
  const result = presetId !== undefined
    ? await repositories.supplierProducts.saveWithPreset(product, presetId, editingProduct.value?.id)
    : editingProduct.value ? await repositories.supplierProducts.update(product.id, product) : await repositories.supplierProducts.create(product)
  if (result.ok) {
    notice.value = editingProduct.value ? 'Product updated.' : 'Product created.'
    selectedSupplierId.value = result.value.supplierId
    selectedProductId.value = result.value.id
    editingProduct.value = null
    formMode.value = null
    productVersion.value++
    await load()
  } else operationError.value = result.error.kind === 'notFound'
    ? 'The product, selected supplier, or material no longer exists. Refresh the catalog and check your selections.'
    : persistenceErrorMessage(result.error, 'Product')
  busy.value = false
  await nextTick()
  productForm.value?.focusName()
}
async function removeSupplier(supplier: Supplier): Promise<void> {
  if (disabled.value || !window.confirm(`Delete supplier “${supplier.name}”? This cannot be undone.`)) return
  busy.value = true
  notice.value = ''
  operationError.value = ''
  const result = await repositories.suppliers.delete(supplier.id)
  if (result.ok) {
    if (editingSupplier.value?.id === supplier.id) { editingSupplier.value = null; supplierVersion.value++; formMode.value = null }
    notice.value = 'Supplier deleted.'
    await load()
  } else operationError.value = persistenceErrorMessage(result.error, 'Supplier')
  busy.value = false
  await nextTick()
  addSupplierButton.value?.focus()
}
async function removeProduct(product: SupplierProduct): Promise<void> {
  if (disabled.value || !window.confirm(`Delete catalog product “${product.name}”? This cannot be undone.`)) return
  busy.value = true
  notice.value = ''
  operationError.value = ''
  const result = await repositories.supplierProducts.delete(product.id)
  if (result.ok) {
    if (editingProduct.value?.id === product.id) { editingProduct.value = null; productVersion.value++; formMode.value = null }
    notice.value = 'Product deleted.'
    await load()
  } else operationError.value = persistenceErrorMessage(result.error, 'Product')
  busy.value = false
  await nextTick()
  productForm.value?.focusName()
}
onMounted(load)
</script>
<template>
  <section class="catalog-page min-w-0 space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div class="space-y-1">
        <h1 class="text-[28px] font-semibold leading-tight tracking-tight">
          Catalog
        </h1>
        <p class="text-sm text-muted">
          Your global library of suppliers, materials and purchasable panels.
        </p>
      </div>
    </div>
    <dl
      aria-label="Catalog summary"
      class="catalog-summary grid grid-cols-2 gap-3 lg:grid-cols-4"
    >
      <div class="catalog-summary-card">
        <span class="catalog-icon"><AppIcon name="supplier" /></span>
        <dt>Suppliers</dt>
        <dd>{{ loading || loadError ? '—' : suppliers.length }}</dd>
        <p v-if="!loading && !loadError">
          {{ products.length }} product references
        </p>
      </div>
      <div class="catalog-summary-card">
        <span class="catalog-icon"><AppIcon name="layers" /></span>
        <dt>Materials</dt>
        <dd>{{ loading || loadError ? '—' : materials.length }}</dd>
        <p v-if="!loading && !loadError">
          {{ new Set(materials.map(material => material.category)).size }} {{ new Set(materials.map(material => material.category)).size === 1 ? 'category' : 'categories' }}
        </p>
      </div>
      <div class="catalog-summary-card">
        <span class="catalog-icon"><AppIcon name="products" /></span>
        <dt>Product references</dt>
        <dd>{{ loading || loadError ? '—' : products.length }}</dd>
        <p>Across all suppliers</p>
      </div>
      <div class="catalog-summary-card">
        <span class="catalog-icon"><AppIcon name="stock" /></span>
        <dt>Owned panels<span class="sr-only"> (full panels, excluding offcuts)</span></dt>
        <dd>{{ loading || !stockRepository || stockError ? '—' : ownedPanelQuantity }}</dd>
        <p>{{ stockError || !stockRepository ? 'Inventory unavailable' : 'Full panels in your inventory' }}</p>
      </div>
    </dl>
    <p
      v-if="notice"
      role="status"
      class="rounded-lg border border-success bg-success-surface px-4 py-3 text-sm text-success"
    >
      {{ notice }}
    </p>
    <p
      v-if="operationError && !formMode"
      role="alert"
      class="text-danger"
    >
      {{ operationError }}
    </p>
    <p
      v-if="loading"
      role="status"
      class="panel p-8 text-muted"
    >
      Loading supplier catalog…
    </p>
    <div
      v-else-if="loadError"
      class="panel space-y-4 p-6"
    >
      <p
        role="alert"
        class="text-danger"
      >
        {{ loadError }}
      </p>
      <button
        type="button"
        class="button catalog-action"
        :disabled="busy"
        @click="load"
      >
        Try again
      </button>
    </div>
    <div
      v-else
      class="catalog-workspace grid min-w-0 items-start gap-4 md:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_300px] 2xl:grid-cols-[220px_minmax(0,1fr)_330px]"
    >
      <aside
        class="panel catalog-supplier-nav space-y-4 p-4 md:sticky md:top-5"
        aria-labelledby="supplier-nav-title"
      >
        <div class="flex items-center justify-between gap-2">
          <h2
            id="supplier-nav-title"
            class="font-semibold"
          >
            Suppliers
          </h2>
          <span class="text-xs text-muted">{{ suppliers.length }}</span>
        </div>
        <button
          ref="addSupplierButton"
          type="button"
          class="button catalog-action button-primary w-full"
          :disabled="disabled"
          @click="editSupplier(null)"
        >
          <AppIcon name="plus" /><span><span class="sr-only">+ </span>Add Supplier</span>
        </button>
        <label
          for="supplier-search"
          class="sr-only"
        >Find a supplier</label>
        <input
          id="supplier-search"
          v-model="supplierSearch"
          type="search"
          class="field"
          placeholder="Find a supplier…"
        >
        <nav
          aria-label="Catalog suppliers"
          class="flex gap-2 overflow-x-auto md:max-h-[60dvh] md:flex-col md:overflow-y-auto"
        >
          <button
            v-for="supplier in supplierNavigation.filter(item => item.name.toLocaleLowerCase().includes(supplierSearch.toLocaleLowerCase().trim()))"
            :key="supplier.id"
            type="button"
            class="flex min-w-40 items-center justify-between gap-3 rounded-lg border px-3 py-3 text-left text-sm md:min-w-0"
            :class="selectedSupplierId === supplier.id ? 'border-selection-line bg-subtle text-accent' : 'border-transparent hover:bg-subtle'"
            :aria-pressed="selectedSupplierId === supplier.id"
            :aria-label="`Select supplier ${supplier.name}`"
            @click="selectSupplier(supplier.id)"
          >
            <SupplierLogo :website-url="supplier.supplier?.websiteUrl" />
            <span class="min-w-0 flex-1">
              <span class="block font-semibold [overflow-wrap:anywhere]">{{ supplier.name }}</span>
              <span class="mt-1 block text-xs text-muted">{{ supplier.count }} product references</span>
            </span>
            <AppIcon name="chevron" />
          </button>
        </nav>
        <p
          v-if="!supplierNavigation.length"
          class="text-sm text-muted"
        >
          No suppliers yet. Add your first supplier to start your catalog.
        </p>
        <p
          v-else-if="!supplierNavigation.some(item => item.name.toLocaleLowerCase().includes(supplierSearch.toLocaleLowerCase().trim()))"
          class="text-sm text-muted"
        >
          No matching suppliers.
        </p>
      </aside>
      <section
        class="min-w-0 space-y-4"
        aria-labelledby="supplier-content-title"
      >
        <div class="panel catalog-supplier-header space-y-3 p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="flex min-w-0 items-center gap-3">
              <SupplierLogo
                :website-url="selectedSupplier?.websiteUrl"
                size="large"
                class="hidden sm:flex"
              />
              <div class="min-w-0">
                <h2
                  id="supplier-content-title"
                  class="text-xl font-semibold"
                >
                  {{ selectedSupplier?.name ?? (selectedSupplierId ? 'Missing supplier' : 'Select a supplier') }}
                </h2>
                <a
                  v-if="selectedSupplier?.websiteUrl"
                  :href="selectedSupplier.websiteUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="mt-2 inline-flex max-w-full items-center gap-2 text-sm text-muted hover:text-accent [overflow-wrap:anywhere]"
                ><span>{{ selectedSupplier.websiteUrl }}</span><AppIcon name="external" /><span class="sr-only"> (opens in new tab)</span></a>
              </div>
            </div>
            <div class="catalog-supplier-actions flex flex-wrap justify-end gap-x-2 gap-y-5">
              <button
                v-if="selectedSupplier"
                type="button"
                class="button catalog-action"
                :disabled="disabled"
                :aria-label="`Edit supplier ${selectedSupplier.name}`"
                @click="editSupplier(selectedSupplier)"
              >
                <AppIcon name="edit" />Edit supplier
              </button>
              <button
                v-if="selectedSupplier"
                type="button"
                class="button catalog-action button-danger"
                :disabled="disabled"
                :aria-label="`Delete supplier ${selectedSupplier.name}`"
                @click="removeSupplier(selectedSupplier)"
              >
                <AppIcon name="delete" />Delete supplier
              </button>
              <button
                type="button"
                class="button catalog-action button-primary"
                :disabled="disabled || !selectedSupplier"
                :aria-label="`Add product for ${selectedSupplier?.name ?? 'supplier'}`"
                @click="editProduct(null, selectedSupplierId)"
              >
                <AppIcon name="plus" /><span><span class="sr-only">+ </span>Add Product</span>
              </button>
              <button
                type="button"
                class="rounded px-2 py-1 text-xs font-medium text-muted hover:text-accent"
                :disabled="disabled"
                @click="load"
              >
                Refresh catalog
              </button>
            </div>
          </div>
          <div class="catalog-filters grid grid-cols-2 gap-2 xl:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
            <div>
              <label
                for="catalog-search"
                class="sr-only"
              >Search products</label>
              <div class="relative">
                <AppIcon
                  name="search"
                  class="pointer-events-none absolute top-2.5 left-3 text-muted"
                />
                <input
                  id="catalog-search"
                  v-model="search"
                  type="search"
                  class="field"
                  placeholder="Search products…"
                  style="padding-left: 2.25rem"
                >
              </div>
            </div>
            <div>
              <label
                for="catalog-category"
                class="sr-only"
              >Category</label><select
                id="catalog-category"
                v-model="categoryFilter"
                class="field"
              >
                <option value="">
                  All categories
                </option><option
                  v-for="category in categories"
                  :key="category"
                  :value="category"
                >
                  {{ category }}
                </option>
              </select>
            </div>
            <div>
              <label
                for="catalog-material"
                class="sr-only"
              >Material</label><select
                id="catalog-material"
                v-model="materialFilter"
                class="field"
              >
                <option value="">
                  All materials
                </option><option
                  v-for="material in supplierMaterials"
                  :key="material.id"
                  :value="material.id"
                >
                  {{ material.name }}
                </option>
              </select>
            </div>
            <div>
              <label
                for="catalog-availability"
                class="sr-only"
              >Availability</label><select
                id="catalog-availability"
                v-model="availabilityFilter"
                class="field"
              >
                <option value="">
                  Any availability
                </option><option value="available">
                  Available
                </option><option value="unavailable">
                  Unavailable
                </option><option value="unknown">
                  Unknown
                </option>
              </select>
            </div>
          </div>
        </div>
        <p
          v-if="products.length === 0"
          class="panel p-6 text-sm text-muted"
        >
          No catalog products yet. Add a product to create or select its material.
        </p>
        <p
          v-else-if="sections.length === 0"
          class="panel p-6 text-sm text-muted"
        >
          No products match this supplier and your filters.
        </p>
        <section
          v-for="section in sections"
          :key="section.id"
          class="panel min-w-0 overflow-hidden"
          :aria-label="section.material?.name ?? 'Missing material'"
        >
          <div class="catalog-material-header flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-4">
            <div class="flex items-center gap-4">
              <MaterialThumbnail :preset-id="section.material?.libraryPresetId" />
              <div>
                <h3 class="text-base font-semibold">
                  {{ section.material?.name ?? 'Missing material' }}
                </h3>
                <p class="mt-0.5 text-xs text-muted">
                  {{ section.items.length }} references · {{ section.material?.category ?? 'Missing material' }}
                </p>
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-xs text-muted">
              <p class="catalog-badge">
                {{ section.items.length }} references
              </p><p
                v-if="stockRepository && !stockError"
                class="catalog-badge bg-subtle text-accent"
              >
                {{ stock.filter(item => item.materialId === section.id).reduce((quantity, item) => quantity + item.quantity, 0) }} owned units for this material
              </p>
            </div>
          </div>
          <div
            class="relative overflow-x-auto"
            tabindex="0"
            role="region"
            :aria-label="`${section.material?.name ?? 'Missing material'} products; scroll horizontally for all columns`"
          >
            <table class="catalog-product-table w-full text-left text-sm">
              <caption class="sr-only">
                {{ section.material?.name ?? 'Missing material' }} panel products in millimeters
              </caption>
              <thead class="bg-quiet-surface text-xs text-muted">
                <tr>
                  <th
                    scope="col"
                    class="px-3 py-2"
                  >
                    Product
                  </th><th
                    scope="col"
                    class="px-3 py-2"
                  >
                    Dimensions (mm)<span class="sr-only"> (length × width)</span>
                  </th><th
                    scope="col"
                    class="px-3 py-2"
                  >
                    Thickness (mm)
                  </th><th
                    scope="col"
                    class="px-3 py-2"
                  >
                    Price / panel
                  </th><th
                    scope="col"
                    class="px-3 py-2"
                  >
                    Availability
                  </th><th
                    scope="col"
                    class="px-3 py-2"
                  >
                    Owned stock
                  </th><th
                    scope="col"
                    class="px-3 py-2"
                  >
                    <span class="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="product in section.items"
                  :key="product.id"
                  class="border-t border-line hover:bg-subtle"
                  :class="selectedProductId === product.id ? 'bg-subtle' : ''"
                  @click="inspectProduct(product.id)"
                >
                  <th
                    scope="row"
                    class="min-w-28 px-3 py-2.5 font-medium"
                  >
                    <button
                      type="button"
                      class="inline-flex items-center gap-4 rounded text-left underline-offset-4 hover:underline"
                      :aria-label="`View product ${product.name}`"
                      :aria-pressed="selectedProductId === product.id"
                      aria-controls="product-details"
                      @click.stop="inspectProduct(product.id)"
                    >
                      <span
                        class="catalog-selection-mark"
                        :class="selectedProductId === product.id ? 'border-accent bg-accent text-on-accent' : 'border-control-line bg-surface'"
                      >
                        <AppIcon
                          v-if="selectedProductId === product.id"
                          name="check"
                        />
                      </span>
                      {{ product.name }}
                    </button>
                  </th>
                  <td class="whitespace-nowrap px-3 py-2.5 tabular-nums">
                    {{ product.lengthMm }} × {{ product.widthMm }}
                  </td><td class="whitespace-nowrap px-3 py-2.5 tabular-nums">
                    {{ product.thicknessMm }}
                  </td><td class="whitespace-nowrap px-3 py-2.5 tabular-nums">
                    {{ product.price }} {{ product.currency }}
                  </td>
                  <td class="px-3 py-2.5">
                    <span
                      class="inline-flex rounded-md px-2 py-1 text-xs font-medium"
                      :class="product.availability === 'available' ? 'bg-success-surface text-success' : 'bg-quiet-surface text-muted'"
                    >{{ availability(product) }}</span>
                  </td>
                  <td class="whitespace-nowrap px-3 py-2.5 text-xs text-muted">
                    {{ stockLabel(product) }}
                  </td>
                  <td class="px-3 py-2.5">
                    <button
                      type="button"
                      class="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-muted hover:bg-subtle"
                      :disabled="disabled"
                      :aria-label="`Edit panel ${product.name}`"
                      @click.stop="editProduct(product)"
                    >
                      <AppIcon name="edit" /><span class="sr-only">Edit</span>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </section>
      <ProductDetails
        v-if="!compactDetails"
        :product="selectedProduct"
        :materials="materials"
        :suppliers="suppliers"
        :stock="selectedProduct ? linkedStock(selectedProduct) : []"
        :stock-available="Boolean(stockRepository)"
        :stock-error="stockError"
        :disabled="disabled"
        @edit="editProduct"
        @delete="removeProduct"
      />
    </div>
    <CatalogFormDialog
      v-if="compactDetails && detailsOpen && selectedProduct"
      title="Product details"
      close-label="Close details"
      :busy="busy"
      @close="detailsOpen = false"
    >
      <ProductDetails
        :product="selectedProduct"
        :materials="materials"
        :suppliers="suppliers"
        :stock="selectedProduct ? linkedStock(selectedProduct) : []"
        :stock-available="Boolean(stockRepository)"
        :stock-error="stockError"
        :disabled="disabled"
        @edit="editProduct"
        @delete="removeProduct"
      />
    </CatalogFormDialog>
    <CatalogFormDialog
      v-if="formMode"
      :title="formMode === 'supplier' ? 'Supplier information' : (editingProduct ? 'Edit product' : 'New product')"
      :busy="busy"
      @close="closeForm"
    >
      <p
        v-if="operationError"
        role="alert"
        class="mb-4 text-danger"
      >
        {{ operationError }}
      </p>
      <SupplierForm
        v-if="formMode === 'supplier'"
        :key="supplierVersion"
        ref="supplierForm"
        :supplier="editingSupplier"
        :disabled="disabled"
        @save="saveSupplier"
        @cancel="closeForm"
      />
      <ProductForm
        v-else
        :key="productVersion"
        ref="productForm"
        :product="editingProduct"
        :initial-supplier-id="initialSupplierId"
        fixed-supplier
        :suppliers="suppliers"
        :materials="materials"
        :disabled="disabled"
        @save="saveProduct"
        @material-created="materials = [...materials, $event]"
        @material-busy="busy = $event"
        @cancel="closeForm"
      />
    </CatalogFormDialog>
  </section>
</template>
