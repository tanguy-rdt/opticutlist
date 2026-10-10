<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { isCompatible } from '../../domain/compatibility'
import { cuttingSettingsSchema, type CuttingSettings } from '../../domain/model/cutting-settings'
import type { Part } from '../../domain/model/part'
import type { SupplierProduct } from '../../domain/model/supplier-product'
import type { OptimizePanelSelection } from '../../domain/optimizer/optimize-panel'
import type { PanelCuttingPlan, UnplacedReason } from '../../domain/optimizer/plan-with-strategy'
import FormField from '../../shared/ui/FormField.vue'
import CuttingPlanViewer from './CuttingPlanViewer.vue'
import { persistenceErrorMessage } from '../../shared/ui/persistence-error-message'
import { useMaterialRepository } from '../materials/material-repository'
import { useProjectId, useProjectService } from '../projects/project-service'
import { useCatalogRepositories } from '../suppliers/catalog-repositories'
import { useOptimizationService } from './optimization-service'

const projectId = useProjectId()
const projects = useProjectService()
const catalogs = useCatalogRepositories()
const materials = useMaterialRepository()
const optimizer = useOptimizationService()
type State = 'loading' | 'ready' | 'running' | 'success' | 'failure' | 'cancelled'
interface PanelChoice { product: SupplierProduct; label: string; problem: string }
interface RunResult {
  selection: Extract<OptimizePanelSelection, { ok: true }>
  panel: SupplierProduct
  parts: readonly Part[]
  settings: CuttingSettings
}
const state = ref<State>('loading')
const parts = shallowRef<readonly Part[]>([])
const panels = shallowRef<readonly PanelChoice[]>([])
const missingIds = shallowRef<readonly string[]>([])
const panelId = ref('')
const kerf = ref<number | string>(3)
const margin = ref<number | string>(0)
const error = ref('')
const inputError = ref('')
const fieldErrors = ref<{ kerfMm?: string; edgeMarginMm?: string }>({})
const result = shallowRef<RunResult | null>(null)
const editedPlan = shallowRef<PanelCuttingPlan | null>(null)
const displayedPlan = computed(() => editedPlan.value ?? result.value?.selection.plan ?? null)
function planChanged(plan: PanelCuttingPlan, modified: boolean): void { editedPlan.value = modified ? plan : null }
let generation = 0
const busy = computed(() => state.value === 'running' || state.value === 'loading')
const selectedPanel = computed(() => panels.value.find(panel => panel.product.id === panelId.value))
const totalCopies = computed(() => parts.value.reduce((sum, part) => sum + part.quantity, 0))
const incompatibleCopies = computed(() => {
  const panel = selectedPanel.value
  return panel === undefined ? 0 : parts.value.filter(part => !isCompatible(part, panel.product)).reduce((sum, part) => sum + part.quantity, 0)
})
const unplacedCount = computed(() => result.value?.selection.plan.unplaced.reduce((sum, item) => sum + item.count, 0) ?? 0)

function invalidate(): void {
  generation += 1
  optimizer.cancel()
  result.value = null
  editedPlan.value = null
  error.value = ''
}
watch([panelId, kerf, margin], () => {
  invalidate()
  fieldErrors.value = {}
  if (state.value !== 'loading') state.value = 'ready'
}, { flush: 'sync' })

