<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { RouterLink, matchedRouteKey, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import type { Material } from '../../domain/model/material'
import type { Supplier } from '../../domain/model/supplier'
import type { SupplierProduct } from '../../domain/model/supplier-product'
import { persistenceErrorMessage } from '../../shared/ui/persistence-error-message'
import { useProjectId, useProjectService } from '../projects/project-service'
import { useCatalogRepositories } from '../suppliers/catalog-repositories'
import { useMaterialRepository } from './material-repository'

import MaterialThumbnail from './MaterialThumbnail.vue'
import AppIcon from '../../shared/ui/AppIcon.vue'
import SupplierLogo from '../suppliers/SupplierLogo.vue'

const repository = useMaterialRepository()
const catalog = useCatalogRepositories()
const service = useProjectService()
const projectId = useProjectId()
const materials = shallowRef<readonly Material[]>([])
const products = shallowRef<readonly SupplierProduct[]>([])
const suppliers = shallowRef<readonly Supplier[]>([])
const selectedIds = ref<readonly Material['id'][]>([])
const selectedProductIds = ref<readonly SupplierProduct['id'][]>([])
const search = ref('')
const categoryFilter = ref('')
const activeMaterialId = ref<Material['id']>()
const savedMaterialIds = shallowRef<readonly Material['id'][]>([])
const savedProductIds = shallowRef<readonly SupplierProduct['id'][]>([])
const dirty = computed(() => selectedIds.value.length !== savedMaterialIds.value.length
  || selectedIds.value.some(id => !savedMaterialIds.value.includes(id))
  || selectedProductIds.value.length !== savedProductIds.value.length
  || selectedProductIds.value.some(id => !savedProductIds.value.includes(id)))
const categories = computed(() => [...new Set(materials.value.map(material => material.category))])
const visibleMaterials = computed(() => materials.value.filter(material =>
  material.name.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())
  && (!categoryFilter.value || material.category === categoryFilter.value)))
const materialGroups = computed(() => categories.value.map(name => ({ name, materials: visibleMaterials.value.filter(material => material.category === name) })).filter(group => group.materials.length))
const activeMaterial = computed(() => visibleMaterials.value.find(material => material.id === activeMaterialId.value) ?? visibleMaterials.value[0])
const activeProducts = computed(() => products.value.filter(product => product.materialId === activeMaterial.value?.id))
const orphanProducts = computed(() => products.value.filter(product => selectedProductIds.value.includes(product.id) && !materials.value.some(material => material.id === product.materialId)))
const summaryMaterials = computed(() => materials.value.filter(material => selectedIds.value.includes(material.id)
  || products.value.some(product => product.materialId === material.id && selectedProductIds.value.includes(product.id))))
function materialProducts(material: Material): readonly SupplierProduct[] { return products.value.filter(product => product.materialId === material.id) }
function summaryProducts(material: Material): readonly SupplierProduct[] { return materialProducts(material).filter(product => selectedProductIds.value.includes(product.id)) }
function supplierName(product: SupplierProduct): string { return suppliers.value.find(supplier => supplier.id === product.supplierId)?.name ?? 'Missing supplier' }
function removeProduct(product: SupplierProduct): void { selectedProductIds.value = selectedProductIds.value.filter(id => id !== product.id); notice.value = '' }
function removeMissing(): void {
  selectedIds.value = selectedIds.value.filter(id => materials.value.some(material => material.id === id))
  selectedProductIds.value = selectedProductIds.value.filter(id => products.value.some(product => product.id === id))
  notice.value = ''
}
function canDiscard(): boolean { return !busy.value && (!dirty.value || window.confirm('Discard unsaved project material selections?')) }
async function refresh(): Promise<void> { if (canDiscard()) await load() }
function beforeUnload(event: BeforeUnloadEvent): void { if (dirty.value || busy.value) { event.preventDefault() } }
if (inject(matchedRouteKey, undefined)) { onBeforeRouteLeave(canDiscard); onBeforeRouteUpdate(canDiscard) }
onBeforeUnmount(() => { window.removeEventListener('beforeunload', beforeUnload) })
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
    savedMaterialIds.value = project.value.materialIds
    savedProductIds.value = project.value.supplierProductIds
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
onMounted(() => { window.addEventListener('beforeunload', beforeUnload); void load() })
</script>

