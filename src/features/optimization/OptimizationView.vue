<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { RouterLink, matchedRouteKey, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { isCompatible } from '../../domain/compatibility'
import { panelQuantitySchema } from '../../domain/model/cutting-project'
import { cuttingSettingsSchema, type CuttingSettings } from '../../domain/model/cutting-settings'
import type { Part } from '../../domain/model/part'
import type { PanelSnapshot, SavedPlanSummary } from '../../domain/model/saved-cutting-plan'
import { panelSnapshotSchema } from '../../domain/model/saved-cutting-plan'
import { savedCuttingPlanIdSchema } from '../../domain/model/ids'
import type { SavePlanInput } from '../../application/plans/saved-plan-service'
import type { PanelCuttingPlan } from '../../domain/optimizer/plan-with-strategy'
import SavedPlans from './SavedPlans.vue'
import { useSavedPlanService } from './saved-plan-service'
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
const optimizer = useOptimizationService()
const savedPlans = useSavedPlanService()?.forProject(projectId)
const savedList = ref<InstanceType<typeof SavedPlans> | null>(null)
const planName = ref('Cutting plan')
const planBusy = ref(false)
const planError = ref('')
const planNotice = ref('')
const savedSummary = shallowRef<SavedPlanSummary | null>(null)
const savedFingerprint = ref<string | null>(null)
const editedPlans = shallowRef<ReadonlyMap<number, PanelCuttingPlan>>(new Map())
type State = 'loading' | 'ready' | 'running' | 'success' | 'failure' | 'cancelled'
interface PanelChoice { product: PanelSnapshot; materialName: string; label: string; problem: string; broken: boolean; supplierName: string; availability: 'available' | 'unavailable' | 'unknown' }
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
const busy = computed(() => planBusy.value || state.value === 'running' || state.value === 'loading')
const fingerprint = computed(() => result.value === null ? '' : JSON.stringify(result.value.selection.plan.panels.map((panel, index) => (editedPlans.value.get(index) ?? panel.plan).tree)))
const unsavedManualChanges = computed(() => result.value !== null && (savedFingerprint.value === null ? editedPlans.value.size > 0 : fingerprint.value !== savedFingerprint.value))
function canDiscard(): boolean { return !unsavedManualChanges.value || window.confirm('Discard unsaved manual cutting-plan changes? Save the plan first to keep them.') }
function planChanged(index: number, plan: PanelCuttingPlan, modified: boolean): void {
  const next = new Map(editedPlans.value)
  if (modified) next.set(index, plan)
  else next.delete(index)
  editedPlans.value = next
}
const totalCopies = computed(() => parts.value.reduce((sum, part) => sum + part.quantity, 0))

function invalidate(): void {
  generation += 1
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
    const broken = supplier === undefined || material === undefined
    const problem = broken ? 'Missing catalog reference'
      : product.availability === 'unavailable' ? 'Unavailable'
        : !scopedParts.value.some(part => isCompatible(part, product)) ? 'No matching material and exact thickness' : ''
    return { product, materialName: material?.name ?? product.materialId, label: `${supplier?.name ?? 'Missing supplier'} / ${material?.name ?? 'Missing material'} / ${product.name}`, problem, broken, supplierName: supplier?.name ?? 'Missing supplier', availability: product.availability }
  })
  return {
    project: project.value, parts: scopedParts.value, panels: choices,
    missingIds: project.value.supplierProductIds.filter(id => !products.value.some(product => product.id === id)),
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
    quantities.value = Object.fromEntries(inputs.panels.map(choice => [choice.product.id, inputs.project.panelQuantities?.find(item => item.supplierProductId === choice.product.id)?.quantity ?? 1]))
    state.value = 'ready'
  } catch (cause) {
    if (current !== generation) return
    inputError.value = cause instanceof Error ? cause.message : 'Could not load optimization inputs.'
    state.value = 'failure'
  }
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
    if (inputs.panels.length === 0) throw new Error('Select catalog panels in this project’s Materials section.')
    const available = inputs.panels.map(choice => {
      const parsed = panelQuantitySchema.safeParse(quantities.value[choice.product.id] ?? inputs.project.panelQuantities?.find(item => item.supplierProductId === choice.product.id)?.quantity ?? 1)
      if (!parsed.success) quantityErrors.value[choice.product.id] = parsed.error.issues[0]?.message ?? 'Enter a non-negative safe integer.'
      return { product: choice.product, quantity: parsed.success ? parsed.data : 0 }
    })
    if (Object.keys(quantityErrors.value).length) { state.value = 'ready'; return }
    const changed = available.some(source => source.quantity !== (inputs.project.panelQuantities?.find(item => item.supplierProductId === source.product.id)?.quantity ?? 1))
    if (changed) {
      const saved = await projects.projects.update(projectId, { ...inputs.project, panelQuantities: [
        ...available.map(source => ({ supplierProductId: source.product.id, quantity: source.quantity })),
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
        return { product: panelSnapshotSchema.parse({ id, name, materialId, lengthMm, widthMm, thicknessMm, grainDirection }), quantity: source.quantity, materialName: choice?.materialName ?? materialId, supplierName: choice?.supplierName ?? 'Missing supplier' }
      }), savedEdited: [], savedBaseline: false }
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
const reasons = { noCompatiblePanel: 'No selected panel matches the material and exact thickness', constraintsPreventPlacement: 'Dimensions, grain, rotation, kerf or margins prevent placement', panelLimitReached: 'Available panel quantity or remaining usable space is insufficient' }
async function savePlan(): Promise<void> {
  const currentResult = result.value
  if (savedPlans === undefined || currentResult === null || planBusy.value) return
  const current = generation
  const currentFingerprint = fingerprint.value
  const id = savedCuttingPlanIdSchema.parse(crypto.randomUUID())
  const plan = { ...currentResult.selection.plan, panels: currentResult.selection.plan.panels.map((panel, index) => ({ ...panel, plan: editedPlans.value.get(index) ?? panel.plan })) }
  planBusy.value = true; planError.value = ''; planNotice.value = ''
  try {
    const saved = await savedPlans.save({ id, projectId, name: planName.value, createdAt: new Date().toISOString() }, { plan, parts: [...currentResult.parts], settings: currentResult.settings, sources: currentResult.sources, editedPanelIndices: currentResult.selection.plan.panels.flatMap((_, index) => editedPlans.value.has(index) || currentResult.savedEdited.includes(index) ? [index] : []) })
    if (current !== generation) return
    if (!saved.ok) { planError.value = persistenceErrorMessage(saved.error, 'Saved plan'); return }
    savedSummary.value = saved.value.summary
    savedFingerprint.value = currentFingerprint
    planNotice.value = 'Plan saved. All panel layouts were validated and saved together.'
    await savedList.value?.refresh()
  } catch (cause) { if (current === generation) planError.value = cause instanceof Error ? cause.message : 'Could not save the plan.' }
  finally { planBusy.value = false }
}
async function openPlan(summary: SavedPlanSummary): Promise<void> {
  if (savedPlans === undefined || planBusy.value || !canDiscard()) return
  // Keep the current result until a requested historical plan has passed validation.
  const current = ++generation
  const initialFingerprint = fingerprint.value
  optimizer.cancel()
  planBusy.value = true; planError.value = ''; planNotice.value = ''
  try {
    const opened = await savedPlans.get(summary.id)
    if (current !== generation) return
    if (!opened.ok) { planError.value = persistenceErrorMessage(opened.error, 'Saved plan'); return }
    const { contents, plan } = opened.value
    if (fingerprint.value !== initialFingerprint && !canDiscard()) return
    editedPlans.value = new Map()
    panelIndex.value = 0
    result.value = { requestId: -current, selection: { ok: true, plan }, sources: contents.sources, parts: contents.parts, settings: contents.settings, savedBaseline: true, savedEdited: contents.panels.flatMap((panel, index) => panel.edited ? [index] : []), choices: contents.sources.map(source => ({ product: source.product, materialName: source.materialName, supplierName: source.supplierName, label: `${source.supplierName} / ${source.materialName} / ${source.product.name}`, problem: '', broken: false, availability: 'unknown' })) }
    savedSummary.value = opened.value.summary
    savedFingerprint.value = fingerprint.value
    planName.value = `${opened.value.summary.name} copy`
    state.value = 'success'
  } catch (cause) { if (current === generation) planError.value = cause instanceof Error ? cause.message : 'Could not open the plan.' }
  finally { planBusy.value = false }
}
function renamed(summary: SavedPlanSummary): void { if (savedSummary.value?.id === summary.id) savedSummary.value = summary }
function deleted(summary: SavedPlanSummary): void { if (savedSummary.value?.id === summary.id) { savedSummary.value = null; savedFingerprint.value = null } }
function beforeUnload(event: BeforeUnloadEvent): void { if (unsavedManualChanges.value) event.preventDefault() }
if (inject(matchedRouteKey, undefined) !== undefined) {
  onBeforeRouteLeave(canDiscard)
  onBeforeRouteUpdate(canDiscard)
}
onMounted(() => { window.addEventListener('beforeunload', beforeUnload); void load() })
onBeforeUnmount(() => { window.removeEventListener('beforeunload', beforeUnload); generation += 1; optimizer.dispose() })
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
    <SavedPlans
      v-if="savedPlans"
      ref="savedList"
      :plans="savedPlans"
      :disabled="busy"
      @open="openPlan"
      @renamed="renamed"
      @deleted="deleted"
    />
    <p
      v-if="planBusy"
      role="status"
      class="text-muted"
    >
      Saving or opening cutting plan…
    </p>
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
      class="text-success"
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
          <p class="text-sm text-muted">
            Available quantities are saved for this project when you optimize. Existing selections default to one panel each; zero excludes a reference from this run. These are planning limits, not owned stock.
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
                    :disabled="busy || choice.broken || choice.availability === 'unavailable'"
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
      <p class="font-semibold">
        {{ savedSummary && fingerprint === savedFingerprint ? `Saved plan: ${savedSummary.name}` : 'Unsaved result' }}
      </p>
      <p
        v-if="savedSummary"
        class="text-sm text-muted"
      >
        Historical panel and Part snapshots preserve this plan independently of current project and Catalogue changes. Saving changes creates a new plan; existing plans are never overwritten.
      </p>
      <div
        v-if="savedPlans"
        class="flex flex-wrap items-end gap-3"
      >
        <FormField
          id="save-plan-name"
          label="Plan name"
          required
        >
          <template #default="{ controlAttrs }">
            <input
              v-bind="controlAttrs"
              v-model="planName"
              class="field"
              :disabled="busy"
            >
          </template>
        </FormField>
        <button
          type="button"
          class="button button-primary"
          :disabled="busy"
          @click="savePlan"
        >
          Save Plan
        </button>
      </div>
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
  </section>
</template>
