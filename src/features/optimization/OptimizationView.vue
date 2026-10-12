<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { RouterLink, matchedRouteKey, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { copyLabel } from './viewer/copy-label'
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
import CuttingPlansWorkspace from './CuttingPlansWorkspace.vue'
import CatalogFormDialog from '../suppliers/CatalogFormDialog.vue'
import { useCuttingWorkspaceState } from '../projects/cutting-workspace-state'
import type { OptimizeProjectResult } from '../../domain/optimizer/project-plan'
import FormField from '../../shared/ui/FormField.vue'
import PanelPlanView from './PanelPlanView.vue'
import { persistenceErrorMessage } from '../../shared/ui/persistence-error-message'
import { useMaterialRepository } from '../materials/material-repository'
import { useProjectId, useProjectService } from '../projects/project-service'
import { useCatalogRepositories } from '../suppliers/catalog-repositories'
import { useOptimizationService } from './optimization-service'

const { cuttingPlansStep } = defineProps<{ cuttingPlansStep?: boolean }>()
const cuttingState = useCuttingWorkspaceState()
const selectedCopies = ref<Record<number, string>>({})
const projectId = useProjectId()
const projects = useProjectService()
const catalogs = useCatalogRepositories()
const materials = useMaterialRepository()
const stockRepository = useStockRepository()
const optimizer = useOptimizationService()
const currentResults = useCurrentResultService()?.forProject(projectId)
const settingsOpen = ref(false)
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
const panelFitRequest = ref(0)
watch(panelIndex, () => { panelFitRequest.value += 1 })
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
function panelPlan(index: number): PanelCuttingPlan | undefined { return editedPlans.value.get(index) ?? result.value?.selection.plan.panels[index]?.plan }
function selectCopy(index: number, key: string): void { panelIndex.value = index; selectedCopies.value[index] = key }
const cuttingPlansAvailable = computed(() => !!result.value && !planBusy.value && !planError.value && fingerprint.value === savedFingerprint.value)
watch(cuttingPlansAvailable, available => { if (cuttingState) cuttingState.available.value = available }, { flush: 'sync' })
async function leaveWorkspace(to: { name?: unknown }): Promise<boolean> {
  if (to.name === 'project-cutting-plans') {
    if (!result.value) return true
    await persistenceQueue
    if (!cuttingPlansAvailable.value) { planError.value ||= 'The current result is not ready for Cutting Plans. Optimize again or resolve the persistence error.'; return false }
  }
  return canDiscard()
}

function invalidate(markStale = true): void {
  generation += 1
  if (cuttingState) { if (markStale) cuttingState.invalidated.value = true; cuttingState.available.value = false }
  selectedCopies.value = {}
  persistenceController.abort()
  persistenceController = new AbortController()
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
  invalidate(false)
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
    settingsOpen.value = true
    state.value = 'ready'
    return
  }
  settingsOpen.value = false
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
    if (Object.keys(quantityErrors.value).length) { settingsOpen.value = true; state.value = 'ready'; return }
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
  persistenceQueue = persistenceQueue.then(async () => {
    if (signal.aborted) return
    try {
      const saved = await currentResults.replace(input, signal)
      if (current !== generation) return
      if (!saved.ok) { planError.value = persistenceErrorMessage(saved.error, 'Current cutting result'); return }
      if (cuttingState) cuttingState.invalidated.value = false
      savedSummary.value = saved.value.summary
      savedFingerprint.value = currentFingerprint
      planError.value = ''
    } catch (cause) {
      if (current === generation) planError.value = cause instanceof Error ? cause.message : 'Could not persist the current cutting result.'
    }
  })
  const queued = persistenceQueue
  void queued.then(() => { if (queued === persistenceQueue) planBusy.value = false })
}
async function restoreCurrent(current: number): Promise<void> {
  if (!currentResults || cuttingState?.invalidated.value) return
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
  } catch (cause) { if (current === generation) planError.value = cause instanceof Error ? cause.message : 'Could not restore the current cutting result.' }
}
function beforeUnload(event: BeforeUnloadEvent): void { if (unsavedManualChanges.value) event.preventDefault() }
if (inject(matchedRouteKey, undefined) !== undefined) {
  onBeforeRouteLeave(leaveWorkspace)
  onBeforeRouteUpdate(leaveWorkspace)
}
onMounted(() => { window.addEventListener('beforeunload', beforeUnload); void load() })
onBeforeUnmount(() => { window.removeEventListener('beforeunload', beforeUnload); generation += 1; persistenceController.abort(); optimizer.dispose() })
</script>