<template>
  <section class="space-y-5">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="eyebrow mb-1">
          Prepare your project
        </p>
        <h1 class="text-3xl font-semibold tracking-tight">
          Materials
        </h1>
        <p class="mt-2 text-sm text-muted">
          Choose materials and panel references from your catalog.
        </p>
      </div>
    </header>
    <div class="materials-workspace">
      <section
        class="panel material-library min-w-0 overflow-hidden"
        :aria-busy="loading"
        aria-labelledby="library-title"
      >
        <div class="border-b border-line p-4">
          <div class="flex items-center justify-between gap-2">
            <h2
              id="library-title"
              class="font-semibold"
            >
              Material library <span class="ml-2 text-sm font-normal text-muted">{{ materials.length }}</span>
            </h2>
            <button
              type="button"
              class="button button-compact px-2"
              title="Refresh catalog"
              :disabled="loading || busy"
              @click="refresh"
            >
              <span>Refresh</span>
            </button>
          </div>
          <div class="mt-3 grid gap-2">
            <label class="flex items-center gap-2 rounded-lg border border-control-line bg-surface px-3 focus-within:ring-2 focus-within:ring-accent">
              <AppIcon
                name="search"
                class="text-muted"
              />
              <input
                v-model="search"
                type="search"
                aria-label="Search materials"
                placeholder="Search materials…"
                class="min-h-10 min-w-0 w-full bg-transparent text-sm outline-none"
                :disabled="loading || busy"
              >
            </label>
            <select
              v-model="categoryFilter"
              aria-label="Filter material category"
              class="field min-h-10 py-1.5 text-sm"
              :disabled="loading || busy"
            >
              <option value="">
                All categories
              </option>
              <option
                v-for="category in categories"
                :key="category"
                :value="category"
              >
                {{ category }}
              </option>
            </select>
          </div>
        </div>
        <p
          v-if="loading"
          role="status"
          class="p-10 text-center text-muted"
        >
          Loading materials…
        </p>
        <div
          v-else-if="loadError"
          class="space-y-3 p-5"
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
            @click="refresh"
          >
            Try again
          </button>
        </div>
        <div
          v-else-if="!materials.length"
          class="space-y-3 p-8 text-center"
        >
          <h3 class="font-semibold">
            No catalog materials yet
          </h3>
          <p class="text-sm text-muted">
            Create materials in a supplier product's Material field, then choose them here.
          </p>
          <RouterLink
            to="/suppliers"
            class="button"
          >
            Open supplier catalog
          </RouterLink>
        </div>
        <p
          v-else-if="!visibleMaterials.length"
          class="p-8 text-center text-sm text-muted"
        >
          No materials match your search.
        </p>
        <div
          v-else
          class="material-list divide-y divide-line overflow-y-auto"
        >
          <section
            v-for="group in materialGroups"
            :key="group.name"
          >
            <h3 class="bg-quiet-surface px-4 py-2 text-xs font-semibold text-muted">
              {{ group.name }}
            </h3>
            <div
              v-for="material in group.materials"
              :key="material.id"
              class="flex items-center gap-2 border-t border-line border-l-2 px-3 py-2"
              :class="activeMaterial?.id === material.id ? 'border-l-accent bg-subtle' : 'border-l-transparent hover:bg-quiet-surface'"
            >
              <label class="flex min-h-11 items-center px-1">
                <input
                  type="checkbox"
                  class="size-4 accent-accent"
                  :aria-label="`Use ${material.name}`"
                  :checked="selectedIds.includes(material.id)"
                  :disabled="busy"
                  @change="toggle(material)"
                >
              </label>
              <button
                type="button"
                class="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md text-left"
                :aria-pressed="activeMaterial?.id === material.id"
                :aria-label="`Show panels for ${material.name}`"
                @click="activeMaterialId = material.id"
              >
                <MaterialThumbnail :preset-id="material.libraryPresetId" />
                <span class="min-w-0 flex-1">
                  <span class="block text-sm font-semibold [overflow-wrap:anywhere]">{{ material.name }}</span>
                  <span class="block text-xs text-muted">{{ materialProducts(material).filter(selectable).length }} available references</span>
                  <span
                    v-if="selectedIds.includes(material.id)"
                    class="block text-xs font-medium text-success"
                  >Selected for Parts</span>
                </span>
                <AppIcon
                  name="chevron"
                  class="text-muted"
                />
              </button>
            </div>
          </section>
        </div>
      </section>
      <section
        class="panel panel-references min-w-0 overflow-hidden"
        :aria-busy="loading"
        aria-labelledby="project-products-title"
      >
        <header class="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
          <div>
            <h2
              id="project-products-title"
              class="font-semibold"
            >
              Panels for Optimization
            </h2><p class="mt-1 text-xs text-muted">
              {{ activeMaterial?.name ?? 'Choose a material from the library' }}
            </p>
          </div>
          <label
            v-if="!loading && !loadError && activeProducts.length"
            class="flex min-h-11 items-center gap-2 text-sm"
          >
            <input
              type="checkbox"
              class="size-4 accent-accent"
              aria-label="Use all visible material panels"
              :checked="checked(activeProducts)"
              :indeterminate="mixed(activeProducts)"
              :aria-checked="mixed(activeProducts) ? 'mixed' : checked(activeProducts)"
              :disabled="busy || !groupProducts(activeProducts).length"
              @change="toggleProducts(activeProducts)"
            >All material panels
          </label>
        </header>
        <p
          v-if="loading"
          role="status"
          class="p-6 text-sm text-muted"
        >
          Loading panel references…
        </p>
        <p
          v-else-if="loadError"
          class="p-6 text-sm text-muted"
        >
          Panel references could not be loaded. Retry from the material library.
        </p>
        <div
          v-else-if="!activeProducts.length"
          class="space-y-2 p-6"
        >
          <h3 class="text-sm font-semibold">
            {{ activeMaterial ? 'No panel references for this material' : 'No material to view' }}
          </h3>
          <p
            v-if="activeMaterial"
            class="text-sm text-muted"
          >
            You can still select this material for creating Parts. Add panel references in the Catalog when needed for Optimization.
          </p>
          <p
            v-else
            class="text-sm text-muted"
          >
            {{ materials.length ? 'Adjust your search or category filter to view panel references.' : 'No catalog products yet. Add purchasable panels in the Catalogue.' }}
          </p>
        </div>
        <ul
          v-else
          class="divide-y divide-line"
        >
          <li
            v-for="product in activeProducts"
            :key="product.id"
          >
            <label
              class="flex items-start gap-3 px-4 py-3"
              :class="selectedProductIds.includes(product.id) ? 'bg-success-surface' : 'hover:bg-quiet-surface'"
            >
              <input
                type="checkbox"
                class="mt-1 size-4 shrink-0 accent-accent"
                :aria-label="`Use panel ${product.name}`"
                :checked="selectedProductIds.includes(product.id)"
                :disabled="busy || (!selectable(product) && !selectedProductIds.includes(product.id))"
                @change="toggleProducts([product])"
              >
              <span class="grid min-w-0 flex-1 gap-2 text-sm">
                <span class="font-semibold [overflow-wrap:anywhere]">{{ product.name }}</span>
                <span class="flex items-center gap-2 text-xs text-muted"><SupplierLogo :website-url="suppliers.find(supplier => supplier.id === product.supplierId)?.websiteUrl" />{{ supplierName(product) }}</span>
                <span class="flex flex-wrap items-center justify-between gap-2 tabular-nums">{{ product.lengthMm }} × {{ product.widthMm }} × {{ product.thicknessMm }} mm<span class="block text-xs text-muted">{{ product.price }} {{ product.currency }} / panel</span></span>
                <span class="text-xs text-muted">{{ product.grainDirection }} grain · {{ product.availability }}<span v-if="!selectable(product)"> · Not available for new selection</span></span>
              </span>
            </label>
          </li>
        </ul>
        <div
          v-if="!loading && !loadError && groups.length"
          class="border-t border-line bg-quiet-surface p-4"
        >
          <h3 class="mb-2 text-xs font-semibold text-muted">
            Bulk panel selection · all catalog references
          </h3>
          <div class="space-y-2">
            <div
              v-for="group in groups"
              :key="group.supplierId"
              class="flex flex-wrap items-center gap-x-4 gap-y-1"
            >
              <label class="flex min-h-9 items-center gap-2 text-xs font-semibold">
                <input
                  type="checkbox"
                  class="size-4 accent-accent"
                  :aria-label="`Use all products from ${group.supplierName}`"
                  :checked="checked(group.categories.flatMap(category => category.products))"
                  :indeterminate="mixed(group.categories.flatMap(category => category.products))"
                  :aria-checked="mixed(group.categories.flatMap(category => category.products)) ? 'mixed' : checked(group.categories.flatMap(category => category.products))"
                  :disabled="busy || !groupProducts(group.categories.flatMap(category => category.products)).length"
                  @change="toggleProducts(group.categories.flatMap(category => category.products))"
                >{{ group.supplierName }}
              </label>
              <label
                v-for="category in group.categories"
                :key="category.name"
                class="flex min-h-9 items-center gap-2 text-xs text-muted"
              >
                <input
                  type="checkbox"
                  class="size-4 accent-accent"
                  :aria-label="`Use ${category.name} products from ${group.supplierName}`"
                  :checked="checked(category.products)"
                  :indeterminate="mixed(category.products)"
                  :aria-checked="mixed(category.products) ? 'mixed' : checked(category.products)"
                  :disabled="busy || !groupProducts(category.products).length"
                  @change="toggleProducts(category.products)"
                >{{ category.name }}
              </label>
            </div>
          </div>
        </div>
      </section>
      <aside
        class="panel project-selection min-w-0 overflow-hidden"
        aria-labelledby="material-selection-title"
      >
        <div class="border-b border-line p-5">
          <h2
            id="material-selection-title"
            class="text-lg font-semibold"
          >
            Project selections
          </h2>
          <dl class="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt class="text-muted">
                Materials for Parts
              </dt><dd class="mt-1 text-2xl font-semibold tabular-nums">
                {{ selectedIds.length }}
              </dd>
            </div><div>
              <dt class="text-muted">
                Panel references
              </dt><dd class="mt-1 text-2xl font-semibold tabular-nums">
                {{ selectedProductIds.length }}
              </dd>
            </div>
          </dl>
        </div>
        <div class="selection-content overflow-y-auto">
          <template v-if="!loading && !loadError">
            <p
              v-if="!summaryMaterials.length && !missingSelections.length && !orphanProducts.length"
              class="p-5 text-sm leading-relaxed text-muted"
            >
              Choose materials from the library, then add any panel references you want to use.
            </p>
            <ul
              v-else
              class="divide-y divide-line"
            >
              <li
                v-for="material in summaryMaterials"
                :key="material.id"
                class="space-y-3 p-4"
              >
                <div class="flex items-center gap-3">
                  <MaterialThumbnail :preset-id="material.libraryPresetId" />
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-semibold [overflow-wrap:anywhere]">
                      {{ material.name }}
                    </p><p class="text-xs text-muted">
                      {{ selectedIds.includes(material.id) ? material.category : 'Panel references only' }}
                    </p>
                  </div>
                  <button
                    v-if="selectedIds.includes(material.id)"
                    type="button"
                    class="button button-compact px-2"
                    :aria-label="`Remove material ${material.name}`"
                    :disabled="busy"
                    @click="toggle(material)"
                  >
                    <AppIcon name="close" />
                  </button>
                </div>
                <ul
                  v-if="summaryProducts(material).length"
                  class="space-y-2"
                >
                  <li
                    v-for="product in summaryProducts(material)"
                    :key="product.id"
                    class="flex items-center gap-2 rounded-lg bg-quiet-surface p-2"
                  >
                    <div class="min-w-0 flex-1 text-xs">
                      <p class="font-medium [overflow-wrap:anywhere]">
                        {{ product.name }}
                      </p><p class="text-muted">
                        {{ supplierName(product) }} · {{ product.lengthMm }} × {{ product.widthMm }} × {{ product.thicknessMm }} mm
                      </p><p
                        v-if="!selectable(product)"
                        class="text-danger"
                      >
                        Unavailable reference retained
                      </p>
                    </div>
                    <button
                      type="button"
                      class="button button-compact px-2"
                      :aria-label="`Remove panel ${product.name}`"
                      :disabled="busy"
                      @click="removeProduct(product)"
                    >
                      <AppIcon name="close" />
                    </button>
                  </li>
                </ul>
              </li>
            </ul>
            <div
              v-if="orphanProducts.length"
              class="space-y-2 border-t border-line p-4"
            >
              <div
                v-for="product in orphanProducts"
                :key="product.id"
                class="flex items-center gap-2 text-sm"
              >
                <div class="min-w-0 flex-1">
                  <p>{{ product.name }}</p><p class="text-xs text-danger">
                    Missing material · reference retained
                  </p>
                </div>
                <button
                  type="button"
                  class="button button-compact"
                  :aria-label="`Remove panel ${product.name}`"
                  :disabled="busy"
                  @click="removeProduct(product)"
                >
                  <AppIcon name="close" />
                </button>
              </div>
            </div>
            <div
              v-if="missingSelections.length"
              class="space-y-2 border-t border-line p-4 text-sm"
            >
              <p class="text-danger">
                Some selected catalog references are missing. They have been retained; remove them explicitly to save valid choices.
              </p>
              <ul class="text-xs text-muted">
                <li
                  v-for="id in missingSelections"
                  :key="id"
                  class="[overflow-wrap:anywhere]"
                >
                  Missing reference: {{ id }}
                </li>
              </ul>
              <button
                type="button"
                class="button button-compact"
                :disabled="busy || loading"
                @click="removeMissing"
              >
                Remove missing selections
              </button>
            </div>
          </template>
        </div>
        <footer class="space-y-3 border-t border-line bg-quiet-surface p-4">
          <p
            role="status"
            class="text-xs"
            :class="dirty ? 'text-accent' : 'text-muted'"
          >
            {{ busy ? 'Saving selections…' : dirty ? 'Unsaved changes' : 'Selections up to date' }}
          </p>
          <p
            v-if="notice"
            role="status"
            class="text-sm text-success"
          >
            {{ notice }}
          </p>
          <p
            v-if="saveError"
            role="alert"
            class="text-sm text-danger"
          >
            {{ saveError }}
          </p>
          <button
            type="button"
            class="button button-primary w-full"
            :disabled="loading || busy || Boolean(loadError)"
            @click="save"
          >
            {{ busy ? 'Saving…' : 'Save project selections' }}
          </button>
        </footer>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.materials-workspace { display: grid; align-items: start; gap: 1rem; }
.material-list { max-height: 460px; }
@media (min-width: 768px) {
  .materials-workspace { grid-template-columns: minmax(240px, 0.7fr) minmax(0, 1.3fr); }
  .project-selection { grid-column: 1 / -1; }
}
@media (min-width: 1280px) {
  .materials-workspace { grid-template-columns: minmax(0, 25fr) minmax(0, 45fr) minmax(0, 30fr); }
  .project-selection { grid-column: auto; position: sticky; top: 1rem; }
  .material-list, .selection-content { max-height: max(300px, calc(100dvh - 490px)); }
}
</style>
