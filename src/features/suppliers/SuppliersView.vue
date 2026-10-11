<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, shallowRef } from 'vue'
import type { StockItem } from '../../domain/model/stock-item'
import type { Material } from '../../domain/model/material'
import type { Supplier } from '../../domain/model/supplier'
import type { SupplierProduct } from '../../domain/model/supplier-product'
import { persistenceErrorMessage } from '../../shared/ui/persistence-error-message'
import { useMaterialRepository } from '../materials/material-repository'
import { useCatalogRepositories, useCatalogStockRepository } from './catalog-repositories'
import SupplierForm from './SupplierForm.vue'
import ProductForm from './ProductForm.vue'
import CatalogTransfer from './CatalogTransfer.vue'
import ProductDetails from './ProductDetails.vue'
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
const transferBusy = ref(false)
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
const disabled = computed(() => loading.value || busy.value || transferBusy.value || Boolean(loadError.value))
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
function selectSupplier(id: string): void { selectedSupplierId.value = id; selectedProductId.value = ''; detailsOpen.value = false; materialFilter.value = ''; categoryFilter.value = '' }
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
async function saveProduct(product: SupplierProduct): Promise<void> {
  if (disabled.value) return
  busy.value = true
  notice.value = ''
  operationError.value = ''
  const result = editingProduct.value ? await repositories.supplierProducts.update(product.id, product) : await repositories.supplierProducts.create(product)
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
  <section class="min-w-0 space-y-5">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div class="space-y-3">
        <h1 class="text-2xl font-semibold tracking-tight">
          Catalog
        </h1>
        <p class="text-sm text-muted">
          Your global library of suppliers, materials and purchasable panels.
        </p>
      </div>
      <CatalogTransfer
        :disabled="loading || busy || Boolean(loadError) || formMode !== null"
        @busy="transferBusy = $event"
        @imported="load"
      />
    </div>
    <dl
      aria-label="Catalog summary"
      class="grid grid-cols-2 gap-3 xl:grid-cols-4"
    >
      <div class="panel px-4 py-3">
        <dt class="text-xs text-muted">
          Suppliers
        </dt><dd class="mt-1 text-xl font-semibold tabular-nums">
          {{ loading || loadError ? '—' : suppliers.length }}
        </dd>
      </div>
      <div class="panel px-4 py-3">
        <dt class="text-xs text-muted">
          Materials
        </dt><dd class="mt-1 text-xl font-semibold tabular-nums">
          {{ loading || loadError ? '—' : materials.length }}
        </dd>
      </div>
      <div class="panel px-4 py-3">
        <dt class="text-xs text-muted">
          Product references
        </dt><dd class="mt-1 text-xl font-semibold tabular-nums">
          {{ loading || loadError ? '—' : products.length }}
        </dd>
      </div>
      <div class="panel px-4 py-3">
        <dt class="text-xs text-muted">
          Owned stock items
        </dt><dd class="mt-1 text-xl font-semibold tabular-nums">
          {{ loading || !stockRepository || stockError ? '—' : stock.length }}
        </dd><p
          v-if="stockError || !stockRepository"
          class="text-xs text-muted"
        >
          Inventory unavailable
        </p>
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
        class="button button-compact"
        :disabled="busy"
        @click="load"
      >
        Try again
      </button>
    </div>
    <div
      v-else
      class="catalog-workspace grid min-w-0 items-start gap-4 md:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_300px]"
    >
      <aside
        class="panel space-y-4 p-4 md:sticky md:top-5"
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
          class="button button-compact button-primary w-full"
          :disabled="disabled"
          @click="editSupplier(null)"
        >
          + Add Supplier
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
          class="flex gap-2 overflow-x-auto p-1 md:max-h-[60dvh] md:flex-col md:overflow-y-auto"
        >
          <button
            v-for="supplier in supplierNavigation.filter(item => item.name.toLocaleLowerCase().includes(supplierSearch.toLocaleLowerCase().trim()))"
            :key="supplier.id"
            type="button"
            class="flex min-w-40 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm md:min-w-0"
            :class="selectedSupplierId === supplier.id ? 'border-accent bg-subtle text-accent' : 'border-transparent hover:bg-subtle'"
            :aria-pressed="selectedSupplierId === supplier.id"
            :aria-label="`Select supplier ${supplier.name}`"
            @click="selectSupplier(supplier.id)"
          >
            <span class="font-medium [overflow-wrap:anywhere]">{{ supplier.name }}</span>
            <span class="shrink-0 text-xs tabular-nums">{{ supplier.count }}<span class="sr-only"> product references</span></span>
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
        class="min-w-0 space-y-5"
        aria-labelledby="supplier-content-title"
      >
        <div class="panel space-y-3 p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="eyebrow">
                Panel references
              </p>
              <h2
                id="supplier-content-title"
                class="mt-1 text-lg font-semibold"
              >
                {{ selectedSupplier?.name ?? (selectedSupplierId ? 'Missing supplier' : 'Select a supplier') }}
              </h2>
              <a
                v-if="selectedSupplier?.websiteUrl"
                :href="selectedSupplier.websiteUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="text-sm text-accent underline [overflow-wrap:anywhere]"
              >Supplier website<span class="sr-only"> (opens in new tab)</span></a>
            </div>
            <div
              v-if="selectedSupplier"
              class="flex flex-wrap gap-2"
            >
              <button
                type="button"
                class="button button-compact"
                :disabled="disabled"
                :aria-label="`Edit supplier ${selectedSupplier.name}`"
                @click="editSupplier(selectedSupplier)"
              >
                Edit supplier
              </button>
              <button
                type="button"
                class="button button-compact button-danger"
                :disabled="disabled"
                :aria-label="`Delete supplier ${selectedSupplier.name}`"
                @click="removeSupplier(selectedSupplier)"
              >
                Delete supplier
              </button>
            </div>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <p class="text-sm text-muted">
              Catalog availability is separate from owned inventory.
            </p>
            <button
              type="button"
              class="button button-compact button-primary"
              :disabled="disabled || !selectedSupplier"
              :aria-label="`Add product for ${selectedSupplier?.name ?? 'supplier'}`"
              @click="editProduct(null, selectedSupplierId)"
            >
              + Add Product
            </button>
          </div>
          <div class="grid gap-2 sm:grid-cols-2 2xl:grid-cols-4">
            <div>
              <label
                for="catalog-search"
                class="mb-1 block text-xs font-medium text-muted"
              >Search products</label><input
                id="catalog-search"
                v-model="search"
                type="search"
                class="field"
                placeholder="Name or material…"
              >
            </div>
            <div>
              <label
                for="catalog-category"
                class="mb-1 block text-xs font-medium text-muted"
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
                class="mb-1 block text-xs font-medium text-muted"
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
                class="mb-1 block text-xs font-medium text-muted"
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
          <div class="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-subtle/50 px-4 py-3">
            <div>
              <p class="eyebrow">
                {{ section.material?.category ?? 'Missing material' }}
              </p><h3 class="mt-1 font-semibold">
                {{ section.material?.name ?? 'Missing material' }}
              </h3>
            </div>
            <div class="text-right text-xs text-muted">
              <p>{{ section.items.length }} references</p><p v-if="stockRepository && !stockError">
                {{ stock.filter(item => item.materialId === section.id).reduce((quantity, item) => quantity + item.quantity, 0) }} owned units for this material
              </p>
            </div>
          </div>
          <div
            class="overflow-x-auto"
            tabindex="0"
            role="region"
            :aria-label="`${section.material?.name ?? 'Missing material'} products; scroll horizontally for all columns`"
          >
            <table class="w-full text-left text-sm">
              <caption class="sr-only">
                {{ section.material?.name ?? 'Missing material' }} panel products in millimeters
              </caption>
              <thead class="bg-subtle text-xs text-muted">
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
                    Length × width (mm)
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
                    Owned quantity
                  </th><th
                    scope="col"
                    class="px-3 py-2"
                  >
                    Supplier availability
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
                    class="min-w-40 px-3 py-2.5 font-medium"
                  >
                    <button
                      type="button"
                      class="rounded text-left text-accent underline-offset-4 hover:underline"
                      :aria-label="`View product ${product.name}`"
                      :aria-pressed="selectedProductId === product.id"
                      aria-controls="product-details"
                      @click.stop="inspectProduct(product.id)"
                    >
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
                  <td class="whitespace-nowrap px-3 py-2.5 text-xs text-muted">
                    {{ stockLabel(product) }}
                  </td>
                  <td class="px-3 py-2.5">
                    <span
                      class="inline-flex rounded-md px-2 py-1 text-xs font-medium"
                      :class="product.availability === 'available' ? 'bg-success-surface text-success' : 'bg-subtle text-muted'"
                    >{{ availability(product) }}</span>
                  </td>
                  <td class="px-3 py-2.5">
                    <button
                      type="button"
                      class="rounded-md p-2 text-xs font-medium text-accent hover:bg-subtle"
                      :disabled="disabled"
                      :aria-label="`Edit panel ${product.name}`"
                      @click.stop="editProduct(product)"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <button
          type="button"
          class="button button-compact"
          :disabled="disabled"
          @click="load"
        >
          Refresh
        </button>
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
        @clear="selectedProductId = ''"
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
        @clear="detailsOpen = false"
      />
    </CatalogFormDialog>
    <CatalogFormDialog
      v-if="formMode"
      :title="formMode === 'supplier' ? 'Supplier information' : 'Panel product information'"
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
