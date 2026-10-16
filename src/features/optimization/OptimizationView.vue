<script setup lang="ts">
import { computed, inject, onActivated, onDeactivated, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { RouterLink, matchedRouteKey, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { copyLabel } from './viewer/copy-label'
import { stockPanel } from '../../domain/optimizer/panel-source'
import { useStockRepository } from '../inventory/stock-repository'
import { isCompatible } from '../../domain/compatibility'
import { catalogPanelSupply } from '../../application/optimization/catalog-panel-supply'
import { useToastStore } from '../../shared/ui/toast-store'
import { cuttingSettingsSchema, type CuttingSettings } from '../../domain/model/cutting-settings'
import type { Part } from '../../domain/model/part'
import type { PanelSnapshot, SavedPlanSummary } from '../../domain/model/saved-cutting-plan'
import { panelSnapshotSchema } from '../../domain/model/saved-cutting-plan'
import type { SavePlanInput } from '../../application/plans/saved-plan-service'
import type { PanelCuttingPlan } from '../../domain/optimizer/plan-with-strategy'
import { useCurrentResultService } from './current-result-service'
import CuttingPlansWorkspace from './CuttingPlansWorkspace.vue'
import AppDialog from '../../shared/ui/AppDialog.vue'
import AppButton from '../../shared/ui/AppButton.vue'
import AppCheckbox from '../../shared/ui/AppCheckbox.vue'
import AppIcon from '../../shared/ui/AppIcon.vue'
import PanelDimensionPreview from '../../shared/ui/PanelDimensionPreview.vue'
import { useCuttingWorkspaceState } from '../projects/cutting-workspace-state'
import type { ProjectUnplacedParts, OptimizeProjectResult } from '../../domain/optimizer/project-plan'
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
const projectName = ref('')
const projects = useProjectService()
const catalogs = useCatalogRepositories()
const materials = useMaterialRepository()
const stockRepository = useStockRepository()
const optimizer = useOptimizationService()
const currentResults = useCurrentResultService()?.forProject(projectId)
const settingsOpen = ref(false)
const settingsSaving = ref(false)
const settingsError = ref('')
const toasts = useToastStore()
const savedSettings = shallowRef<CuttingSettings>({ kerfMm: 3, edgeMarginMm: 0 })
const planBusy = ref(false)
const planError = ref('')
const planNotice = ref('')
const savedSummary = shallowRef<SavedPlanSummary | null>(null)
const savedFingerprint = ref<string | null>(null)
const editedPlans = shallowRef<ReadonlyMap<number, PanelCuttingPlan>>(new Map())
type State = 'loading' | 'ready' | 'running' | 'success' | 'failure' | 'cancelled'
interface PanelChoice { stockQuantity?: number; product: PanelSnapshot; materialName: string; problem: string; broken: boolean; supplierName: string; }
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
const kerf = ref<number | string>(3)
const margin = ref<number | string>(0)
const preferStockPanels = ref(true)
const error = ref('')
const inputError = ref('')
const fieldErrors = ref<{ kerfMm?: string; edgeMarginMm?: string }>({})
const result = shallowRef<RunResult | null>(null)
const inspectedUnplaced = shallowRef<ProjectUnplacedParts | null>(null)
const inspectedPart = computed(() => result.value?.parts.find(part => part.id === inspectedUnplaced.value?.partId))
const unplacedCount = computed(() => result.value?.selection.plan.unplaced.reduce((count, item) => count + item.count, 0) ?? 0)
const unplacedReasons = {
  noCompatiblePanel: 'No compatible selected panel.',
  constraintsPreventPlacement: 'Panel constraints prevent placement.',
  panelLimitReached: 'Available panel supply is insufficient. Review selected sources in Materials.',
} as const
watch(result, () => { inspectedUnplaced.value = null })
const panelIndex = ref(0)
const panelFitRequest = ref(0)
watch(panelIndex, () => { panelFitRequest.value += 1 })
const activePanel = computed(() => result.value?.selection.plan.panels[panelIndex.value])
const activeChoice = computed(() => result.value?.choices.find(choice => choice.product.id === activePanel.value?.supplierProductId))
let generation = 0
let persistenceController = new AbortController()
let persistenceQueue: Promise<void> = Promise.resolve()
const busy = computed(() => settingsSaving.value || planBusy.value || state.value === 'running' || state.value === 'loading')
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
let discardedOnLeave = false
async function leaveWorkspace(to: { name?: unknown }): Promise<boolean> {
  if (to.name === 'project-cutting-plans') {
    if (!result.value) return true
    await persistenceQueue
    if (!cuttingPlansAvailable.value) { planError.value ||= 'The current result is not ready for Cutting Plans. Optimize again or resolve the persistence error.'; return false }
  }
  const allowed = canDiscard()
  if (allowed && unsavedManualChanges.value) {
    persistenceController.abort()
    generation += 1
    discardedOnLeave = true
  }
  return allowed
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
function openSettings(): void {
  kerf.value = savedSettings.value.kerfMm; margin.value = savedSettings.value.edgeMarginMm; preferStockPanels.value = savedSettings.value.preferStockPanels ?? true
  fieldErrors.value = {}; settingsError.value = ''; settingsOpen.value = true
}
async function saveSettings(): Promise<void> {
  if (busy.value) return
  const parsed = cuttingSettingsSchema.safeParse({ kerfMm: kerf.value, edgeMarginMm: margin.value, preferStockPanels: preferStockPanels.value })
  fieldErrors.value = {}; settingsError.value = ''
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      if (issue.path[0] === 'kerfMm') fieldErrors.value.kerfMm = issue.message
      if (issue.path[0] === 'edgeMarginMm') fieldErrors.value.edgeMarginMm = issue.message
    }
    return
  }
  if (!canDiscard()) return
  const current = generation
  settingsSaving.value = true
  try {
    const project = await projects.projects.get(projectId)
    const saved = project.ok ? await projects.projects.update(projectId, { ...project.value, cuttingSettings: parsed.data }) : project
    if (current !== generation) return
    if (!saved.ok) { settingsError.value = persistenceErrorMessage(saved.error, 'Project'); return }
    const changed = JSON.stringify({ ...savedSettings.value, preferStockPanels: savedSettings.value.preferStockPanels ?? true }) !== JSON.stringify(parsed.data)
    savedSettings.value = parsed.data
    if (changed) { invalidate(); state.value = 'ready' }
    settingsOpen.value = false
    toasts.success('Cutting settings saved')
  } catch { if (current === generation) settingsError.value = 'Could not save cutting settings. Try again.' }
  finally { settingsSaving.value = false }
}

async function readInputs() {
  const [project, scopedParts, products, supplierRecords, materialRecords, stockRecords] = await Promise.all([
    projects.projects.get(projectId), projects.parts(projectId).list(),
    catalogs.supplierProducts.list(), catalogs.suppliers.list(), materials.list(), stockRepository?.planningStock(projectId) ?? Promise.resolve({ ok: true as const, value: [] }),
  ])
  if (!project.ok) throw new Error(persistenceErrorMessage(project.error, 'Project'))
  projectName.value = project.value.name
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
    return { product, materialName: material?.name ?? product.materialId, problem, broken, supplierName: supplier?.name ?? 'Missing supplier' }
  })
  for (const item of stockRecords.value.filter(item => project.value.stockItemIds?.includes(item.id))) {
    const product = stockPanel(item)
    if (products.value.some(catalogProduct => catalogProduct.id === product.id)) throw new Error('A catalog ID conflicts with a stock allocation key. No optimization was started.')
    const material = materialRecords.value.find(record => record.id === item.materialId)
    choices.push({ product, stockQuantity: item.quantity, materialName: material?.name ?? item.materialId, problem: !material ? 'Missing stock material' : !scopedParts.value.some(part => isCompatible(part, product)) ? 'No matching material and exact thickness' : '', broken: !material, supplierName: 'Owned stock' })
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
  try {
    const inputs = await readInputs()
    if (current !== generation) return
    applyInputs(inputs)
    savedSettings.value = inputs.project.cuttingSettings ?? { kerfMm: 3, edgeMarginMm: 0 }
    kerf.value = savedSettings.value.kerfMm; margin.value = savedSettings.value.edgeMarginMm; preferStockPanels.value = savedSettings.value.preferStockPanels ?? true
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
  state.value = 'running'
  try {
    const inputs = await readInputs()
    if (current !== generation) return
    applyInputs(inputs)
    const configuredSettings = inputs.project.cuttingSettings ?? savedSettings.value
    const settings = { ...configuredSettings, preferStockPanels: configuredSettings.preferStockPanels ?? true }
    savedSettings.value = settings
    if (inputs.missingIds.length) throw new Error('Some selected panel sources are missing. Review Materials before optimizing.')
    if (inputs.parts.length === 0) throw new Error('Add project parts before optimizing.')
    if (inputs.panels.length === 0) throw new Error('Select catalog or stock panels in this project’s Materials section.')
    const catalogSupply = catalogPanelSupply(inputs.parts)
    const available = inputs.panels.map(choice => {
      const product = choice.product.stockItemId === undefined ? inputs.catalogProducts.find(product => product.id === choice.product.id) : { ...choice.product, stockItemId: choice.product.stockItemId, availability: 'available' as const }
      if (!product) throw new Error('Missing panel source. Review Materials before optimizing.')
      return { product, quantity: choice.stockQuantity ?? catalogSupply }
    })
    const outcome = await optimizer.optimizeProject({ panels: available.filter(source => !inputs.panels.find(choice => choice.product.id === source.product.id)?.broken), parts: inputs.parts, settings })
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
      result.value = { requestId: outcome.requestId, selection: outcome.selection, choices: inputs.panels, parts: inputs.parts, settings, sources: available.filter(source => outcome.selection.ok && outcome.selection.plan.panels.some(panel => panel.supplierProductId === source.product.id)).map(source => {
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
    const project = await projects.projects.get(projectId)
    if (current !== generation || !project.ok) return
    if (project.value.cuttingSettings && JSON.stringify({ ...project.value.cuttingSettings, preferStockPanels: project.value.cuttingSettings.preferStockPanels ?? true }) !== JSON.stringify({ ...contents.settings, preferStockPanels: contents.settings.preferStockPanels ?? true })) {
      planNotice.value = 'Cutting settings changed. Optimize again to create a current layout.'
      return
    }
    savedSettings.value = project.value.cuttingSettings ?? contents.settings
    kerf.value = savedSettings.value.kerfMm; margin.value = savedSettings.value.edgeMarginMm; preferStockPanels.value = savedSettings.value.preferStockPanels ?? true
    result.value = { requestId: -current, selection: { ok: true, plan }, sources: contents.sources, parts: contents.parts, settings: contents.settings, savedBaseline: true, savedEdited: contents.panels.flatMap((panel, index) => panel.edited ? [index] : []), choices: contents.sources.map(source => ({ product: source.product, materialName: source.materialName, supplierName: source.supplierName, problem: '', broken: false })) }
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
onDeactivated(() => { window.removeEventListener('beforeunload', beforeUnload); if (state.value === 'running') cancel() })
onActivated(() => { window.addEventListener('beforeunload', beforeUnload); if (discardedOnLeave) { discardedOnLeave = false; invalidate(false); void load() } })
onBeforeUnmount(() => { window.removeEventListener('beforeunload', beforeUnload); generation += 1; persistenceController.abort(); optimizer.dispose() })
</script>

<template>
  <section class="optimization-workspace space-y-3">
    <header
      v-if="cuttingPlansStep"
      class="mx-auto w-full max-w-[1440px]"
    >
      <h1 class="text-2xl font-semibold tracking-tight">
        Cutting Plans
      </h1>
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
        class="optimization-header panel flex flex-wrap items-center gap-3 px-3 py-2.5"
        @submit.prevent="start"
      >
        <h1 class="mr-2 text-xl font-semibold">
          Optimization
        </h1>
        <button
          type="submit"
          class="button button-primary button-compact"
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
          class="rounded-md bg-quiet-surface px-2 py-1 text-sm font-medium tabular-nums text-accent"
        >{{ result.selection.plan.metrics.utilizationPercent.toFixed(2) }}% utilization</output>
        <AppButton
          variant="ghost"
          size="small"
          icon-only
          label="Cutting settings"
          title="Cutting settings"
          class="ml-auto"
          :disabled="busy"
          @click="openSettings"
        >
          <AppIcon name="settings" />
        </AppButton>
      </form>
      <AppDialog
        size="small"
        :open="settingsOpen"
        title="Cutting settings"
        close-label="Close cutting settings"
        :busy="busy"
        @close="settingsOpen = false"
      >
        <form
          id="cutting-settings"
          class="space-y-4"
          novalidate
          @submit.prevent="saveSettings"
        >
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
                  form="cutting-settings"
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
              label="Edge margin (mm)"
              :error="fieldErrors.edgeMarginMm ?? ''"
              required
            >
              <template #default="{ controlAttrs }">
                <input
                  v-bind="controlAttrs"
                  v-model.number="margin"
                  form="cutting-settings"
                  type="number"
                  min="0"
                  step="any"
                  class="field"
                  :disabled="busy"
                >
              </template>
            </FormField>
          </div>

          <AppCheckbox
            id="optimization-prefer-stock"
            v-model="preferStockPanels"
            label="Prefer stock panels"
            description="Prioritize panels you already own before using catalog references."
            :disabled="busy"
          />
          <p
            v-if="settingsError"
            role="alert"
            class="text-sm text-danger"
          >
            {{ settingsError }}
          </p>
          <div class="dialog-actions">
            <AppButton
              :disabled="settingsSaving"
              @click="settingsOpen = false"
            >
              Cancel
            </AppButton>
            <AppButton
              type="submit"
              variant="primary"
              :disabled="busy"
            >
              Save settings
            </AppButton>
          </div>
        </form>
      </AppDialog>
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
        v-for="choice in panels.filter(choice => choice.problem)"
        :key="choice.product.id"
        class="text-xs text-muted"
      >
        {{ choice.product.name }} · {{ choice.problem }}
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
    </template>
    <div
      v-show="!cuttingPlansStep"
      class="cutting-workspace-grid items-start gap-3"
    >
      <aside
        class="panel panel-navigation min-w-0 space-y-3 p-3 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-11rem)] lg:overflow-y-auto"
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
              class="block w-full space-y-2 rounded-lg p-2 text-left text-sm"
              :class="panelIndex === index ? 'bg-subtle text-accent' : 'hover:bg-subtle'"
              :data-panel-index="index"
              :aria-pressed="panelIndex === index"
              :aria-expanded="panelIndex === index"
              :aria-controls="`panel-parts-${index}`"
              @click="panelIndex = index"
            >
              <span class="flex items-center justify-between gap-2">
                <span class="min-w-0 flex-1"><span
                  class="block font-semibold"
                >Panel {{ index + 1 }}</span><span class="block text-xs text-muted">{{ result.choices.find(choice => choice.product.id === allocation.supplierProductId)?.product.lengthMm }} × {{ result.choices.find(choice => choice.product.id === allocation.supplierProductId)?.product.widthMm }} × {{ result.choices.find(choice => choice.product.id === allocation.supplierProductId)?.product.thicknessMm }} mm</span></span>
                <span class="text-xs tabular-nums text-muted">{{ (panelPlan(index) ?? allocation.plan).metrics.utilizationPercent.toFixed(1) }}%</span>
              </span>
              <span
                role="progressbar"
                :aria-label="`Panel ${index + 1} utilization`"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-valuenow="(panelPlan(index) ?? allocation.plan).metrics.utilizationPercent"
                class="block h-1 overflow-hidden rounded-full bg-line"
              ><span
                class="block h-full rounded-full bg-accent"
                :style="{ width: `${(panelPlan(index) ?? allocation.plan).metrics.utilizationPercent}%` }"
              /></span>
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
        <section
          aria-labelledby="unplaced-parts-heading"
          class="space-y-2 border-t border-line pt-3"
        >
          <h2
            id="unplaced-parts-heading"
            class="flex items-center justify-between gap-2 text-sm font-semibold"
          >
            Unplaced parts <span class="text-xs font-medium tabular-nums text-muted">{{ unplacedCount }}</span>
          </h2>
          <ul
            v-if="unplacedCount"
            class="space-y-1"
          >
            <li
              v-for="item in result?.selection.plan.unplaced ?? []"
              :key="JSON.stringify([item.partId, item.firstCopyIndex])"
            >
              <button
                type="button"
                class="w-full rounded-lg px-2 py-2 text-left text-xs hover:bg-subtle"
                :aria-label="`Inspect unplaced part ${partName(item.partId)}`"
                aria-haspopup="dialog"
                @click="inspectedUnplaced = item"
              >
                <span class="flex justify-between gap-2 font-medium"><span>{{ partName(item.partId) }}</span><span class="shrink-0 tabular-nums">× {{ item.count }}</span></span>
                <span class="mt-1 block text-muted">{{ result?.parts.find(part => part.id === item.partId)?.lengthMm }} × {{ result?.parts.find(part => part.id === item.partId)?.widthMm }} × {{ result?.parts.find(part => part.id === item.partId)?.thicknessMm }} mm</span>
                <span class="mt-1 block text-muted">{{ unplacedReasons[item.reason] }}</span>
              </button>
            </li>
          </ul>
          <p
            v-else
            class="px-2 text-xs text-muted"
          >
            {{ result ? 'All parts placed.' : 'Optimize to review unplaced parts.' }}
          </p>
        </section>
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
          v-if="!result || !activePanel || !activeChoice"
          class="panel flex min-h-80 items-center justify-center p-6 text-center"
          aria-label="Empty cutting workspace"
        >
          <div class="max-w-sm space-y-2">
            <h2 class="font-semibold">
              {{ result ? 'No panels used' : 'Your cutting layout will appear here' }}
            </h2><p class="text-sm text-muted">
              {{ result ? 'Review unplaced parts or adjust the cutting settings.' : 'Select panels in Materials, add Parts, then Optimize.' }}
            </p>
          </div>
        </div>
      </div>
    </div>
    <AppDialog
      v-if="!cuttingPlansStep && inspectedUnplaced && inspectedPart"
      title="Unplaced part"
      :busy="false"
      size="small"
      @close="inspectedUnplaced = null"
    >
      <div
        class="space-y-4"
        aria-label="Unplaced part details"
      >
        <div>
          <h3 class="font-semibold">
            {{ inspectedPart.name }}
          </h3><p class="mt-1 text-sm text-muted">
            {{ result?.choices.find(choice => choice.product.materialId === inspectedPart?.materialId)?.materialName ?? 'Material unavailable' }}
          </p>
        </div>
        <PanelDimensionPreview
          :length-mm="inspectedPart.lengthMm"
          :width-mm="inspectedPart.widthMm"
          :grain-direction="inspectedPart.grainDirection"
          size="small"
          label="Unplaced part dimension preview"
        />
        <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt class="text-muted">
            Dimensions
          </dt><dd>{{ inspectedPart.lengthMm }} × {{ inspectedPart.widthMm }} × {{ inspectedPart.thicknessMm }} mm</dd>
          <dt class="text-muted">
            Unplaced quantity
          </dt><dd>{{ inspectedUnplaced.count }}</dd>
          <dt class="text-muted">
            Grain direction
          </dt><dd>{{ inspectedPart.grainDirection === 'none' ? 'No grain constraint' : inspectedPart.grainDirection === 'length' ? 'Along length' : 'Along width' }}</dd>
        </dl>
        <p class="text-sm text-muted">
          {{ unplacedReasons[inspectedUnplaced.reason] }}
        </p>
      </div>
    </AppDialog>
    <CuttingPlansWorkspace
      v-if="cuttingPlansStep && displayedInput && cuttingPlansAvailable"
      :input="displayedInput"
      :title="projectName || 'Project cutting result'"
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
.optimization-workspace :deep(.field) { height: var(--control-height-small); min-height: var(--control-height-small); }
.cutting-workspace-grid { display: grid; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 1024px) {
  .cutting-workspace-grid { grid-template-columns: minmax(200px, 230px) minmax(0, 1fr); }
}
</style>
