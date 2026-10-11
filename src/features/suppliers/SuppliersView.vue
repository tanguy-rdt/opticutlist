<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef } from 'vue'
import { RouterLink } from 'vue-router'
import type { Material } from '../../domain/model/material'
import type { Supplier } from '../../domain/model/supplier'
import type { SupplierProduct } from '../../domain/model/supplier-product'
import { persistenceErrorMessage } from '../../shared/ui/persistence-error-message'
import { useMaterialRepository } from '../materials/material-repository'
import { useCatalogRepositories } from './catalog-repositories'
import SupplierForm from './SupplierForm.vue'
import ProductForm from './ProductForm.vue'
import CatalogTransfer from './CatalogTransfer.vue'

const repositories = useCatalogRepositories()
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
const catalog = computed(() => {
  const supplierIds = [...new Set([...suppliers.value.map((supplier) => supplier.id), ...products.value.map((product) => product.supplierId)])]
  return supplierIds.map((id) => {
    const supplier = suppliers.value.find((candidate) => candidate.id === id)
    const categories = new Map<string, SupplierProduct[]>()
    for (const product of products.value.filter((candidate) => candidate.supplierId === id)) {
      const category = materials.value.find((material) => material.id === product.materialId)?.category ?? 'Missing material'
      const group = categories.get(category) ?? []
      group.push(product)
      categories.set(category, group)
    }
    return { id, name: supplier?.name ?? 'Missing supplier', categories: [...categories].map(([name, items]) => ({ name, items })) }
  })
})

