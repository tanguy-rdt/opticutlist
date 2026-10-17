<script setup lang="ts">
import { useDataImportRefresh } from '../../app/settings/use-data-import-refresh'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { orderStockItems, type StockOrder } from '../../application/inventory/stock-order'
import type { StockItem } from '../../domain/model/stock-item'
import type { Material } from '../../domain/model/material'
import type { CuttingConfirmation } from '../../domain/model/cutting-confirmation'
import { useCatalogStockRepository } from '../suppliers/catalog-repositories'
import { useMaterialRepository } from '../materials/material-repository'
import { useStockRepository } from './stock-repository'
import { persistenceErrorMessage } from '../../shared/ui/persistence-error-message'
import MaterialThumbnail from '../materials/MaterialThumbnail.vue'
import AppIcon from '../../shared/ui/AppIcon.vue'
import AppButton from '../../shared/ui/AppButton.vue'
import AppDialog from '../../shared/ui/AppDialog.vue'
import StockForm from './StockForm.vue'
import StockDetails from './StockDetails.vue'

const writer = useStockRepository()
const repository = writer ?? useCatalogStockRepository()
const materialRepository = useMaterialRepository()
const stock = shallowRef<readonly StockItem[]>([])
const orders = shallowRef<readonly StockOrder[]>([])
const materials = shallowRef<readonly Material[]>([])
const history = shallowRef<readonly CuttingConfirmation[]>([])
const historyLoading = ref(false)
const historyError = ref('')
const loading = ref(true)
const error = ref('')
const writeError = ref('')
const notice = ref('')
const busy = ref(false)
const formOpen = ref(false)
useDataImportRefresh(refreshOnFocus, () => !loading.value && !busy.value && !formOpen.value)
const editing = shallowRef<StockItem | null>(null)
const detailsOpen = ref(false)
const materialFilter = ref('')
const search = ref('')
const kindFilter = ref('')
const grainFilter = ref('')
const selectedId = ref('')
let generation = 0
let historyGeneration = 0
onBeforeUnmount(() => { generation++; historyGeneration++; window.removeEventListener('focus', refreshOnFocus) })
function materialName(id: string): string { return materials.value.find(material => material.id === id)?.name ?? 'Missing material' }
const materialGroups = computed(() => [...new Set(stock.value.map(item => item.materialId))].map(id => ({ id, material: materials.value.find(material => material.id === id), name: materialName(id), items: stock.value.filter(item => item.materialId === id) })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)))
const visible = computed(() => orderStockItems(stock.value, orders.value).filter(item => {
  const text = `${materialName(item.materialId)} ${item.id} ${item.kind === 'offcut' ? 'Offcut' : 'Full panel'} ${String(item.lengthMm)} ${String(item.widthMm)} ${String(item.thicknessMm)} ${item.provenance.source}`.toLocaleLowerCase()
  return (!materialFilter.value || item.materialId === materialFilter.value) && (!kindFilter.value || item.kind === kindFilter.value) && (!grainFilter.value || item.grainDirection === grainFilter.value) && text.includes(search.value.trim().toLocaleLowerCase())
}))
const sections = computed(() => materialGroups.value.map(group => ({ ...group, items: visible.value.filter(item => item.materialId === group.id) })).filter(group => group.items.length))
const selected = computed(() => visible.value.find(item => item.id === selectedId.value))
const selectedMaterial = computed(() => materials.value.find(material => material.id === selected.value?.materialId))
const summaries = computed(() => [
  { label: 'Owned panels', value: stock.value.filter(item => item.kind === 'fullPanel').reduce((sum, item) => sum + item.quantity, 0), icon: 'stock' as const },
  { label: 'Owned offcuts', value: stock.value.filter(item => item.kind === 'offcut').reduce((sum, item) => sum + item.quantity, 0), icon: 'products' as const },
  { label: 'Materials in stock', value: materialGroups.value.length, icon: 'layers' as const },
  { label: 'Stock references', value: stock.value.length, icon: 'info' as const },
])
watch(visible, items => { if (!items.some(item => item.id === selectedId.value)) selectedId.value = items[0]?.id ?? '' })
watch(selected, async item => {
  const current = ++historyGeneration
  history.value = []; historyError.value = ''; historyLoading.value = false
  if (!item) return
  if (!writer) { historyError.value = 'Movement history is unavailable.'; return }
  historyLoading.value = true
  const result = await writer.history(item.id)
  if (current !== historyGeneration) return
  historyLoading.value = false
  if (result.ok) history.value = result.value
  else historyError.value = persistenceErrorMessage(result.error, 'Cutting confirmation')
})
async function load(): Promise<void> {
  const current = ++generation; loading.value = true; error.value = ''
  if (!repository) { error.value = 'Inventory information is not available.'; loading.value = false; return }
  const [items, names, ordering] = await Promise.all([repository.list(), materialRepository.list(), writer ? writer.ordering() : Promise.resolve({ ok: true as const, value: [] })])
  if (current !== generation) return
  if (!items.ok) error.value = persistenceErrorMessage(items.error, 'Stock item')
  else if (!names.ok) error.value = persistenceErrorMessage(names.error, 'Material')
  else if (!ordering.ok) error.value = persistenceErrorMessage(ordering.error, 'Stock item')
  else { orders.value = ordering.value; stock.value = items.value; materials.value = names.value; if (materialFilter.value && !items.value.some(item => item.materialId === materialFilter.value)) materialFilter.value = '' }
  loading.value = false
}
const filtered = computed(() => Boolean(search.value.trim() || kindFilter.value || grainFilter.value))
const canReorder = computed(() => Boolean(writer) && !loading.value && !busy.value && !error.value && !formOpen.value && !filtered.value)
const dragged = shallowRef<StockItem | null>(null)
const dropTarget = shallowRef<{ id: string; position: 'before' | 'after' } | null>(null)
function clearDrag(): void { dragged.value = null; dropTarget.value = null }
async function moveRow(item: StockItem, target: StockItem, position: 'before' | 'after'): Promise<void> {
  if (!writer || !canReorder.value || item.materialId !== target.materialId) return
  busy.value = true; writeError.value = ''; notice.value = ''
  const current = generation
  const result = await writer.move(item.id, target.id, position)
  if (current !== generation) return
  busy.value = false
  if (!result.ok) writeError.value = 'Stock order could not be saved. ' + persistenceErrorMessage(result.error, 'Stock item')
  else {
    orders.value = [...orders.value.filter(order => order.id !== result.value.id), result.value]
    notice.value = 'Stock order updated.'
  }
}
async function moveBy(item: StockItem, direction: number, event: KeyboardEvent): Promise<void> {
  const handle = event.currentTarget
  const group = orderStockItems(stock.value.filter(stock => stock.materialId === item.materialId), orders.value)
  const target = group[group.findIndex(stock => stock.id === item.id) + direction]
  if (target) {
    await moveRow(item, target, direction < 0 ? 'before' : 'after')
    await nextTick()
    if (handle instanceof HTMLButtonElement && handle.isConnected) handle.focus()
  }
}
function dragStart(event: DragEvent, item: StockItem): void {
  if (!canReorder.value) { event.preventDefault(); return }
  dragged.value = item
  if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id) }
}
function dragOver(event: DragEvent, item: StockItem): void {
  if (!canReorder.value || !dragged.value || dragged.value.id === item.id || dragged.value.materialId !== item.materialId) { dropTarget.value = null; return }
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  const bounds = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : null
  dropTarget.value = { id: item.id, position: bounds && event.clientY >= bounds.top + bounds.height / 2 ? 'after' : 'before' }
}
async function drop(event: DragEvent, target: StockItem): Promise<void> {
  event.preventDefault()
  const source = dragged.value; const position = dropTarget.value?.id === target.id ? dropTarget.value.position : null
  clearDrag()
  if (source && position) await moveRow(source, target, position)
}
async function openForm(item: StockItem | null = null): Promise<void> {
  if (!writer || busy.value || loading.value || error.value) return
  detailsOpen.value = false; editing.value = item; writeError.value = ''; formOpen.value = true
  await nextTick(); document.getElementById('stock-material')?.focus()
}
function closeForm(): void { if (!busy.value) { formOpen.value = false; editing.value = null; writeError.value = '' } }
async function save(item: StockItem, presetId?: string): Promise<void> {
  if (!writer || busy.value) return
  busy.value = true; writeError.value = ''; notice.value = ''
  const current = generation
  const result = presetId !== undefined ? await writer.saveWithPreset(item, presetId, editing.value ?? undefined) : editing.value ? await writer.update(editing.value.id, item, editing.value) : await writer.create(item)
  if (current !== generation) return
  busy.value = false
  if (result.ok) {
    notice.value = editing.value ? 'Stock item updated.' : 'Stock item added.'
    formOpen.value = false; editing.value = null; selectedId.value = result.value.id; materialFilter.value = ''; search.value = ''; kindFilter.value = ''; grainFilter.value = ''
    await load()
  } else writeError.value = persistenceErrorMessage(result.error, 'Stock item')
}
async function remove(item: StockItem): Promise<void> {
  if (!writer || busy.value || !window.confirm(`Delete this ${item.kind === 'offcut' ? 'offcut' : 'panel'} stock reference and all ${String(item.quantity)} owned items? Past cutting records will be preserved.`)) return
  busy.value = true; writeError.value = ''; notice.value = ''
  const current = generation
  const result = await writer.delete(item.id, item)
  if (current !== generation) return
  busy.value = false
  if (result.ok) { detailsOpen.value = false; notice.value = 'Stock item deleted.'; await load() }
  else writeError.value = persistenceErrorMessage(result.error, 'Stock item')
}
function refreshOnFocus(): void { if (!loading.value && !busy.value && !formOpen.value) void load() }
onMounted(() => { window.addEventListener('focus', refreshOnFocus); void load() })
</script>
<template>
  <section class="space-y-5">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">
          Stock
        </h1><p class="mt-1 text-sm text-muted">
          Physically owned panels and offcuts. Catalog products are not inventory.
        </p>
      </div>
      <div class="flex gap-2">
        <button
          type="button"
          class="button button-primary"
          :disabled="!writer || loading || !!error || busy"
          @click="openForm()"
        >
          <AppIcon name="plus" />Add to stock
        </button>
      </div>
    </header>
    <p
      v-if="notice"
      role="status"
      class="rounded-lg bg-success-surface p-3 text-sm text-success"
    >
      {{ notice }}
    </p>
    <p
      v-if="writeError && !formOpen"
      role="alert"
      class="text-sm text-danger"
    >
      {{ writeError }}
    </p>
    <p
      v-if="loading"
      role="status"
      class="panel p-5 text-sm text-muted"
    >
      Loading owned stock…
    </p>
    <p
      v-else-if="error"
      role="alert"
      class="panel p-5 text-danger"
    >
      {{ error }}
      <button
        type="button"
        class="button ml-3"
        @click="load"
      >
        Retry
      </button>
    </p>
    <template v-else>
      <dl
        aria-label="Stock summary"
        class="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        <div
          v-for="summary in summaries"
          :key="summary.label"
          class="panel flex items-center gap-3 p-4"
        >
          <span class="flex size-10 items-center justify-center rounded-lg bg-icon-surface text-accent"><AppIcon :name="summary.icon" /></span><div>
            <dt class="text-xs text-muted">
              {{ summary.label }}
            </dt><dd class="mt-1 text-xl font-semibold tabular-nums">
              {{ summary.value }}
            </dd>
          </div>
        </div>
      </dl>
      <section
        v-if="!stock.length"
        class="panel flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center"
        aria-label="Empty inventory"
      >
        <AppIcon
          name="stock"
          class="size-10 text-accent"
        /><h2 class="text-lg font-semibold">
          No physical stock items yet.
        </h2><p class="max-w-md text-sm text-muted">
          No physical inventory is recorded. Add panels or offcuts you already own to start managing your workshop stock.
        </p><button
          type="button"
          class="button button-primary"
          :disabled="!writer"
          @click="openForm()"
        >
          Add first stock item
        </button>
      </section>
      <div
        v-else
        class="grid min-w-0 items-start gap-4 md:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_300px] 2xl:grid-cols-[220px_minmax(0,1fr)_330px]"
      >
        <nav
          aria-label="Stock materials"
          class="panel space-y-4 p-4"
        >
          <h2 class="font-semibold">
            Materials <span class="text-sm text-muted">{{ materialGroups.length }}</span>
          </h2>
          <button
            type="button"
            class="flex w-full items-center justify-between rounded-lg px-3 py-3 text-left text-sm"
            :class="!materialFilter ? 'bg-success-surface text-accent' : 'hover:bg-hover'"
            :aria-pressed="!materialFilter"
            @click="materialFilter = ''"
          >
            All materials<span>{{ stock.reduce((sum, item) => sum + item.quantity, 0) }}</span>
          </button>
          <button
            v-for="group in materialGroups"
            :key="group.id"
            type="button"
            class="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left"
            :class="materialFilter === group.id ? 'bg-success-surface text-accent' : 'hover:bg-hover'"
            :aria-pressed="materialFilter === group.id"
            @click="materialFilter = group.id"
          >
            <MaterialThumbnail :preset-id="group.material?.libraryPresetId" /><span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium">{{ group.name }}</span><span class="text-xs text-muted">{{ group.items.reduce((sum, item) => sum + item.quantity, 0) }} owned · {{ group.items.length }} references</span></span>
          </button>
        </nav>
        <div class="min-w-0 space-y-4">
          <div class="panel grid gap-3 p-4 sm:grid-cols-3">
            <div>
              <label
                for="stock-search"
                class="mb-2 block text-xs font-medium text-muted"
              >Search inventory</label><input
                id="stock-search"
                v-model="search"
                class="field"
                type="search"
                placeholder="Material, dimensions or source…"
              >
            </div>
            <div>
              <label
                for="stock-type-filter"
                class="mb-2 block text-xs font-medium text-muted"
              >Item type</label><select
                id="stock-type-filter"
                v-model="kindFilter"
                class="field"
              >
                <option value="">
                  All types
                </option><option value="fullPanel">
                  Full panels
                </option><option value="offcut">
                  Offcuts
                </option>
              </select>
            </div>
            <div>
              <label
                for="stock-grain-filter"
                class="mb-2 block text-xs font-medium text-muted"
              >Grain</label><select
                id="stock-grain-filter"
                v-model="grainFilter"
                class="field"
              >
                <option value="">
                  Any grain
                </option><option value="none">
                  No constraint
                </option><option value="length">
                  Along length
                </option><option value="width">
                  Along width
                </option>
              </select>
            </div>
          </div>
          <p
            v-if="!sections.length"
            class="panel p-5 text-sm text-muted"
          >
            No stock matches these filters.
          </p>
          <p
            id="stock-order-help"
            :class="filtered ? 'text-xs text-muted' : 'sr-only'"
          >
            {{ filtered ? 'Clear search and type/grain filters to reorder stock.' : 'Drag a grip to reorder within its material, or focus it and use the Up and Down arrow keys.' }}
          </p>
          <section
            v-for="group in sections"
            :key="group.id"
            class="panel min-w-0 overflow-hidden"
          >
            <header class="flex items-center gap-3 border-b border-line bg-quiet-surface p-4">
              <div>
                <h2 class="text-sm font-semibold">
                  {{ group.name }}
                </h2><p class="mt-1 text-xs text-muted">
                  {{ group.items.length }} references · {{ group.items.reduce((sum, item) => sum + item.quantity, 0) }} owned
                </p>
              </div>
            </header>
            <div
              class="overflow-x-auto"
              tabindex="0"
              role="region"
              :aria-label="`Physical stock table: ${group.name}`"
            >
              <table class="w-full text-left text-sm">
                <caption class="sr-only">
                  {{ group.name }} owned panels and offcuts; dimensions in millimeters
                </caption>
                <thead class="bg-quiet-surface text-xs text-muted">
                  <tr>
                    <th
                      scope="col"
                      class="w-10 px-2 py-2"
                    >
                      <span class="sr-only">Order</span>
                    </th>
                    <th
                      scope="col"
                      class="px-3 py-2"
                    >
                      Item type
                    </th><th
                      scope="col"
                      class="px-3 py-2"
                    >
                      Dimensions
                    </th><th
                      scope="col"
                      class="px-3 py-2"
                    >
                      Thickness (mm)
                    </th><th
                      scope="col"
                      class="px-3 py-2"
                    >
                      Quantity
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
                    v-for="item in group.items"
                    :key="item.id"
                    class="border-t border-line"
                    :data-stock-id="item.id"
                    :class="[selectedId === item.id ? 'bg-success-surface' : 'hover:bg-hover', dragged?.id === item.id ? 'opacity-50' : '']"
                    :style="dropTarget?.id === item.id ? { boxShadow: `inset 0 ${dropTarget.position === 'before' ? '2px' : '-2px'} 0 var(--accent)` } : {}"
                    @click="selectedId = item.id"
                    @dragover="dragOver($event, item)"
                    @drop="drop($event, item)"
                  >
                    <td class="px-2 py-2">
                      <button
                        type="button"
                        class="inline-flex size-9 items-center justify-center rounded text-muted hover:bg-hover hover:text-ink focus-visible:outline-accent enabled:cursor-grab active:cursor-grabbing"
                        :draggable="canReorder"
                        :disabled="!canReorder"
                        :aria-label="`Reorder stock item ${item.id}`"
                        aria-describedby="stock-order-help"
                        aria-keyshortcuts="ArrowUp ArrowDown"
                        title="Drag to reorder; Up/Down keys move one row"
                        @click.stop
                        @dragstart.stop="dragStart($event, item)"
                        @dragend="clearDrag"
                        @keydown.up.prevent.stop="moveBy(item, -1, $event)"
                        @keydown.down.prevent.stop="moveBy(item, 1, $event)"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          class="size-4"
                          fill="currentColor"
                          aria-hidden="true"
                        ><circle
                          v-for="(point, index) in [[9, 5], [15, 5], [9, 12], [15, 12], [9, 19], [15, 19]]"
                          :key="index"
                          :cx="point[0]"
                          :cy="point[1]"
                          r="1.5"
                        /></svg>
                      </button>
                    </td>
                    <th
                      scope="row"
                      class="px-3 py-3 font-medium"
                    >
                      <button
                        type="button"
                        class="rounded text-left text-accent"
                        :aria-label="`Select stock item ${item.id}`"
                        :aria-pressed="selectedId === item.id"
                        @click.stop="selectedId = item.id"
                      >
                        {{ item.kind === 'offcut' ? 'Offcut' : 'Full panel' }}
                      </button>
                    </th><td class="whitespace-nowrap px-3 py-3 tabular-nums">
                      {{ item.lengthMm }} × {{ item.widthMm }} mm
                    </td><td class="px-3 py-3 tabular-nums">
                      {{ item.thicknessMm }}
                    </td><td class="px-3 py-3 tabular-nums">
                      {{ item.quantity }}
                    </td><td class="w-px whitespace-nowrap px-3 py-3">
                      <div class="flex items-center justify-end gap-1">
                        <AppButton
                          variant="ghost"
                          size="small"
                          icon-only
                          label="Edit stock item"
                          title="Edit stock item"
                          :disabled="!writer || busy || loading || Boolean(error)"
                          @click.stop="openForm(item)"
                        >
                          <AppIcon name="edit" />
                        </AppButton>
                        <AppButton
                          variant="ghost"
                          size="small"
                          icon-only
                          label="Delete stock item"
                          title="Delete stock item"
                          class="text-danger"
                          :disabled="!writer || busy || loading || Boolean(error)"
                          @click.stop="remove(item)"
                        >
                          <AppIcon name="delete" />
                        </AppButton>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
          <button
            v-if="selected"
            type="button"
            class="button w-full md:hidden"
            @click="detailsOpen = true"
          >
            View stock details
          </button>
        </div>
        <aside class="panel hidden min-w-0 p-5 md:col-start-2 md:block xl:sticky xl:top-5 xl:col-start-3 xl:row-start-1">
          <StockDetails
            v-if="selected"
            :item="selected"
            :material="selectedMaterial"
            :history="history"
            :history-loading="historyLoading"
            :history-error="historyError"
          /><p
            v-else
            class="text-sm text-muted"
          >
            Select a stock item to inspect it.
          </p>
        </aside>
      </div>
    </template>
    <AppDialog
      v-if="detailsOpen && selected"
      title="Stock details"
      close-label="Close details"
      :busy="busy"
      @close="detailsOpen = false"
    >
      <StockDetails
        :item="selected"
        :material="selectedMaterial"
        :history="history"
        :history-loading="historyLoading"
        :history-error="historyError"
      />
    </AppDialog>
    <AppDialog
      v-if="formOpen"
      :title="editing ? 'Edit stock item' : 'Add to stock'"
      :busy="busy"
      @close="closeForm"
    >
      <StockForm
        :item="editing"
        :materials="materials"
        :disabled="busy"
        @save="save"
      /><p
        v-if="writeError"
        role="alert"
        class="mt-4 text-sm text-danger"
      >
        {{ writeError }}
      </p>
    </AppDialog>
  </section>
</template>