// Read fresh repository snapshots before each run; never write business records here.
async function readInputs() {
  const [project, scopedParts, products, supplierRecords, materialRecords] = await Promise.all([
    projects.projects.get(projectId), projects.parts(projectId).list(),
    catalogs.supplierProducts.list(), catalogs.suppliers.list(), materials.list(),
  ])
  if (!project.ok) throw new Error(persistenceErrorMessage(project.error, 'Project'))
  if (!scopedParts.ok) throw new Error(persistenceErrorMessage(scopedParts.error, 'Part'))
  if (!products.ok) throw new Error(persistenceErrorMessage(products.error, 'Product'))
  if (!supplierRecords.ok) throw new Error(persistenceErrorMessage(supplierRecords.error, 'Supplier'))
  if (!materialRecords.ok) throw new Error(persistenceErrorMessage(materialRecords.error, 'Material'))
  const selected = new Set(project.value.supplierProductIds)
  const choices = products.value.filter(product => selected.has(product.id)).map(product => {
    const supplier = supplierRecords.value.find(record => record.id === product.supplierId)
    const material = materialRecords.value.find(record => record.id === product.materialId)
    const problem = supplier === undefined || material === undefined ? 'Missing catalog reference'
      : product.availability === 'unavailable' ? 'Unavailable'
        : !scopedParts.value.some(part => isCompatible(part, product)) ? 'No matching material and exact thickness' : ''
    return { product, label: `${supplier?.name ?? 'Missing supplier'} / ${material?.name ?? 'Missing material'} / ${product.name}`, problem }
  })
  return {
    parts: scopedParts.value,
    panels: choices,
    missingIds: project.value.supplierProductIds.filter(id => !products.value.some(product => product.id === id)),
  }
}
function applyInputs(inputs: Awaited<ReturnType<typeof readInputs>>): void {
  parts.value = inputs.parts
  panels.value = inputs.panels
  missingIds.value = inputs.missingIds
}
async function load(): Promise<void> {
  invalidate()
  const current = generation
  state.value = 'loading'
  inputError.value = ''
  try {
    const inputs = await readInputs()
    if (current !== generation) return
    applyInputs(inputs)
    state.value = 'ready'
  } catch (cause) {
    if (current !== generation) return
    inputError.value = cause instanceof Error ? cause.message : 'Could not load optimization inputs.'
    state.value = 'failure'
  }
}
async function start(): Promise<void> {
  if (busy.value || inputError.value) return
  invalidate()
  const current = generation
  const settings = cuttingSettingsSchema.safeParse({ kerfMm: kerf.value, edgeMarginMm: margin.value })
  fieldErrors.value = {}
  if (!settings.success) {
    for (const issue of settings.error.issues) {
      if (issue.path[0] === 'kerfMm') fieldErrors.value.kerfMm = issue.message
      if (issue.path[0] === 'edgeMarginMm') fieldErrors.value.edgeMarginMm = issue.message
    }
    state.value = 'ready'
    return
  }
  state.value = 'running'
  try {
    const inputs = await readInputs()
    if (current !== generation) return
    applyInputs(inputs)
    const choice = inputs.panels.find(panel => panel.product.id === panelId.value)
    if (inputs.parts.length === 0) throw new Error('Add project parts before optimizing.')
    if (choice === undefined) throw new Error('Select an existing panel from this project’s Materials selections.')
    if (choice.problem) throw new Error(choice.problem)
    const outcome = await optimizer.optimize({ panel: choice.product, parts: inputs.parts, settings: settings.data })
    if (current !== generation) return
    if (outcome.status === 'cancelled') state.value = 'cancelled'
    else if (outcome.status === 'failed') {
      error.value = outcome.error.kind === 'invalidPlan' ? 'The cutting plan failed independent validation. No plan is displayed.' : `Optimization failed: ${outcome.error.message}`
      state.value = 'failure'
    } else if (!outcome.selection.ok) {
      error.value = outcome.selection.error.kind === 'noUsableArea' ? 'Margins leave no usable panel area.' : 'No independently valid cutting plan could be generated.'
      state.value = 'failure'
    } else {
      result.value = { selection: outcome.selection, panel: choice.product, parts: inputs.parts, settings: settings.data }
      state.value = 'success'
    }
  } catch (cause) {
    if (current !== generation) return
    error.value = cause instanceof Error ? cause.message : 'Optimization could not start.'
    state.value = 'failure'
  }
}
function cancel(): void { invalidate(); state.value = 'cancelled' }
function partName(id: string): string { return result.value?.parts.find(part => part.id === id)?.name ?? id }
function reasonText(reason: UnplacedReason): string {
  if (reason.kind === 'noSpaceLeft') return 'No space left on this panel'
  if (reason.kind === 'remainderNarrowerThanKerf') return 'Remainder cannot be cut with this kerf'
  return reason.issues.map(issue => ({ materialMismatch: 'Material mismatch', thicknessMismatch: 'Exact thickness mismatch', noUsableArea: 'No usable area', grainRequiresRotation: 'Grain requires forbidden rotation', exceedsUsableArea: 'Exceeds usable panel size' })[issue.kind]).join('; ')
}
onMounted(load)
onBeforeUnmount(() => { generation += 1; optimizer.dispose() })
</script>