<template>
  <section class="optimization-workspace space-y-3">
    <header
      v-if="cuttingPlansStep"
      class="flex flex-wrap items-center justify-between gap-3"
    >
      <h1 class="text-xl font-semibold">
        Cutting Plans
      </h1>
      <RouterLink
        v-if="cuttingPlansStep"
        :to="{ name: 'project-optimization', params: { projectId } }"
        class="button button-compact"
      >
        Back to Optimization
      </RouterLink>
    </header>
    <p
      v-if="planError"
      role="alert"
      class="text-sm text-danger"
    >
      {{ planError }}
    </p>
    <p
      v-if="planNotice"
      role="status"
      class="text-sm text-muted"
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
    <template v-if="!cuttingPlansStep">
      <form
        id="optimization-controls"
        novalidate
        class="flex flex-wrap items-center gap-3 border-b border-line pb-3"
        @submit.prevent="start"
      >
        <h1 class="mr-2 text-xl font-semibold">
          Optimization
        </h1>
        <button
          type="submit"
          class="button button-primary"
          :disabled="busy || !!inputError || !parts.length || !panels.length"
        >
          Optimize
        </button>
        <button
          v-if="state === 'running'"
          type="button"
          class="button button-compact"
          @click="cancel"
        >
          Cancel optimization
        </button>
        <output
          v-if="result"
          aria-label="Overall utilization"
          class="text-sm font-semibold tabular-nums text-accent"
        >{{ result.selection.plan.metrics.utilizationPercent.toFixed(2) }}% utilization</output>
        <button
          type="button"
          class="button button-compact ml-auto"
          :disabled="busy"
          @click="settingsOpen = true"
        >
          Cutting settings
        </button>
      </form>
      <CatalogFormDialog
        :open="settingsOpen"
        title="Cutting settings"
        close-label="Close cutting settings"
        :busy="busy"
        @close="settingsOpen = false"
      >
        <div class="space-y-4">
          <p class="text-xs text-muted">
            Catalog quantities are planning limits. Stock quantities reflect owned inventory.
          </p>
          <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div
              v-for="choice in panels"
              :key="choice.product.id"
              class="space-y-2 rounded-lg bg-canvas p-3"
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
                    form="optimization-controls"
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
          <div class="grid max-w-xl gap-3 sm:grid-cols-2">
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
                  form="optimization-controls"
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
                  form="optimization-controls"
                  type="number"
                  min="0"
                  step="any"
                  class="field"
                  :disabled="busy"
                >
              </template>
            </FormField>
          </div>

          <button
            type="submit"
            form="optimization-controls"
            class="button button-primary"
            :disabled="busy || !!inputError || !parts.length || !panels.length"
          >
            Optimize with these settings
          </button>
        </div>
      </CatalogFormDialog>
      <p
        v-if="inputError"
        role="alert"
        class="text-sm text-danger"
      >
        {{ inputError }} <button
          type="button"
          class="button button-compact"
          @click="load"
        >
          Retry loading
        </button>
      </p>
      <p
        v-if="!parts.length && state !== 'loading'"
        role="status"
        class="text-sm text-muted"
      >
        No parts in this project. <RouterLink
          :to="{ name: 'project-parts', params: { projectId } }"
          class="text-accent underline"
        >
          Add project parts
        </RouterLink>.
      </p>
      <p
        v-if="!panels.length && state !== 'loading'"
        role="status"
        class="text-sm text-muted"
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
        class="text-sm text-danger"
      >
        Missing selected products: {{ missingIds.join(', ') }}. Review Materials; selections have not been changed.
      </p>
      <p
        v-if="state === 'running'"
        role="status"
        class="text-sm text-accent"
      >
        Optimization running…
      </p>
      <p
        v-if="state === 'cancelled'"
        role="status"
        class="text-sm text-muted"
      >
        Optimization cancelled. No result applied.
      </p>
      <p
        v-if="error"
        role="alert"
        class="text-sm text-danger"
      >
        {{ error }}
      </p>
      <p
        v-if="result?.selection.plan.unplaced.length"
        role="status"
        class="text-sm text-danger"
      >
        Incomplete cutting result — some parts remain unplaced. Review them in Cutting Plans.
      </p>
    </template>
    <div
      v-show="!cuttingPlansStep"
      class="cutting-workspace-grid items-start gap-3"
    >
      <aside
        class="min-w-0 space-y-2 py-2 lg:max-h-[70dvh] lg:overflow-y-auto"
        aria-label="Panels used"
      >
        <h2 class="text-sm font-semibold">
          Panels used ({{ result?.selection.plan.panels.length ?? 0 }})
        </h2>
        <ul
          v-if="result?.selection.plan.panels.length"
          class="space-y-3"
        >
          <li
            v-for="(allocation, index) in result.selection.plan.panels"
            :key="index"
          >
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-lg p-2 text-left text-sm"
              :class="panelIndex === index ? 'bg-subtle text-accent' : 'hover:bg-subtle'"
              :data-panel-index="index"
              :aria-pressed="panelIndex === index"
              :aria-expanded="panelIndex === index"
              :aria-controls="`panel-parts-${index}`"
              @click="panelIndex = index"
            >
              <span class="min-w-0 flex-1"><span
                class="block font-semibold"
              >Panel {{ index + 1 }}</span><span class="block text-xs text-muted">{{ result.choices.find(choice => choice.product.id === allocation.supplierProductId)?.product.lengthMm }} × {{ result.choices.find(choice => choice.product.id === allocation.supplierProductId)?.product.widthMm }} × {{ result.choices.find(choice => choice.product.id === allocation.supplierProductId)?.product.thicknessMm }} mm</span></span>
              <span class="text-xs tabular-nums text-muted">{{ allocation.plan.metrics.utilizationPercent.toFixed(1) }}%</span>
            </button>
            <ul
              v-show="panelIndex === index"
              :id="`panel-parts-${index}`"
              class="ml-2 border-l border-line pl-2"
              :aria-label="`Parts on panel ${index + 1}`"
            >
              <li
                v-for="placed in panelPlan(index)?.placements ?? []"
                :key="JSON.stringify([placed.partId, placed.copyIndex])"
              >
                <button
                  type="button"
                  class="my-0.5 flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-subtle"
                  :class="panelIndex === index && selectedCopies[index] === JSON.stringify([placed.partId, placed.copyIndex]) ? 'bg-success-surface text-accent' : ''"
                  :data-copy-key="JSON.stringify([placed.partId, placed.copyIndex])"
                  :aria-pressed="panelIndex === index && selectedCopies[index] === JSON.stringify([placed.partId, placed.copyIndex])"
                  @click="selectCopy(index, JSON.stringify([placed.partId, placed.copyIndex]))"
                >
                  <span class="block font-medium">{{ copyLabel(result.parts.find(part => part.id === placed.partId) ?? { name: partName(placed.partId), quantity: 1 }, placed.copyIndex) }}</span>
                  <span class="text-muted">× 1</span>
                </button>
              </li>
            </ul>
          </li>
        </ul>
        <p
          v-else
          class="text-xs text-muted"
        >
          No panels allocated yet.
        </p>
      </aside>
      <div class="min-w-0">
        <KeepAlive
          v-if="result"
          :key="result.requestId"
        >
          <PanelPlanView
            v-if="!cuttingPlansStep && activePanel && activeChoice"
            :key="panelIndex"
            :allocation="activePanel"
            :panel="activeChoice.product"
            :panel-label="`Panel ${panelIndex + 1}`"
            :fit-request="panelFitRequest"
            :parts="result.parts"
            :settings="result.settings"
            :material-name="activeChoice.materialName"
            :saved-edited="result.savedEdited.includes(panelIndex)"
            :saved-baseline="result.savedBaseline"
            :confirm-reset="canDiscard"
            :selected-copy-key="selectedCopies[panelIndex] ?? ''"
            @select-copy="selectedCopies[panelIndex] = $event"
            @plan-change="(plan, modified) => planChanged(panelIndex, plan, modified)"
          />
        </KeepAlive>
        <div
          v-if="!result"
          class="panel flex min-h-80 items-center justify-center p-6 text-center"
          aria-label="Empty cutting workspace"
        >
          <div class="max-w-sm space-y-2">
            <h2 class="font-semibold">
              Your cutting layout will appear here
            </h2><p class="text-sm text-muted">
              Select panels in Materials, add Parts, then Optimize.
            </p>
          </div>
        </div>
      </div>
    </div>
    <CuttingPlansWorkspace
      v-if="cuttingPlansStep && displayedInput && cuttingPlansAvailable"
      :input="displayedInput"
      title="Project cutting result"
    />
    <div
      v-else-if="cuttingPlansStep && state !== 'loading'"
      class="panel space-y-3 p-6"
      role="status"
    >
      <h2 class="font-semibold">
        No current cutting document available
      </h2>
      <p class="text-sm text-muted">
        Create a valid, automatically persisted cutting result in Optimization before exporting.
      </p>
      <RouterLink
        :to="{ name: 'project-optimization', params: { projectId } }"
        class="button button-primary"
      >
        Go to Optimization
      </RouterLink>
    </div>
  </section>
</template>
<style scoped>
.optimization-workspace :deep(.field) { min-height: 2.25rem; padding-block: 0.375rem; font-size: 0.875rem; }
.cutting-workspace-grid { display: grid; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 1024px) {
  .cutting-workspace-grid { grid-template-columns: 200px minmax(0, 1fr); }
}
</style>