async function load(): Promise<void> {
  loading.value = true
  const [supplierResult, productResult, materialResult] = await Promise.all([repositories.suppliers.list(), repositories.supplierProducts.list(), materialRepository.list()])
  const errors: string[] = []
  if (supplierResult.ok) suppliers.value = supplierResult.value
  else errors.push(persistenceErrorMessage(supplierResult.error, 'Supplier'))
  if (productResult.ok) products.value = productResult.value
  else errors.push(persistenceErrorMessage(productResult.error, 'Product'))
  if (materialResult.ok) materials.value = materialResult.value
  else errors.push(persistenceErrorMessage(materialResult.error, 'Material'))
  loadError.value = errors.join(' ')
  loading.value = false
}
async function editSupplier(supplier: Supplier | null): Promise<void> {
  editingSupplier.value = supplier
  supplierVersion.value++
  operationError.value = ''
  notice.value = ''
  await nextTick()
  supplierForm.value?.focusName()
}
async function editProduct(product: SupplierProduct | null, supplierId = ''): Promise<void> {
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
    editingSupplier.value = null
    supplierVersion.value++
    await load()
  } else operationError.value = persistenceErrorMessage(result.error, 'Supplier')
  busy.value = false
  await nextTick()
  supplierForm.value?.focusName()
}
async function saveProduct(product: SupplierProduct): Promise<void> {
  if (disabled.value) return
  busy.value = true
  notice.value = ''
  operationError.value = ''
  const result = editingProduct.value ? await repositories.supplierProducts.update(product.id, product) : await repositories.supplierProducts.create(product)
  if (result.ok) {
    notice.value = editingProduct.value ? 'Product updated.' : 'Product created.'
    editingProduct.value = null
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
    if (editingSupplier.value?.id === supplier.id) { editingSupplier.value = null; supplierVersion.value++ }
    notice.value = 'Supplier deleted.'
    await load()
  } else operationError.value = persistenceErrorMessage(result.error, 'Supplier')
  busy.value = false
  await nextTick()
  supplierForm.value?.focusName()
}
async function removeProduct(product: SupplierProduct): Promise<void> {
  if (disabled.value || !window.confirm(`Delete catalog product “${product.name}”? This cannot be undone.`)) return
  busy.value = true
  notice.value = ''
  operationError.value = ''
  const result = await repositories.supplierProducts.delete(product.id)
  if (result.ok) {
    if (editingProduct.value?.id === product.id) { editingProduct.value = null; productVersion.value++ }
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
  <section class="min-w-0 space-y-6">
    <RouterLink
      to="/"
      class="button"
    >
      <span aria-hidden="true">←</span> Back to Home
    </RouterLink>
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div class="space-y-2">
        <p class="eyebrow">
          Purchasable panels
        </p><h1 class="text-3xl font-semibold tracking-tight">
          Catalogue
        </h1><p class="max-w-2xl text-muted">
          Manage suppliers and their panel catalogs. Catalog products describe what you can buy; adding them does not create owned stock.
        </p>
      </div>
      <button
        type="button"
        class="button button-primary"
        :disabled="disabled"
        @click="editSupplier(null)"
      >
        + New supplier
      </button>
    </div>
    <CatalogTransfer
      :disabled="loading || busy || Boolean(loadError)"
      @busy="transferBusy = $event"
      @imported="load"
    />
    <p
      v-if="notice"
      role="status"
      class="rounded-lg border border-success bg-success-surface px-4 py-3 text-sm text-success"
    >
      {{ notice }}
    </p>
    <p
      v-if="operationError"
      role="alert"
      class="rounded-lg border border-danger bg-danger-surface px-4 py-3 text-sm text-danger"
    >
      {{ operationError }}
    </p>
    <div
      class="panel min-w-0 overflow-hidden"
      :aria-busy="loading"
    >
      <div class="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
        <h2 class="font-semibold">
          Supplier library
        </h2><button
          type="button"
          class="button"
          :disabled="loading || busy"
          @click="load"
        >
          Refresh
        </button>
      </div>
      <p
        v-if="loading"
        role="status"
        class="px-6 py-14 text-center text-muted"
      >
        Loading supplier catalog…
      </p>
      <div
        v-else-if="loadError"
        class="space-y-4 p-6"
      >
        <p
          role="alert"
          class="text-danger"
        >
          {{ loadError }}
        </p><button
          type="button"
          class="button"
          :disabled="busy"
          @click="load"
        >
          Try again
        </button>
      </div>
      <div
        v-else-if="suppliers.length === 0"
        class="space-y-3 px-6 py-14 text-center"
      >
        <h3 class="text-lg font-semibold">
          No suppliers yet
        </h3><p class="text-sm text-muted">
          Add your first supplier using the form below.
        </p>
      </div>
      <div
        v-else
        class="overflow-x-auto"
        tabindex="0"
        role="region"
        aria-label="Supplier table"
      >
        <table class="w-full text-left text-sm">
          <caption class="sr-only">
            Saved suppliers and their websites
          </caption><thead class="bg-subtle text-xs text-muted">
            <tr>
              <th
                scope="col"
                class="px-5 py-3"
              >
                Supplier
              </th><th
                scope="col"
                class="px-5 py-3"
              >
                Website
              </th><th
                scope="col"
                class="px-5 py-3 text-right"
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="supplier in suppliers"
              :key="supplier.id"
              class="border-t border-line"
            >
              <th
                scope="row"
                class="px-5 py-4 font-medium [overflow-wrap:anywhere]"
              >
                {{ supplier.name }}
              </th><td class="px-5 py-4 [overflow-wrap:anywhere]">
                <a
                  v-if="supplier.websiteUrl"
                  :href="supplier.websiteUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-accent underline underline-offset-4"
                >{{ supplier.websiteUrl }}<span class="sr-only"> (opens in new tab)</span></a><span
                  v-else
                  class="text-muted"
                >—</span>
              </td><td class="px-5 py-4">
                <div class="flex justify-end gap-2">
                  <button
                    type="button"
                    class="button"
                    :disabled="disabled"
                    :aria-label="`Edit supplier ${supplier.name}`"
                    @click="editSupplier(supplier)"
                  >
                    Edit
                  </button><button
                    type="button"
                    class="button button-danger"
                    :disabled="disabled"
                    :aria-label="`Delete supplier ${supplier.name}`"
                    @click="removeSupplier(supplier)"
                  >
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <section
      v-if="!loading && !loadError"
      class="space-y-4"
      aria-labelledby="catalog-title"
    >
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="catalog-title"
          class="text-xl font-semibold"
        >
          Panel catalogs
        </h2><button
          type="button"
          class="button"
          :disabled="disabled || suppliers.length === 0"
          @click="editProduct(null)"
        >
          + New product
        </button>
      </div>
      <p
        v-if="materials.length === 0"
        class="text-sm text-muted"
      >
        Create a material directly in the product form below to start your catalog.
      </p>
      <p
        v-if="products.length === 0"
        class="text-sm text-muted"
      >
        No catalog products yet.
      </p>
      <section
        v-for="group in catalog"
        :key="group.id"
        class="panel min-w-0 overflow-hidden"
      >
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h3 class="font-semibold">
            {{ group.name }}
          </h3><button
            v-if="suppliers.some((supplier) => supplier.id === group.id)"
            type="button"
            class="button"
            :disabled="disabled"
            :aria-label="`Add product for ${group.name}`"
            @click="editProduct(null, group.id)"
          >
            Add product
          </button>
        </div>
        <p
          v-if="group.categories.length === 0"
          class="p-5 text-sm text-muted"
        >
          This supplier has no products yet.
        </p>
        <section
          v-for="category in group.categories"
          :key="category.name"
        >
          <h4 class="bg-subtle px-5 py-3 text-sm font-semibold">
            {{ category.name }}
          </h4>
          <div
            class="overflow-x-auto"
            tabindex="0"
            role="region"
            :aria-label="`${group.name}, ${category.name} products; scroll horizontally for all columns`"
          >
            <table class="w-full text-left text-sm">
              <caption class="sr-only">
                {{ group.name }} — {{ category.name }}. Dimensions are length × width × thickness in millimeters.
              </caption><thead class="text-xs text-muted">
                <tr>
                  <th
                    scope="col"
                    class="px-4 py-3"
                  >
                    Product / material
                  </th><th
                    scope="col"
                    class="px-4 py-3"
                  >
                    Dimensions (mm)<span class="block font-normal">Length × width × thickness</span>
                  </th><th
                    scope="col"
                    class="px-4 py-3"
                  >
                    Price / panel
                  </th><th
                    scope="col"
                    class="px-4 py-3"
                  >
                    Grain
                  </th><th
                    scope="col"
                    class="px-4 py-3"
                  >
                    Availability
                  </th><th
                    scope="col"
                    class="px-4 py-3 text-right"
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="product in category.items"
                  :key="product.id"
                  class="border-t border-line"
                >
                  <th
                    scope="row"
                    class="min-w-40 px-4 py-4 font-medium [overflow-wrap:anywhere]"
                  >
                    {{ product.name }}<span class="block text-xs font-normal text-muted">{{ materials.find((material) => material.id === product.materialId)?.name ?? 'Missing material' }}</span><a
                      v-if="product.productUrl"
                      :href="product.productUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="block text-xs text-accent underline underline-offset-4"
                    >Product page<span class="sr-only"> for {{ product.name }} (opens in new tab)</span></a>
                  </th><td class="whitespace-nowrap px-4 py-4 tabular-nums">
                    {{ product.lengthMm }} × {{ product.widthMm }} × {{ product.thicknessMm }}
                  </td><td class="whitespace-nowrap px-4 py-4 tabular-nums">
                    {{ product.price }} {{ product.currency }}
                  </td><td class="whitespace-nowrap px-4 py-4">
                    {{ product.grainDirection === 'none' ? 'None' : (product.grainDirection === 'length' ? 'Along length' : 'Along width') }}
                  </td><td class="px-4 py-4">
                    {{ product.availability === 'available' ? 'Available' : (product.availability === 'unavailable' ? 'Unavailable' : 'Unknown') }}
                  </td><td class="px-4 py-4">
                    <div class="flex justify-end gap-2">
                      <button
                        type="button"
                        class="button"
                        :disabled="disabled"
                        :aria-label="`Edit product ${product.name}`"
                        @click="editProduct(product)"
                      >
                        Edit
                      </button><button
                        type="button"
                        class="button button-danger"
                        :disabled="disabled"
                        :aria-label="`Delete product ${product.name}`"
                        @click="removeProduct(product)"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </section>
    <SupplierForm
      :key="supplierVersion"
      ref="supplierForm"
      :supplier="editingSupplier"
      :disabled="disabled"
      @save="saveSupplier"
      @cancel="editSupplier(null)"
    />
    <ProductForm
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
      @cancel="editProduct(null)"
    />
  </section>
</template>