<template>
  <section class="space-y-6">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="space-y-2">
        <p class="eyebrow">
          Project cutting tools
        </p>
        <h1 class="text-3xl font-semibold">
          Optimization
        </h1>
        <p class="text-muted">
          Plan cuts for one catalog panel. Remaining parts are reported; inventory is never purchased or consumed.
        </p>
      </div>
      <button
        type="button"
        class="button"
        :disabled="busy"
        @click="load"
      >
        Refresh inputs
      </button>
    </div>
    <p
      v-if="state === 'loading'"
      role="status"
      class="text-muted"
    >
      Loading project inputs…
    </p>
    <div
      v-else-if="inputError"
      class="panel space-y-4 p-6"
    >
      <p
        role="alert"
        class="text-danger"
      >
        {{ inputError }}
      </p>
      <button
        type="button"
        class="button"
        @click="load"
      >
        Retry loading
      </button>
    </div>
    <template v-else>
      <div class="panel space-y-4 p-6">
        <h2 class="text-xl font-semibold">
          Single-panel inputs
        </h2>
        <p>{{ parts.length }} part definitions · {{ totalCopies }} requested copies</p>
        <p
          v-if="!parts.length"
          role="status"
          class="text-muted"
        >
          No parts in this project. <RouterLink
            :to="{ name: 'project-parts', params: { projectId } }"
            class="text-accent underline"
          >
            Add project parts
          </RouterLink>.
        </p>
        <p
          v-if="!panels.length"
          role="status"
          class="text-muted"
        >
          No selected catalog panels. <RouterLink
            :to="{ name: 'project-materials', params: { projectId } }"
            class="text-accent underline"
          >
            Select panels in Materials
          </RouterLink>.
        </p>
        <p
          v-if="missingIds.length"
          role="alert"
          class="text-danger"
        >
          Missing selected products: {{ missingIds.join(', ') }}. Review Materials; selections have not been changed.
        </p>
        <form
          class="space-y-4"
          novalidate
          @submit.prevent="start"
        >
          <FormField
            id="optimization-panel"
            label="Catalog panel"
            required
            hint="Only this project's selected products. Material and thickness must match exactly."
          >
            <template #default="{ controlAttrs }">
              <select
                v-bind="controlAttrs"
                v-model="panelId"
                class="field"
                :disabled="busy"
              >
                <option value="">
                  Select a panel
                </option>
                <option
                  v-for="choice in panels"
                  :key="choice.product.id"
                  :value="choice.product.id"
                  :disabled="Boolean(choice.problem)"
                >
                  {{ choice.label }} · {{ choice.product.lengthMm }} × {{ choice.product.widthMm }} × {{ choice.product.thicknessMm }} mm{{ choice.problem ? ` — ${choice.problem}` : '' }}
                </option>
              </select>
            </template>
          </FormField>
          <p
            v-if="selectedPanel"
            class="text-sm text-muted"
          >
            Panel grain: {{ selectedPanel.product.grainDirection }} · Availability: {{ selectedPanel.product.availability }}. Part grain and rotation restrictions are preserved.
          </p>
          <p
            v-if="panelId && !selectedPanel"
            role="alert"
            class="text-danger"
          >
            The chosen panel is no longer selected or available in the catalog. Choose another panel.
          </p>
          <p
            v-if="incompatibleCopies"
            role="status"
            class="text-muted"
          >
            {{ incompatibleCopies }} copies have a different material or exact thickness and will be reported as unplaced.
          </p>
          <div class="grid gap-4 sm:grid-cols-2">
            <FormField
              id="optimization-kerf"
              label="Saw kerf (mm)"
              :error="fieldErrors.kerfMm ?? ''"
              required
            >
              <template #default="{ controlAttrs }">
                <input
                  v-bind="controlAttrs"
                  v-model.number="kerf"
                  type="number"
                  min="0"
                  step="any"
                  class="field"
                  :disabled="busy"
                >
              </template>
            </FormField>
            <FormField
              id="optimization-margin"
              label="Margin on every edge (mm)"
              :error="fieldErrors.edgeMarginMm ?? ''"
              required
            >
              <template #default="{ controlAttrs }">
                <input
                  v-bind="controlAttrs"
                  v-model.number="margin"
                  type="number"
                  min="0"
                  step="any"
                  class="field"
                  :disabled="busy"
                >
              </template>
            </FormField>
          </div>
          <div class="flex flex-wrap gap-3">
            <button
              type="submit"
              class="button button-primary"
              :disabled="busy || !parts.length || !selectedPanel || Boolean(selectedPanel.problem)"
            >
              Optimize one panel
            </button>
            <button
              v-if="state === 'running'"
              type="button"
              class="button"
              @click="cancel"
            >
              Cancel optimization
            </button>
          </div>
        </form>
      </div>
      <p
        v-if="state === 'running'"
        role="status"
        class="text-muted"
      >
        Optimization running… Comparing existing strategies and validating the cutting plan.
      </p>
      <p
        v-if="state === 'cancelled'"
        role="status"
        class="text-muted"
      >
        Optimization cancelled. No result applied.
      </p>
      <p
        v-if="error"
        role="alert"
        class="text-danger"
      >
        {{ error }}
      </p>
      <section
        v-if="result && displayedPlan"
        class="panel space-y-5 p-6"
        aria-labelledby="optimization-result-title"
      >
        <h2
          id="optimization-result-title"
          class="text-xl font-semibold"
        >
          {{ editedPlan ? 'Validated edited single-panel plan' : 'Validated single-panel plan' }}
        </h2>
        <p role="status">
          {{ displayedPlan.placements.length }} copies placed · {{ unplacedCount }} copies unplaced{{ unplacedCount ? '. Additional panels or different inputs are needed.' : '.' }}
        </p>
        <CuttingPlanViewer
          :plan="result.selection.plan"
          :panel="result.panel"
          :parts="result.parts"
          :settings="result.settings"
          @plan-change="planChanged"
        />
        <dl class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt class="text-sm text-muted">
              {{ editedPlan ? 'Optimizer baseline strategy' : 'Selected strategy' }}
            </dt><dd class="font-semibold">
              {{ result.selection.strategy }}
            </dd>
          </div>
          <div>
            <dt class="text-sm text-muted">
              Panel utilization
            </dt><dd class="font-semibold">
              {{ displayedPlan.metrics.utilizationPercent.toFixed(2) }}%
            </dd>
          </div>
          <div>
            <dt class="text-sm text-muted">
              Waste area (including kerf and margins)
            </dt><dd class="font-semibold">
              {{ displayedPlan.metrics.wasteAreaMm2.toLocaleString() }} mm²
            </dd>
          </div>
          <div>
            <dt class="text-sm text-muted">
              Panel
            </dt><dd class="font-semibold">
              {{ result.panel.name }} · {{ result.panel.lengthMm }} × {{ result.panel.widthMm }} × {{ result.panel.thicknessMm }} mm
            </dd>
          </div>
        </dl>
        <p class="text-sm text-muted">
          Kerf {{ result.settings.kerfMm }} mm · Edge margin {{ result.settings.edgeMarginMm }} mm. Coordinates are measured along the panel length (x) and width (y).
        </p>
        <div
          v-if="displayedPlan.placements.length"
          class="overflow-x-auto"
          tabindex="0"
          role="region"
          aria-label="Placed parts"
        >
          <table class="w-full text-left text-sm">
            <caption class="sr-only">
              Placements on the selected panel
            </caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  class="p-3"
                >
                  Part / copy
                </th><th
                  scope="col"
                  class="p-3"
                >
                  Position x, y (mm)
                </th><th
                  scope="col"
                  class="p-3"
                >
                  Length × width × thickness (mm)
                </th><th
                  scope="col"
                  class="p-3"
                >
                  Orientation
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="placed in displayedPlan.placements"
                :key="`${placed.partId}-${placed.copyIndex}`"
                class="border-t border-line"
              >
                <td class="p-3">
                  {{ partName(placed.partId) }} / {{ placed.copyIndex + 1 }}
                </td><td class="p-3">
                  {{ placed.region.xMm }}, {{ placed.region.yMm }}
                </td><td class="p-3">
                  {{ placed.dimensions.lengthMm }} × {{ placed.dimensions.widthMm }} × {{ placed.dimensions.thicknessMm }}
                </td><td class="p-3">
                  {{ placed.orientation }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div
          v-if="unplacedCount"
          class="space-y-2"
        >
          <h3 class="font-semibold">
            Unplaced parts
          </h3>
          <ul class="space-y-2">
            <li
              v-for="item in displayedPlan.unplaced"
              :key="`${item.partId}-${item.firstCopyIndex}`"
            >
              {{ partName(item.partId) }} · {{ item.count }} copies · {{ reasonText(item.reason) }}
            </li>
          </ul>
        </div>
      </section>
    </template>
  </section>
</template>
