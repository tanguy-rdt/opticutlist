<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, nextTick, ref, shallowRef } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useProjectId } from './project-service'
import { useProjectStockService } from './project-stock-service'
import type { ProjectStockPreview } from '../../application/inventory/project-stock-service'
import { persistenceErrorMessage } from '../../shared/ui/persistence-error-message'
import AppButton from '../../shared/ui/AppButton.vue'
import AppIcon from '../../shared/ui/AppIcon.vue'
import StockPanelPreview from './StockPanelPreview.vue'

const service = useProjectStockService().forProject(useProjectId())
const preview = shallowRef<ProjectStockPreview | null>(null)
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const panelIndex = ref(0)
const expandedPanels = ref(new Set([0]))
const selectedKey = ref('')
const hoveredKey = ref('')
const workspace = ref<HTMLElement | null>(null)
const currentRows = computed(() => preview.value?.rows.filter(row => row.status !== 'Outdated') ?? [])
let active = true
const panels = computed(() => preview.value?.saved?.plan.panels.map((allocation, index) => ({
  index,
  allocation,
  rows: currentRows.value.filter(row => row.candidate.panelIndex === index).sort((a, b) => a.candidate.wasteIndex - b.candidate.wasteIndex).map((row, offcutIndex) => ({ ...row, label: `Offcut ${String(offcutIndex + 1)}` })),
  source: preview.value?.saved?.contents.sources.find(source => source.product.id === allocation.supplierProductId)
})) ?? [])
const panel = computed(() => panels.value[currentRows.value.find(row => row.key === hoveredKey.value)?.candidate.panelIndex ?? panelIndex.value])
const kept = computed(() => preview.value?.rows.filter(row => row.candidate.panelIndex === panel.value?.index && row.status !== 'Outdated' && row.keep).map(row => row.candidate.wasteIndex) ?? [])
const offcutLabels = computed(() => panel.value?.rows.map(row => ({ index: row.candidate.wasteIndex, label: row.label })) ?? [])
function wasteIndex(key: string): number | null {
  return panel.value?.rows.find(row => row.key === key)?.candidate.wasteIndex ?? null
}
function showPanel(index: number): void {
  panelIndex.value = index
  expandedPanels.value = new Set(expandedPanels.value).add(index)
  hoveredKey.value = ''
}
function togglePanel(index: number): void {
  const expanded = new Set(expandedPanels.value)
  if (expanded.has(index)) expanded.delete(index)
  else expanded.add(index)
  expandedPanels.value = expanded
}
function inspectRow(key: string): void {
  const row = currentRows.value.find(row => row.key === key)
  if (!row) return
  if (panelIndex.value !== row.candidate.panelIndex) showPanel(row.candidate.panelIndex)
  selectedKey.value = key
}
function hoverWaste(index: number | null): void {
  hoveredKey.value = panel.value?.rows.find(row => row.candidate.wasteIndex === index)?.key ?? ''
}
async function selectWaste(index: number): Promise<void> {
  const row = panel.value?.rows.find(row => row.candidate.wasteIndex === index)
  if (!row) return
  expandedPanels.value = new Set(expandedPanels.value).add(row.candidate.panelIndex)
  panelIndex.value = row.candidate.panelIndex
  selectedKey.value = row.key
  await nextTick()
  const control = Array.from(workspace.value?.querySelectorAll<HTMLButtonElement>('[data-offcut-select]') ?? []).find(button => button.dataset.offcutSelect === row.key)
  control?.focus({ preventScroll: true })
  if (control && typeof control.scrollIntoView === 'function') control.scrollIntoView({ block: 'nearest' })
}
async function load(): Promise<void> {
  const synced = await service.sync()
  const result = await service.preview()
  if (!active) return
  if (!synced.ok) error.value = persistenceErrorMessage(synced.error, 'Stock item')
  if (result.ok) preview.value = result.value
  else error.value = persistenceErrorMessage(result.error, 'Saved plan')
  loading.value = false
}
async function select(key: string, event: Event): Promise<void> {
  if (!(event.target instanceof HTMLInputElement) || busy.value) return
  const control = event.target
  const checked = control.checked
  busy.value = true;
  error.value = ''
  const result = await service.setKeep(key, checked)
  if (!active) return
  if (!result.ok) {
    control.checked = !checked;
    error.value = persistenceErrorMessage(result.error, 'Stock item')
  }
  await load()
  busy.value = false
}
function beforeUnload(event: BeforeUnloadEvent): void { if (busy.value) event.preventDefault() }
onBeforeRouteLeave(() => !busy.value)
onMounted(() => {
  window.addEventListener('beforeunload', beforeUnload);
  void load()
})
onBeforeUnmount(() => {
  active = false;
  window.removeEventListener('beforeunload', beforeUnload)
})
</script>
<template>
  <section
    ref="workspace"
    class="space-y-4"
  >
    <header>
      <h1 class="text-2xl font-semibold">
        Stock
      </h1>
      <p class="text-sm text-muted">
        Kept offcuts synchronize with physical stock automatically.
      </p>
    </header>
    <p
      v-if="loading || busy"
      role="status"
      class="text-sm text-muted"
    >
      {{ loading ? 'Loading project offcuts…' : 'Synchronizing stock…' }}
    </p>
    <p
      v-if="error || preview?.conflict"
      role="alert"
      class="text-danger"
    >
      {{ error || preview?.conflict }}
    </p>
    <AppButton
      v-if="error && !busy"
      @click="error = ''; load()"
    >
      Retry
    </AppButton>
    <p
      v-if="!loading && !preview?.saved"
      class="panel p-6"
    >
      No cutting plan yet. Optimize this project to review reusable offcuts.
    </p>
    <div
      v-else-if="preview?.saved"
      class="stock-workspace"
    >
      <div
        class="panel offcut-list"
        aria-label="Project offcuts"
      >
        <section
          v-for="source in panels"
          :key="source.index"
          class="offcut-group"
        >
          <header
            class="offcut-group-header"
            :class="{ 'active-panel': panelIndex === source.index }"
          >
            <button
              type="button"
              class="panel-select"
              :aria-pressed="panelIndex === source.index"
              :title="source.source?.product.name"
              @click="showPanel(source.index)"
            >
              <span class="truncate font-semibold">Panel {{ source.index + 1 }}<span v-if="source.source?.product.name"> — {{ source.source.product.name }}</span></span>
              <span class="text-xs tabular-nums text-muted">{{ source.source?.product.lengthMm }} × {{ source.source?.product.widthMm }} mm · {{ source.rows.length }} {{ source.rows.length === 1 ? 'offcut' : 'offcuts' }}</span>
            </button>
            <AppButton
              size="small"
              variant="ghost"
              icon-only
              :label="`${expandedPanels.has(source.index) ? 'Collapse' : 'Expand'} panel ${source.index + 1} offcuts`"
              :aria-expanded="expandedPanels.has(source.index)"
              :aria-controls="`panel-offcuts-${source.index}`"
              @click="togglePanel(source.index)"
            >
              <AppIcon
                name="chevron"
                :class="{ 'rotate-90': expandedPanels.has(source.index) }"
              />
            </AppButton>
          </header>
          <div
            v-show="expandedPanels.has(source.index)"
            :id="`panel-offcuts-${source.index}`"
          >
            <div
              v-for="row in source.rows"
              :key="row.key"
              class="offcut-row"
              :class="{ 'selected-offcut': selectedKey === row.key, 'hovered-offcut': hoveredKey === row.key }"
              @mouseenter="hoveredKey = row.key"
              @mouseleave="hoveredKey = ''"
            >
              <input
                type="checkbox"
                class="offcut-checkbox"
                :aria-label="`Keep ${row.label.toLowerCase()} from panel ${source.index + 1}`"
                :checked="row.keep"
                :disabled="busy"
                @change="select(row.key, $event)"
              >
              <button
                type="button"
                class="offcut-select"
                :data-offcut-select="row.key"
                :aria-pressed="selectedKey === row.key"
                :aria-label="`Inspect ${row.label.toLowerCase()} from panel ${source.index + 1}`"
                @click="inspectRow(row.key)"
              >
                <span class="block font-medium tabular-nums">{{ row.candidate.region.lengthMm }} × {{ row.candidate.region.widthMm }} × {{ row.candidate.panel.thicknessMm }} mm</span>
                <span class="block truncate text-xs text-muted">{{ row.label }} · {{ row.candidate.materialName }} · {{ row.status }}{{ row.modified ? ' · Modified or used elsewhere' : '' }}</span>
              </button>
            </div>
            <p
              v-if="!source.rows.length"
              class="px-4 py-3 text-xs text-muted"
            >
              No reusable rectangular offcuts on this panel.
            </p>
          </div>
        </section>
        <p
          v-if="!preview.rows.length"
          class="p-4 text-sm text-muted"
        >
          No reusable rectangular offcuts in this plan.
        </p>
        <section
          v-if="preview.rows.some(row => row.status === 'Outdated')"
          class="border-t border-line p-3 text-sm"
          aria-label="Outdated offcuts"
        >
          <h2 class="font-semibold">
            Previous plan offcuts
          </h2>
          <p
            v-for="row in preview.rows.filter(row => row.status === 'Outdated')"
            :key="row.key"
            class="mt-2 text-xs text-muted"
          >
            {{ row.candidate.materialName }} · {{ row.candidate.region.lengthMm }} × {{ row.candidate.region.widthMm }} × {{ row.candidate.panel.thicknessMm }} mm · Outdated{{ row.modified ? ' / preserved' : '' }}
          </p>
        </section>
      </div>
      <section
        class="panel stock-editor"
        aria-label="Current panel cutting preview"
      >
        <StockPanelPreview
          v-if="panel?.source"
          :plan="panel.allocation.plan"
          :panel="panel.source.product"
          :parts="preview.saved.contents.parts"
          :settings="preview.saved.contents.settings"
          :kept="kept"
          :label="`Panel ${panel.index + 1} — ${panel.source.product.name}`"
          :panel-key="`${preview.saved.summary.id}:${panel.index}`"
          :offcuts="offcutLabels"
          :selected-waste="wasteIndex(selectedKey)"
          :hovered-waste="wasteIndex(hoveredKey)"
          @select-waste="selectWaste"
          @hover-waste="hoverWaste"
        />
      </section>
    </div>
  </section>
