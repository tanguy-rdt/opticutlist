<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useProjectId } from './project-service'
import { useProjectStockService } from './project-stock-service'
import type { ProjectStockPreview } from '../../application/inventory/project-stock-service'
import { persistenceErrorMessage } from '../../shared/ui/persistence-error-message'
import StockPanelPreview from './StockPanelPreview.vue'

const service = useProjectStockService().forProject(useProjectId())
const preview = shallowRef<ProjectStockPreview | null>(null)
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const panelIndex = ref(0)
let active = true
const panels = computed(() => preview.value?.saved?.plan.panels.map((allocation, index) => ({ index, allocation, source: preview.value?.saved?.contents.sources.find(source => source.product.id === allocation.supplierProductId) })) ?? [])
const panel = computed(() => panels.value[panelIndex.value])
const kept = computed(() => preview.value?.rows.filter(row => row.candidate.panelIndex === panelIndex.value && row.status !== 'Outdated' && row.keep).map(row => row.candidate.wasteIndex) ?? [])
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
  busy.value = true; error.value = ''
  const result = await service.setKeep(key, checked)
  if (!active) return
  if (!result.ok) { control.checked = !checked; error.value = persistenceErrorMessage(result.error, 'Stock item') }
  await load()
  busy.value = false
}
function beforeUnload(event: BeforeUnloadEvent): void { if (busy.value) event.preventDefault() }
onBeforeRouteLeave(() => !busy.value)
onMounted(() => { window.addEventListener('beforeunload', beforeUnload); void load() })
onBeforeUnmount(() => { active = false; window.removeEventListener('beforeunload', beforeUnload) })
</script>
<template>
  <section class="space-y-4">
    <header>
      <h1 class="text-2xl font-semibold">
        Stock
      </h1><p class="text-sm text-muted">
        Kept offcuts synchronize with physical stock automatically.
      </p>
    </header>
    <p
      v-if="loading || busy"
      role="status"
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
    <button
      v-if="error && !busy"
      type="button"
      class="button"
      @click="error = ''; load()"
    >
      Retry
    </button>
    <p
      v-if="!loading && !preview?.saved"
      class="panel p-6"
    >
      No cutting plan yet. Optimize this project to review reusable offcuts.
    </p>
    <div
      v-else-if="preview?.saved"
      class="grid items-start gap-4 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.6fr)]"
    >
      <div class="space-y-3">
        <section
          v-for="source in panels"
          :key="source.index"
          class="panel overflow-hidden"
        >
          <button
            type="button"
            class="flex w-full justify-between gap-3 bg-subtle p-3 text-left font-semibold"
            :aria-pressed="panelIndex === source.index"
            :class="panelIndex === source.index ? 'text-accent ring-1 ring-inset ring-selection-line' : 'text-ink'"
            @click="panelIndex = source.index"
          >
            Panel {{ source.index + 1 }} <span class="text-xs font-normal text-muted">{{ source.source?.product.lengthMm }} × {{ source.source?.product.widthMm }} mm</span>
          </button>
          <div
            v-for="row in preview.rows.filter(row => row.status !== 'Outdated' && row.candidate.panelIndex === source.index)"
            :key="row.key"
            class="flex items-center gap-3 border-t border-line p-3 text-sm"
          >
            <input
              type="checkbox"
              :aria-label="`Keep offcut ${row.candidate.wasteIndex + 1} from panel ${source.index + 1}`"
              :checked="row.keep"
              :disabled="busy"
              @change="select(row.key, $event)"
            >
            <div class="min-w-0 flex-1">
              <p>{{ row.candidate.materialName }}</p><p class="tabular-nums">
                {{ row.candidate.region.lengthMm }} × {{ row.candidate.region.widthMm }} × {{ row.candidate.panel.thicknessMm }} mm
              </p><p class="text-xs text-muted">
                {{ row.status }}{{ row.modified ? ' · Modified or used elsewhere' : '' }}
              </p>
            </div>
          </div>
        </section>
        <p
          v-if="!preview.rows.length"
          class="panel p-4 text-sm text-muted"
        >
          No reusable rectangular offcuts in this plan.
        </p>
        <section
          v-if="preview.rows.some(row => row.status === 'Outdated')"
          class="panel p-3 text-sm"
          aria-label="Outdated offcuts"
        >
          <h2 class="font-semibold">
            Previous plan offcuts
          </h2><p
            v-for="row in preview.rows.filter(row => row.status === 'Outdated')"
            :key="row.key"
            class="mt-2"
          >
            {{ row.candidate.materialName }} · {{ row.candidate.region.lengthMm }} × {{ row.candidate.region.widthMm }} × {{ row.candidate.panel.thicknessMm }} mm · Outdated{{ row.modified ? ' / preserved' : '' }}
          </p>
        </section>
      </div>
      <section
        class="panel min-w-0 p-3"
        aria-label="Current panel cutting preview"
      >
        <StockPanelPreview
          v-if="panel?.source"
          :plan="panel.allocation.plan"
          :panel="panel.source.product"
          :parts="preview.saved.contents.parts"
          :settings="preview.saved.contents.settings"
          :kept="kept"
        />
        <details
          v-if="preview.movements.length"
          class="mt-3 border-t border-line pt-3 text-sm"
          aria-label="Stock movement history"
        >
          <summary class="cursor-pointer font-semibold">
            Stock movement history
          </summary>
          <ul class="mt-2 space-y-2 text-xs text-muted">
            <li
              v-for="movement in preview.movements"
              :key="movement.id"
            >
              {{ new Date(movement.createdAt).toLocaleString() }} · {{ movement.added.length }} offcuts added · {{ movement.removed.length }} removed · {{ movement.consumed.reduce((sum, item) => sum + item.quantity, 0) }} source units consumed · {{ movement.restored.reduce((sum, item) => sum + item.quantity, 0) }} restored
            </li>
          </ul>
        </details>
      </section>
    </div>
  </section>
</template>
