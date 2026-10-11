<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { RouterLink } from 'vue-router'
import type { Material } from '../../domain/model/material'
import type { Supplier } from '../../domain/model/supplier'
import type { SupplierProduct } from '../../domain/model/supplier-product'
import { persistenceErrorMessage } from '../../shared/ui/persistence-error-message'
import { useProjectId, useProjectService } from '../projects/project-service'
import { useCatalogRepositories } from '../suppliers/catalog-repositories'
import { useMaterialRepository } from './material-repository'

const repository = useMaterialRepository()
const catalog = useCatalogRepositories()
const service = useProjectService()
const projectId = useProjectId()
const materials = shallowRef<readonly Material[]>([])
const products = shallowRef<readonly SupplierProduct[]>([])
const suppliers = shallowRef<readonly Supplier[]>([])
const selectedIds = ref<readonly Material['id'][]>([])
const selectedProductIds = ref<readonly SupplierProduct['id'][]>([])
const selectedMaterials = computed(() => materials.value.filter(material => selectedIds.value.includes(material.id)))
const missingSelections = computed(() => [
  ...selectedIds.value.filter(id => !materials.value.some(material => material.id === id)),
  ...selectedProductIds.value.filter(id => !products.value.some(product => product.id === id)),
])
const groups = computed(() => {
  const groups: { supplierId: string; supplierName: string; categories: { name: string; products: SupplierProduct[] }[] }[] = []
  for (const product of products.value) {
    let supplier = groups.find(group => group.supplierId === product.supplierId)
    if (!supplier) {
      supplier = { supplierId: product.supplierId, supplierName: suppliers.value.find(record => record.id === product.supplierId)?.name ?? 'Missing supplier', categories: [] }
      groups.push(supplier)
    }
    const name = materials.value.find(material => material.id === product.materialId)?.category ?? 'Missing material'
    let category = supplier.categories.find(group => group.name === name)
    if (!category) { category = { name, products: [] }; supplier.categories.push(category) }
    category.products.push(product)
  }
  return groups
})
const loading = ref(true)
const busy = ref(false)
const loadError = ref('')
const saveError = ref('')
const notice = ref('')
async function load(): Promise<void> {
  loading.value = true
  loadError.value = ''
  const [result, project, productResult, supplierResult] = await Promise.all([
    repository.list(), service.projects.get(projectId), catalog.supplierProducts.list(), catalog.suppliers.list(),
  ])
  if (result.ok && project.ok && productResult.ok && supplierResult.ok) {
    materials.value = result.value
    selectedIds.value = project.value.materialIds
    selectedProductIds.value = project.value.supplierProductIds
    products.value = productResult.value
    suppliers.value = supplierResult.value
  } else {
    const failure = [result, project, productResult, supplierResult].find(record => !record.ok)
    if (failure) loadError.value = persistenceErrorMessage(failure.error, failure === result ? 'Material' : 'Project')
    materials.value = []; products.value = []; suppliers.value = []
  }
  loading.value = false
}
function toggle(material: Material): void {
  selectedIds.value = selectedIds.value.includes(material.id)
    ? selectedIds.value.filter(id => id !== material.id)
    : [...selectedIds.value, material.id]
  notice.value = ''
}
function selectable(product: SupplierProduct): boolean {
  return product.availability !== 'unavailable' && materials.value.some(material => material.id === product.materialId)
    && suppliers.value.some(supplier => supplier.id === product.supplierId)
}
function groupProducts(records: readonly SupplierProduct[]): readonly SupplierProduct[] {
  return records.filter(product => selectable(product) || selectedProductIds.value.includes(product.id))
}
function checked(records: readonly SupplierProduct[]): boolean {
  const eligible = groupProducts(records)
  return eligible.length > 0 && eligible.every(product => selectedProductIds.value.includes(product.id))
}
function mixed(records: readonly SupplierProduct[]): boolean {
  return groupProducts(records).some(product => selectedProductIds.value.includes(product.id)) && !checked(records)
}
function toggleProducts(records: readonly SupplierProduct[]): void {
  const remove = checked(records)
  const eligible = groupProducts(records)
  const ids = new Set(selectedProductIds.value)
  for (const product of eligible) {
    if (remove) ids.delete(product.id)
    else if (selectable(product)) ids.add(product.id)
  }
  selectedProductIds.value = [...ids]
  notice.value = ''
}
async function save(): Promise<void> {
  if (busy.value || loading.value || loadError.value) return
  busy.value = true
  saveError.value = ''; notice.value = ''
  // Reread ownership so a concurrent Part write cannot be overwritten by this draft.
  const project = await service.projects.get(projectId)
  const result = project.ok ? await service.projects.update(projectId, {
    ...project.value, materialIds: selectedIds.value, supplierProductIds: selectedProductIds.value,
    ...(project.value.panelQuantities === undefined ? {} : { panelQuantities: project.value.panelQuantities.filter(item => selectedProductIds.value.includes(item.supplierProductId)) }),
  }) : project
  if (result.ok) { await load(); notice.value = 'Project selections saved.' }
  else saveError.value = persistenceErrorMessage(result.error, 'Project')
  busy.value = false
}
onMounted(load)
</script>