</template>
<style scoped>
.stock-workspace { display: grid; grid-template-columns: minmax(16rem, .8fr) minmax(0, 1.6fr); align-items: start; gap: 1rem; }
.offcut-list, .stock-editor { min-width: 0; overflow: hidden; }
.offcut-group + .offcut-group { border-top: 1px solid var(--line); }
.offcut-group-header { display: flex; align-items: center; gap: .25rem; padding-right: .5rem; }
.active-panel { background: var(--subtle); color: var(--accent); }
.panel-select { display: grid; flex: 1; min-width: 0; gap: .2rem; padding: .75rem; text-align: left; font-size: .875rem; }
.panel-select:hover:not([aria-pressed="true"]) { background: var(--hover); }
.offcut-row { display: flex; align-items: center; gap: .625rem; padding: .125rem .75rem; border-top: 1px solid var(--line); }
.hovered-offcut { background: var(--hover); }
.selected-offcut { background: var(--subtle); }
.offcut-checkbox { flex: none; width: 1rem; height: 1rem; accent-color: var(--accent); }
.offcut-select { flex: 1; min-width: 0; padding: .5rem 0; text-align: left; font-size: .875rem; border-radius: var(--control-radius); }
@media (max-width: 1023px) { .stock-workspace { grid-template-columns: minmax(0, 1fr); } }
</style>
