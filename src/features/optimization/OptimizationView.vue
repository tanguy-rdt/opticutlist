<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { RouterLink, matchedRouteKey, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { stockPanel } from '../../domain/optimizer/panel-source'
import { useStockRepository } from '../inventory/stock-repository'
import { isCompatible } from '../../domain/compatibility'
import { panelQuantitySchema } from '../../domain/model/cutting-project'
import { cuttingSettingsSchema, type CuttingSettings } from '../../domain/model/cutting-settings'
import type { Part } from '../../domain/model/part'
import type { PanelSnapshot, SavedPlanSummary } from '../../domain/model/saved-cutting-plan'
import { panelSnapshotSchema } from '../../domain/model/saved-cutting-plan'
import type { SavePlanInput } from '../../application/plans/saved-plan-service'
import type { PanelCuttingPlan } from '../../domain/optimizer/plan-with-strategy'
import { useCurrentResultService } from './current-result-service'
import { useCuttingConfirmationService } from '../inventory/cutting-confirmation-service'
import CuttingFinalization from './CuttingFinalization.vue'
import type { OptimizeProjectResult } from '../../domain/optimizer/project-plan'
import FormField from '../../shared/ui/FormField.vue'
import PanelPlanView from './PanelPlanView.vue'
import { persistenceErrorMessage } from '../../shared/ui/persistence-error-message'
import { useMaterialRepository } from '../materials/material-repository'
import { useProjectId, useProjectService } from '../projects/project-service'
import { useCatalogRepositories } from '../suppliers/catalog-repositories'
import { useOptimizationService } from './optimization-service'

const projectId = useProjectId()
const projects = useProjectService()
const catalogs = useCatalogRepositories()
const materials = useMaterialRepository()
const stockRepository = useStockRepository()
const optimizer = useOptimizationService()
const currentResults = useCurrentResultService()?.forProject(projectId)
const cutting = useCuttingConfirmationService()?.forProject(projectId)
const confirmationOpen = ref(false)
const confirmed = ref(false)
const planBusy = ref(false)
const planError = ref('')
const planNotice = ref('')
const savedSummary = shallowRef<SavedPlanSummary | null>(null)
const savedFingerprint = ref<string | null>(null)
const editedPlans = shallowRef<ReadonlyMap<number, PanelCuttingPlan>>(new Map())
type State = 'loading' | 'ready' | 'running' | 'success' | 'failure' | 'cancelled'
interface PanelChoice { stockQuantity?: number; product: PanelSnapshot; materialName: string; label: string; problem: string; broken: boolean; supplierName: string; availability: 'available' | 'unavailable' | 'unknown' }
interface RunResult {
  requestId: number
  selection: Extract<OptimizeProjectResult, { ok: true }>
  choices: readonly PanelChoice[]
  parts: readonly Part[]
  settings: CuttingSettings
  sources: SavePlanInput['sources']
  savedEdited: readonly number[]
  savedBaseline: boolean
}
const state = ref<State>('loading')
const parts = shallowRef<readonly Part[]>([])
const panels = shallowRef<readonly PanelChoice[]>([])
const missingIds = shallowRef<readonly string[]>([])
const quantities = ref<Record<string, number | string>>({})
const quantityErrors = ref<Record<string, string>>({})
const kerf = ref<number | string>(3)
const margin = ref<number | string>(0)
const error = ref('')
const inputError = ref('')
const fieldErrors = ref<{ kerfMm?: string; edgeMarginMm?: string }>({})
const result = shallowRef<RunResult | null>(null)
const panelIndex = ref(0)
const activePanel = computed(() => result.value?.selection.plan.panels[panelIndex.value])
const activeChoice = computed(() => result.value?.choices.find(choice => choice.product.id === activePanel.value?.supplierProductId))
let generation = 0
let persistenceController = new AbortController()
let persistenceQueue: Promise<void> = Promise.resolve()
const busy = computed(() => planBusy.value || state.value === 'running' || state.value === 'loading')
const fingerprint = computed(() => result.value === null ? '' : JSON.stringify(result.value.selection.plan.panels.map((panel, index) => (editedPlans.value.get(index) ?? panel.plan).tree)))
const displayedInput = computed<SavePlanInput | null>(() => result.value === null ? null : {
  plan: { ...result.value.selection.plan, panels: result.value.selection.plan.panels.map((panel, index) => ({ ...panel, plan: editedPlans.value.get(index) ?? panel.plan })) },
  parts: [...result.value.parts], settings: result.value.settings, sources: result.value.sources,
  editedPanelIndices: result.value.selection.plan.panels.flatMap((_, index) => editedPlans.value.has(index) || result.value?.savedEdited.includes(index) ? [index] : []),
})
const inventoryProblem = computed(() => !cutting ? 'The inventory service is unavailable.' : planError.value ? planError.value : planBusy.value || fingerprint.value !== savedFingerprint.value || !savedSummary.value ? 'The current layouts have not finished automatic persistence.' : '')
const unsavedManualChanges = computed(() => result.value !== null && (savedFingerprint.value === null ? editedPlans.value.size > 0 : fingerprint.value !== savedFingerprint.value))
function canDiscard(): boolean { return !unsavedManualChanges.value || window.confirm('Discard unsaved manual cutting-plan changes? Automatic persistence has not completed.') }
function planChanged(index: number, plan: PanelCuttingPlan, modified: boolean): void {
  const previous = fingerprint.value
  const next = new Map(editedPlans.value)
  if (modified) next.set(index, plan)
  else next.delete(index)
  editedPlans.value = next
  if (fingerprint.value !== previous) persistCurrent()
}
const totalCopies = computed(() => parts.value.reduce((sum, part) => sum + part.quantity, 0))

function invalidate(): void {
  generation += 1
  persistenceController.abort()
  persistenceController = new AbortController()
  confirmationOpen.value = false
  confirmed.value = false
  optimizer.cancel()
  result.value = null
  editedPlans.value = new Map()
  savedSummary.value = null
  savedFingerprint.value = null
  planError.value = ''; planNotice.value = ''
  error.value = ''
}
function inputChanged(): void {
  if (state.value === 'loading') return
  invalidate()
  fieldErrors.value = {}
  quantityErrors.value = {}
  state.value = 'ready'
}
let restoringDraft = false
let previousQuantities: Record<string, number | string> = {}
watch([kerf, margin], (_next, previous) => {
  if (restoringDraft) return
  if (!canDiscard()) { restoringDraft = true; [kerf.value, margin.value] = previous; restoringDraft = false; return }
  inputChanged()
}, { flush: 'sync' })
watch(quantities, () => {
  if (restoringDraft) return
  if (!canDiscard()) { restoringDraft = true; quantities.value = { ...previousQuantities }; restoringDraft = false; return }
  previousQuantities = { ...quantities.value }
  inputChanged()
}, { deep: true, flush: 'sync' })

async function readInputs() {
  const [project, scopedParts, products, supplierRecords, materialRecords, stockRecords] = await Promise.all([
    projects.projects.get(projectId), projects.parts(projectId).list(),
    catalogs.supplierProducts.list(), catalogs.suppliers.list(), materials.list(), stockRepository?.list() ?? Promise.resolve({ ok: true as const, value: [] }),
  ])
  if (!project.ok) throw new Error(persistenceErrorMessage(project.error, 'Project'))
  if (!scopedParts.ok) throw new Error(persistenceErrorMessage(scopedParts.error, 'Part'))
  if (!products.ok) throw new Error(persistenceErrorMessage(products.error, 'Product'))
  if (!supplierRecords.ok) throw new Error(persistenceErrorMessage(supplierRecords.error, 'Supplier'))
  if (!materialRecords.ok) throw new Error(persistenceErrorMessage(materialRecords.error, 'Material'))
  if (!stockRecords.ok) throw new Error(persistenceErrorMessage(stockRecords.error, 'Stock item'))
  const selected = new Set(project.value.supplierProductIds)
  const choices: PanelChoice[] = products.value.filter(product => selected.has(product.id)).map(product => {
    const supplier = supplierRecords.value.find(record => record.id === product.supplierId)
    const material = materialRecords.value.find(record => record.id === product.materialId)
    const broken = supplier === undefined || material === undefined
    const problem = broken ? 'Missing catalog reference'
      : product.availability === 'unavailable' ? 'Unavailable'
        : !scopedParts.value.some(part => isCompatible(part, product)) ? 'No matching material and exact thickness' : ''
    return { product, materialName: material?.name ?? product.materialId, label: `${supplier?.name ?? 'Missing supplier'} / ${material?.name ?? 'Missing material'} / ${product.name}`, problem, broken, supplierName: supplier?.name ?? 'Missing supplier', availability: product.availability }
  })
  for (const item of stockRecords.value.filter(item => project.value.stockItemIds?.includes(item.id))) {
    const product = stockPanel(item)
    if (products.value.some(catalogProduct => catalogProduct.id === product.id)) throw new Error('A catalog ID conflicts with a stock allocation key. No optimization was started.')
    const material = materialRecords.value.find(record => record.id === item.materialId)
    choices.push({ product, stockQuantity: item.quantity, materialName: material?.name ?? item.materialId, label: `Stock / ${material?.name ?? 'Missing material'} / ${product.name}`, problem: !material ? 'Missing stock material' : !scopedParts.value.some(part => isCompatible(part, product)) ? 'No matching material and exact thickness' : '', broken: !material, supplierName: 'Owned stock', availability: 'available' })
  }
  return {
    catalogProducts: products.value, project: project.value, parts: scopedParts.value, panels: choices,
    missingIds: [...project.value.supplierProductIds.filter(id => !products.value.some(product => product.id === id)), ...(project.value.stockItemIds ?? []).filter(id => !stockRecords.value.some(item => item.id === id)).map(id => `Stock ${id}`)],
  }
}
function applyInputs(inputs: Awaited<ReturnType<typeof readInputs>>): void {
  parts.value = inputs.parts
  panels.value = inputs.panels
  missingIds.value = inputs.missingIds
}
async function load(): Promise<void> {
  if (!canDiscard()) return
  invalidate()
  const current = generation
  state.value = 'loading'
  inputError.value = ''
  quantityErrors.value = {}
  try {
    const inputs = await readInputs()
    if (current !== generation) return
    applyInputs(inputs)
    quantities.value = Object.fromEntries(inputs.panels.map(choice => [choice.product.id, choice.stockQuantity ?? inputs.project.panelQuantities?.find(item => item.supplierProductId === choice.product.id)?.quantity ?? 1]))
    state.value = 'ready'
  } catch (cause) {
    if (current !== generation) return
    inputError.value = cause instanceof Error ? cause.message : 'Could not load optimization inputs.'
    state.value = 'failure'
  }
  if (current === generation) await restoreCurrent(current)
}
async function start(): Promise<void> {
  if (busy.value || inputError.value || !canDiscard()) return
  invalidate()
  const current = generation
  const settings = cuttingSettingsSchema.safeParse({ kerfMm: kerf.value, edgeMarginMm: margin.value })
  fieldErrors.value = {}
  quantityErrors.value = {}
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
    if (inputs.parts.length === 0) throw new Error('Add project parts before optimizing.')
    if (inputs.panels.length === 0) throw new Error('Select catalog or stock panels in this project’s Materials section.')
    const available = inputs.panels.map(choice => {
      const parsed = panelQuantitySchema.safeParse(choice.stockQuantity ?? quantities.value[choice.product.id] ?? inputs.project.panelQuantities?.find(item => item.supplierProductId === choice.product.id)?.quantity ?? 1)
      if (!parsed.success) quantityErrors.value[choice.product.id] = parsed.error.issues[0]?.message ?? 'Enter a non-negative safe integer.'
      const product = choice.product.stockItemId === undefined ? inputs.catalogProducts.find(product => product.id === choice.product.id) : { ...choice.product, stockItemId: choice.product.stockItemId, availability: 'available' as const }
      if (!product) throw new Error('Missing panel source')
      return { product, quantity: parsed.success ? parsed.data : 0 }
    })
    if (Object.keys(quantityErrors.value).length) { state.value = 'ready'; return }
    const catalogAvailable = available.filter(source => !('stockItemId' in source.product))
    const changed = catalogAvailable.some(source => source.quantity !== (inputs.project.panelQuantities?.find(item => item.supplierProductId === source.product.id)?.quantity ?? 1))
    if (changed) {
      const saved = await projects.projects.update(projectId, { ...inputs.project, panelQuantities: [
        ...catalogAvailable.map(source => ({ supplierProductId: source.product.id, quantity: source.quantity })),
        ...(inputs.project.panelQuantities?.filter(item => inputs.missingIds.includes(item.supplierProductId)) ?? []),
      ] })
      if (current !== generation) return
      if (!saved.ok) throw new Error(persistenceErrorMessage(saved.error, 'Project'))
    }
    const outcome = await optimizer.optimizeProject({ panels: available.filter(source => !inputs.panels.find(choice => choice.product.id === source.product.id)?.broken), parts: inputs.parts, settings: settings.data })
    if (current !== generation) return
    if (outcome.status === 'cancelled') state.value = 'cancelled'
    else if (outcome.status === 'failed') {
      error.value = outcome.error.kind === 'invalidPlan' ? 'The cutting plan failed independent validation. No plan is displayed.' : `Optimization failed: ${outcome.error.message}`
      state.value = 'failure'
    } else if (!outcome.selection.ok) {
      error.value = outcome.selection.error.message
      state.value = 'failure'
    } else {
      panelIndex.value = 0
      result.value = { requestId: outcome.requestId, selection: outcome.selection, choices: inputs.panels, parts: inputs.parts, settings: settings.data, sources: available.filter(source => outcome.selection.ok && outcome.selection.plan.panels.some(panel => panel.supplierProductId === source.product.id)).map(source => {
        const choice = inputs.panels.find(choice => choice.product.id === source.product.id)
        const { id, name, materialId, lengthMm, widthMm, thicknessMm, grainDirection } = source.product
        return { product: panelSnapshotSchema.parse({ id, name, materialId, lengthMm, widthMm, thicknessMm, grainDirection, ...('stockItemId' in source.product ? { stockItemId: source.product.stockItemId } : {}) }), quantity: source.quantity, materialName: choice?.materialName ?? materialId, supplierName: choice?.supplierName ?? 'Missing supplier' }
      }), savedEdited: [], savedBaseline: false }
      state.value = 'success'
      persistCurrent()
    }
  } catch (cause) {
    if (current !== generation) return
    error.value = cause instanceof Error ? cause.message : 'Optimization could not start.'
    state.value = 'failure'
  }
}
function cancel(): void { invalidate(); state.value = 'cancelled' }
function partName(id: string): string { return result.value?.parts.find(part => part.id === id)?.name ?? id }
const reasons = { noCompatiblePanel: 'No selected panel matches the material and exact thickness', constraintsPreventPlacement: 'Dimensions, grain, rotation, kerf or margins prevent placement', panelLimitReached: 'Available panel quantity or remaining usable space is insufficient' }
function persistCurrent(): void {
  const currentResult = result.value
  if (!currentResults || !currentResult) return
  const current = generation
  const currentFingerprint = fingerprint.value
  const signal = persistenceController.signal
  const input = structuredClone(displayedInput.value)
  if (!input) return
  // Serialize accepted edits, including undo/reset and edits on inactive layouts.
  planBusy.value = true
  confirmationOpen.value = false
  confirmed.value = false
  persistenceQueue = persistenceQueue.then(async () => {
    if (signal.aborted) return
    try {
      const saved = await currentResults.replace(input, signal)
      if (current !== generation) return
      if (!saved.ok) { planError.value = persistenceErrorMessage(saved.error, 'Current cutting result'); return }
      savedSummary.value = saved.value.summary
      savedFingerprint.value = currentFingerprint
      confirmed.value = false
      planError.value = ''
    } catch (cause) {
      if (current === generation) planError.value = cause instanceof Error ? cause.message : 'Could not persist the current cutting result.'
    }
  })
  const queued = persistenceQueue
  void queued.then(() => { if (queued === persistenceQueue) planBusy.value = false })
}
async function refreshConfirmation(): Promise<void> {
  if (!cutting || !savedSummary.value) return
  const current = generation
  const receipts = await cutting.list()
  if (current !== generation) return
  if (!receipts.ok) { planError.value = persistenceErrorMessage(receipts.error, 'Cutting confirmation'); return }
  confirmed.value = receipts.value.some(receipt => receipt.id === savedSummary.value?.id)
}
async function restoreCurrent(current: number): Promise<void> {
  if (!currentResults) return
  try {
    const opened = await currentResults.load()
    if (current !== generation) return
    if (!opened.ok) { planError.value = persistenceErrorMessage(opened.error, 'Current cutting result'); return }
    if (opened.value.ambiguousLegacyCount) {
      planNotice.value = `${String(opened.value.ambiguousLegacyCount)} legacy saved plans were preserved. No current result was chosen because the selection is ambiguous. A new optimization will establish the current result without deleting legacy data.`
    }
    if (!opened.value.result) return
    const { contents, plan, summary } = opened.value.result
    editedPlans.value = new Map()
    panelIndex.value = 0
    restoringDraft = true
    kerf.value = contents.settings.kerfMm; margin.value = contents.settings.edgeMarginMm
    restoringDraft = false
    result.value = { requestId: -current, selection: { ok: true, plan }, sources: contents.sources, parts: contents.parts, settings: contents.settings, savedBaseline: true, savedEdited: contents.panels.flatMap((panel, index) => panel.edited ? [index] : []), choices: contents.sources.map(source => ({ product: source.product, materialName: source.materialName, supplierName: source.supplierName, label: `${source.supplierName} / ${source.materialName} / ${source.product.name}`, problem: '', broken: false, availability: 'unknown' })) }
    savedSummary.value = summary
    savedFingerprint.value = fingerprint.value
    state.value = 'success'
    await refreshConfirmation()
  } catch (cause) { if (current === generation) planError.value = cause instanceof Error ? cause.message : 'Could not restore the current cutting result.' }
}
function beforeUnload(event: BeforeUnloadEvent): void { if (unsavedManualChanges.value) event.preventDefault() }
if (inject(matchedRouteKey, undefined) !== undefined) {
  onBeforeRouteLeave(canDiscard)
  onBeforeRouteUpdate(canDiscard)
}
onMounted(() => { window.addEventListener('beforeunload', beforeUnload); void load() })
onBeforeUnmount(() => { window.removeEventListener('beforeunload', beforeUnload); generation += 1; persistenceController.abort(); optimizer.dispose() })
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
          Automatically allocate compatible panels for all project parts. Inventory is never purchased or consumed.
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
      v-if="planError"
      role="alert"
      class="text-danger"
    >
      {{ planError }}
    </p>
    <p
      v-if="planNotice"
      role="status"
      class="text-muted"
    >
      {{ planNotice }}
    </p>
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
          Project inputs
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
          No selected panels. <RouterLink
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
          <p class="text-sm text-muted">
            Available quantities are saved for this project when you optimize. Existing selections default to one panel each; zero excludes a reference from this run. Catalog quantities are planning limits; stock quantities come from owned inventory and are not consumed by optimization.
          </p>
          <div class="grid gap-4 lg:grid-cols-2">
            <div
              v-for="choice in panels"
              :key="choice.product.id"
              class="space-y-2 rounded-lg border border-line p-4"
            >
              <p class="font-semibold">
                {{ choice.label }}
              </p>
              <p class="text-sm text-muted">
                {{ choice.product.lengthMm }} × {{ choice.product.widthMm }} × {{ choice.product.thicknessMm }} mm · Grain: {{ choice.product.grainDirection }} · {{ choice.availability }}
              </p>
              <p
                v-if="choice.problem"
                class="text-sm text-muted"
              >
                {{ choice.problem }}
              </p>
              <FormField
                :id="`panel-quantity-${choice.product.id}`"
                :label="`Available quantity: ${choice.product.name}`"
                :error="quantityErrors[choice.product.id] ?? ''"
                required
              >
                <template #default="{ controlAttrs }">
                  <input
                    v-bind="controlAttrs"
                    v-model.number="quantities[choice.product.id]"
                    :data-panel-id="choice.product.id"
                    type="number"
                    min="0"
                    step="1"
                    class="field"
                    :disabled="busy || choice.stockQuantity !== undefined || choice.broken || choice.availability === 'unavailable'"
                  >
                </template>
              </FormField>
            </div>
          </div>
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
              :disabled="busy || !parts.length || !panels.length"
            >
              Optimize
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
        Optimization running… Comparing panel allocations and independently validating every cutting plan.
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
    </template>
    <section
      v-if="result"
      class="panel space-y-4 p-6"
      aria-labelledby="project-result-title"
    >
      <h2
        id="project-result-title"
        class="text-xl font-semibold"
      >
        Validated project cutting plan
      </h2>
      <p
        v-if="confirmed"
        class="text-success"
        role="status"
      >
        Cutting confirmed · Inventory movements recorded
      </p>
      <p role="status">
        {{ result.selection.plan.metrics.placedCount }} copies placed · {{ result.selection.plan.metrics.unplacedCount }} copies unplaced{{ result.selection.plan.metrics.unplacedCount ? '. Additional panels or different inputs are needed.' : '.' }}
      </p>
      <dl class="grid gap-4 sm:grid-cols-3">
        <div>
          <dt class="text-sm text-muted">
            Panels used
          </dt><dd class="font-semibold">
            {{ result.selection.plan.panels.length }}
          </dd>
        </div>
        <div>
          <dt class="text-sm text-muted">
            Overall utilization
          </dt><dd class="font-semibold">
            {{ result.selection.plan.metrics.utilizationPercent.toFixed(2) }}%
          </dd>
        </div>
        <div>
          <dt class="text-sm text-muted">
            Total waste area (including kerf and margins)
          </dt><dd class="font-semibold">
            {{ result.selection.plan.metrics.wasteAreaMm2.toLocaleString() }} mm²
          </dd>
        </div>
      </dl>
      <div
        v-if="result.selection.plan.unplaced.length"
        class="space-y-2"
      >
        <h3 class="font-semibold">
          Unplaced parts
        </h3>
        <ul class="space-y-2">
          <li
            v-for="item in result.selection.plan.unplaced"
            :key="`${item.partId}-${item.firstCopyIndex}`"
          >
            {{ partName(item.partId) }} · {{ item.count }} copies · {{ reasons[item.reason] }}
          </li>
        </ul>
      </div>
      <FormField
        v-if="result.selection.plan.panels.length"
        id="optimization-layout"
        label="Panel layout"
      >
        <template #default="{ controlAttrs }">
          <select
            v-bind="controlAttrs"
            v-model.number="panelIndex"
            class="field"
          >
            <option
              v-for="(allocation, index) in result.selection.plan.panels"
              :key="index"
              :value="index"
            >
              Panel {{ index + 1 }} · {{ result.choices.find(choice => choice.product.id === allocation.supplierProductId)?.label }} · Reference copy {{ allocation.panelCopyIndex + 1 }}
            </option>
          </select>
        </template>
      </FormField>
      <p
        v-else
        class="text-muted"
      >
        No panels allocated: none can place a requested copy within the available quantities and constraints.
      </p>
    </section>
    <KeepAlive
      v-if="result && activePanel && activeChoice"
      :key="result.requestId"
    >
      <PanelPlanView
        :key="panelIndex"
        :allocation="activePanel"
        :panel="activeChoice.product"
        :parts="result.parts"
        :settings="result.settings"
        :material-name="activeChoice.materialName"
        :saved-edited="result.savedEdited.includes(panelIndex)"
        :saved-baseline="result.savedBaseline"
        :confirm-reset="canDiscard"
        @plan-change="(plan, modified) => planChanged(panelIndex, plan, modified)"
      />
    </KeepAlive>
    <div
      v-if="result"
      class="flex justify-end border-t border-line pt-6"
    >
      <button
        type="button"
        class="button button-primary"
        data-finalization-action
        @click="confirmationOpen = true"
      >
        Finalize cutting
      </button>
    </div>
    <CuttingFinalization
      v-if="confirmationOpen && displayedInput"
      :key="savedSummary?.id ?? result?.requestId ?? 0"
      :input="displayedInput"
      :summary="savedSummary"
      :cutting="cutting"
      :inventory-problem="inventoryProblem"
      @close="confirmationOpen = false"
      @confirmed="refreshConfirmation"
    />
  </section>
</template>