<template>
  <section class="space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div class="space-y-2">
        <p class="eyebrow">
          Workshop library
        </p>
        <h1 class="text-3xl font-semibold tracking-tight">
          Materials
        </h1>
        <p class="max-w-2xl text-muted">
          Select existing catalog materials and purchasable panels for this project. Save your choices below; the global catalog is not changed.
        </p>
      </div>
    </div>

    <p
      v-if="notice"
      role="status"
      class="text-success"
    >
      {{ notice }}
    </p>
    <p
      v-if="saveError"
      role="alert"
      class="text-danger"
    >
      {{ saveError }}
    </p>
    <div
      v-if="!loading && !loadError && missingSelections.length"
      class="panel space-y-3 p-5"
    >
      <p class="text-danger">
        Some selected catalog references are missing. They have been retained; remove them explicitly to save valid choices.
      </p>
      <ul class="text-sm text-muted">
        <li
          v-for="id in missingSelections"
          :key="id"
        >
          Missing reference: {{ id }}
        </li>
      </ul>
      <button
        type="button"
        class="button"
        :disabled="busy || loading"
        @click="selectedIds = selectedIds.filter(id => materials.some(material => material.id === id)); selectedProductIds = selectedProductIds.filter(id => products.some(product => product.id === id))"
      >
        Remove missing selections
      </button>
    </div>
    <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div
        class="panel min-w-0 overflow-hidden"
        :aria-busy="loading"
      >
        <div class="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
          <h2 class="font-semibold">
            Material library <span
              v-if="!loading && !loadError"
              class="ml-2 rounded-full bg-subtle px-2 py-0.5 text-xs text-muted"
            >{{ materials.length }}</span>
          </h2>
          <button
            type="button"
            class="button"
            :disabled="loading || busy"
            @click="load"
          >
            Refresh
          </button>
        </div>
        <div
          v-if="loading"
          role="status"
          class="px-6 py-14 text-center text-muted"
        >
          Loading materials…
        </div>
        <div
          v-else-if="loadError"
          class="space-y-4 px-6 py-10"
        >
          <p
            role="alert"
            class="text-danger"
          >
            {{ loadError }}
          </p>
          <button
            type="button"
            class="button"
            :disabled="loading || busy"
            @click="load"
          >
            Try again
          </button>
        </div>
        <div
          v-else-if="materials.length === 0"
          class="space-y-3 px-6 py-14 text-center"
        >
          <h3 class="text-lg font-semibold">
            No catalog materials yet
          </h3>
          <p class="mx-auto max-w-sm text-sm leading-relaxed text-muted">
            Create materials in a supplier product's Material field. This page selects existing catalog materials.
          </p>
          <RouterLink
            to="/suppliers"
            class="button"
          >
            Open supplier catalog
          </RouterLink>
        </div>
        <div
          v-else
          class="overflow-x-auto"
        >
          <table class="w-full text-left text-sm">
            <caption class="sr-only">
              Saved materials and their categories
            </caption>
            <thead class="bg-subtle text-xs text-muted">
              <tr>
                <th
                  scope="col"
                  class="px-5 py-3 font-semibold"
                >
                  Material
                </th>
                <th
                  scope="col"
                  class="px-5 py-3 font-semibold"
                >
                  Category
                </th>
                <th
                  scope="col"
                  class="px-5 py-3 text-right font-semibold"
                >
                  Use
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="material in materials"
                :key="material.id"
                class="border-t border-line"
              >
                <th
                  scope="row"
                  class="min-w-44 px-5 py-4 font-medium [overflow-wrap:anywhere]"
                >
                  {{ material.name }}
                </th>
                <td class="px-5 py-4 [overflow-wrap:anywhere]">
                  {{ material.category }}
                </td>
                <td class="px-5 py-4">
                  <input
                    type="checkbox"
                    class="h-5 w-5 accent-accent"
                    :checked="selectedIds.includes(material.id)"
                    :disabled="loading || busy"
                    :aria-label="`Use ${material.name}`"
                    @change="toggle(material)"
                  >
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <aside
        class="panel space-y-4 p-6"
        aria-labelledby="material-selection-title"
      >
        <h2
          id="material-selection-title"
          class="text-xl font-semibold"
        >
          Selected materials
        </h2>
        <p
          v-if="selectedMaterials.length === 0"
          class="text-sm text-muted"
        >
          Choose materials from the catalog table.
        </p>
        <ul
          v-else
          class="space-y-2"
        >
          <li
            v-for="material in selectedMaterials"
            :key="material.id"
            class="text-sm [overflow-wrap:anywhere]"
          >
            {{ material.name }} · {{ material.category }}
          </li>
        </ul>
        <p class="text-sm text-muted">
          Selections are stored independently for this project. Catalog records are not changed.
        </p>
      </aside>
    </div>
    <section
      v-if="!loading && !loadError"
      class="panel space-y-5 p-6"
      aria-labelledby="project-products-title"
    >
      <h2
        id="project-products-title"
        class="text-xl font-semibold"
      >
        Catalog panel products
      </h2>
      <p
        v-if="products.length === 0"
        class="text-muted"
      >
        No catalog products yet. Add purchasable panels in the Catalogue.
      </p>
      <div
        v-for="group in groups"
        :key="group.supplierId"
        class="space-y-4 border-t border-line pt-4"
      >
        <label class="flex items-center gap-3 font-semibold">
          <input
            type="checkbox"
            class="h-5 w-5 accent-accent"
            :checked="checked(group.categories.flatMap(category => category.products))"
            :indeterminate="mixed(group.categories.flatMap(category => category.products))"
            :aria-checked="mixed(group.categories.flatMap(category => category.products)) ? 'mixed' : checked(group.categories.flatMap(category => category.products))"
            :disabled="busy || groupProducts(group.categories.flatMap(category => category.products)).length === 0"
            @change="toggleProducts(group.categories.flatMap(category => category.products))"
          >
          {{ group.supplierName }}
        </label>
        <div
          v-for="category in group.categories"
          :key="category.name"
          class="ml-6 space-y-3"
        >
          <label class="flex items-center gap-3 font-medium">
            <input
              type="checkbox"
              class="h-5 w-5 accent-accent"
              :checked="checked(category.products)"
              :indeterminate="mixed(category.products)"
              :aria-checked="mixed(category.products) ? 'mixed' : checked(category.products)"
              :disabled="busy || groupProducts(category.products).length === 0"
              @change="toggleProducts(category.products)"
            >
            {{ category.name }}
          </label>
          <ul class="ml-6 space-y-3">
            <li
              v-for="product in category.products"
              :key="product.id"
            >
              <label class="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  class="mt-1 h-5 w-5 accent-accent"
                  :checked="selectedProductIds.includes(product.id)"
                  :disabled="busy || (!selectable(product) && !selectedProductIds.includes(product.id))"
                  @change="toggleProducts([product])"
                >
                <span>{{ product.name }} · {{ product.lengthMm }} × {{ product.widthMm }} × {{ product.thicknessMm }} mm · {{ product.price }} {{ product.currency }} · {{ product.grainDirection }} grain · {{ product.availability }}</span>
              </label>
            </li>
          </ul>
        </div>
      </div>
    </section>
    <button
      type="button"
      class="button button-primary"
      :disabled="loading || busy || Boolean(loadError)"
      @click="save"
    >
      {{ busy ? 'Saving…' : 'Save project selections' }}
    </button>
  </section>
</template>
