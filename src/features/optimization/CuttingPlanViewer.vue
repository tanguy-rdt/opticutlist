<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, shallowRef, toRaw, watch } from 'vue'
import { applyPlanEdit, createPlanEditingSession, currentEditingPlan, undoPlanEdit, redoPlanEdit, resetPlanEdits, type PlanEditingSession } from '../../application/optimization/plan-editing-session'
import type { CuttingTreeEdit } from '../../domain/cutting-tree/edit-cutting-tree'
import { createCuttingPlanScene } from '../../application/optimization/cutting-plan-scene'
import type { CuttingSettings } from '../../domain/model/cutting-settings'
import type { Part } from '../../domain/model/part'
import type { PanelSnapshot } from '../../domain/model/saved-cutting-plan'
import type { PanelCuttingPlan } from '../../domain/optimizer/plan-with-strategy'
import FormField from '../../shared/ui/FormField.vue'
import { createPlanCanvas, type PlanCanvas, type PlanPalette } from './viewer/plan-canvas'
import { fitViewport, panViewport, zoomViewport, type CanvasSize, type Viewport } from './viewer/viewport'

const props = defineProps<{ plan: PanelCuttingPlan | null; panel: PanelSnapshot; parts: readonly Part[]; settings: CuttingSettings; savedBaseline?: boolean; selectedCopyKey?: string | undefined; confirmReset?: (() => boolean) | undefined }>()
const emit = defineEmits<{ 'plan-change': [plan: PanelCuttingPlan, modified: boolean]; 'select-copy': [key: string] }>()
const session = shallowRef<PlanEditingSession | null>(null)
const editMode = ref(false)
const editFeedback = ref('')
const editError = ref('')
const swapKey = ref('')
watch([() => props.plan, () => props.panel, () => props.parts, () => props.settings], () => {
  session.value = null
  editMode.value = false
  swapKey.value = ''
  editFeedback.value = ''
  editError.value = ''
  if (props.plan !== null) {
    const created = createPlanEditingSession(toRaw(props.plan), { panel: toRaw(props.panel), parts: toRaw(props.parts), settings: toRaw(props.settings) })
    if (created.ok) session.value = created.session
  }
}, { immediate: true, flush: 'sync' })
const displayedPlan = computed(() => session.value === null ? props.plan : currentEditingPlan(session.value))
const projection = computed(() => createCuttingPlanScene(displayedPlan.value, { panel: props.panel, parts: props.parts, settings: props.settings }))
const host = ref<HTMLDivElement | null>(null)
const selectedKey = ref(props.selectedCopyKey ?? '')
watch(() => props.selectedCopyKey, key => { if (key !== undefined) selectedKey.value = key })
const selectedPart = computed(() => projection.value.status === 'valid' ? projection.value.scene.parts.find(part => part.key === selectedKey.value) : undefined)
const swapPart = computed(() => projection.value.status === 'valid' ? projection.value.scene.parts.find(part => part.key === swapKey.value) : undefined)
const rotationEdit = computed<CuttingTreeEdit | null>(() => selectedPart.value === undefined ? null : { kind: 'rotate', copy: { partId: selectedPart.value.part.id, copyIndex: selectedPart.value.copyIndex } })
const swapEdit = computed<CuttingTreeEdit | null>(() => selectedPart.value === undefined || swapPart.value === undefined ? null : { kind: 'swap', first: { partId: selectedPart.value.part.id, copyIndex: selectedPart.value.copyIndex }, second: { partId: swapPart.value.part.id, copyIndex: swapPart.value.copyIndex } })
function unavailableReason(edit: CuttingTreeEdit | null, emptyMessage: string): string {
  if (session.value === null) return 'A valid cutting plan is required.'
  if (edit === null) return emptyMessage
  const proposed = applyPlanEdit(session.value, edit)
  return proposed.ok ? '' : proposed.error.message
}
const rotationReason = computed(() => unavailableReason(rotationEdit.value, 'Select a placed copy to rotate.'))
const swapReason = computed(() => unavailableReason(swapEdit.value, 'Select two different placed copies to swap.'))
function announceSession(next: PlanEditingSession, message: string): void {
  session.value = next
  editError.value = ''
  editFeedback.value = message
  emit('plan-change', currentEditingPlan(next), next.cursor > 0)
}
function applyEdit(edit: CuttingTreeEdit | null): void {
  if (!editMode.value || session.value === null || edit === null) return
  const outcome = applyPlanEdit(session.value, edit)
  if (!outcome.ok) { editError.value = outcome.error.message; editFeedback.value = ''; return }
  announceSession(outcome.session, edit.kind === 'rotate' ? 'Rotation accepted and independently validated.' : 'Swap accepted and independently validated.')
}
function undo(): void { if (editMode.value && session.value !== null) announceSession(undoPlanEdit(session.value), 'Edit undone.') }
function redo(): void { if (editMode.value && session.value !== null) announceSession(redoPlanEdit(session.value), 'Edit restored.') }
function resetOptimized(): void {
  if (session.value !== null && session.value.cursor > 0 && props.confirmReset?.() === false) return
  if (editMode.value && session.value !== null) announceSession(resetPlanEdits(session.value), props.savedBaseline ? 'Saved plan restored. Edit history cleared.' : 'Optimized plan restored. Edit history cleared.') }
const canvasError = ref('')
const canvasReady = ref(false)
const view = ref<Viewport>({ x: 0, y: 0, scale: 1 })
const zoomPercent = computed(() => Math.round(view.value.scale / fittedView.value.scale * 100))
const fittedView = ref<Viewport>({ x: 0, y: 0, scale: 1 })
let size: CanvasSize = { width: 640, height: 400 }
let canvas: PlanCanvas | null = null
let resizeObserver: ResizeObserver | null = null
let themeObserver: MutationObserver | null = null
let media: MediaQueryList | null = null
let isFitted = true
let paused = false
function palette(): PlanPalette {
  const style = getComputedStyle(document.documentElement)
  const token = (name: string) => style.getPropertyValue(`--${name}`).trim()
  return { surface: token('surface'), margin: token('subtle'), ink: token('ink'), muted: token('muted'), part: token('success-surface'), partBorder: token('success'), selected: token('accent'), kerf: token('danger') }
}
function setView(next: Viewport): void { view.value = next; canvas?.setViewport(next) }
function fit(): void { isFitted = true; setView(fittedView.value) }
function reset(): void { selectedKey.value = ''; fit() }
function zoom(factor: number): void {
  isFitted = false
  setView(zoomViewport(view.value, factor, { x: size.width / 2, y: size.height / 2 }, fittedView.value.scale / 8, fittedView.value.scale * 32))
}
function pan(x: number, y: number): void { isFitted = false; setView(panViewport(view.value, { x, y })) }
function keyboard(event: KeyboardEvent): void {
  if (canvas === null) return
  switch (event.key) {
    case 'ArrowLeft': pan(40, 0); break
    case 'ArrowRight': pan(-40, 0); break
    case 'ArrowUp': pan(0, 40); break
    case 'ArrowDown': pan(0, -40); break
    case '+': case '=': zoom(1.25); break
    case '-': zoom(0.8); break
    case '0': fit(); break
    case 'Escape': selectedKey.value = ''; break
    default: return
  }
  event.preventDefault()
}
function resize(): void {
  if (paused || host.value === null || projection.value.status !== 'valid') return
  const next = { width: host.value.clientWidth || 640, height: host.value.clientHeight || 400 }
  if (next.width === size.width && next.height === size.height) return
  size = next
  fittedView.value = fitViewport(projection.value.scene.panel, size)
  canvas?.resize(size)
  if (isFitted) fit()
}
function themeChanged(): void { canvas?.setPalette(palette()) }
function render(): void {
  resizeObserver?.disconnect()
  canvas?.destroy(); canvas = null
  canvasReady.value = false
  canvasError.value = ''
  if (projection.value.status !== 'valid' || !projection.value.scene.parts.some(part => part.key === selectedKey.value)) selectedKey.value = ''
  if (paused || projection.value.status !== 'valid' || host.value === null) return
  try {
    size = { width: host.value.clientWidth || 640, height: host.value.clientHeight || 400 }
    fittedView.value = fitViewport(projection.value.scene.panel, size)
    canvas = createPlanCanvas(host.value, projection.value.scene, size, palette(), key => { selectedKey.value = key }, next => { isFitted = false; view.value = next })
    canvasReady.value = true
    if (isFitted) fit()
    else canvas.setViewport(view.value)
    canvas.setSelection(selectedKey.value)
    resizeObserver?.disconnect()
    resizeObserver?.observe(host.value)
  } catch {
    canvas?.destroy(); canvas = null
    canvasReady.value = false
    canvasError.value = 'The graphical viewer is unavailable. The textual cutting summary remains available.'
  }
}
watch(projection, render, { flush: 'post' })
watch(selectedKey, key => { canvas?.setSelection(key); emit('select-copy', key) })
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') resizeObserver = new ResizeObserver(resize)
  else window.addEventListener('resize', resize)
  themeObserver = new MutationObserver(themeChanged)
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  if (typeof window.matchMedia === 'function') {
    media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', themeChanged)
  }
  render()
})
// Keep transient edit/viewport state when switching panels, but release hidden Konva stages.
onDeactivated(() => {
  paused = true
  resizeObserver?.disconnect()
  canvas?.destroy(); canvas = null
  canvasReady.value = false
})
onActivated(() => { if (paused) { paused = false; render() } })
onBeforeUnmount(() => {
  resizeObserver?.disconnect(); themeObserver?.disconnect()
  window.removeEventListener('resize', resize)
  media?.removeEventListener('change', themeChanged)
  canvas?.destroy(); canvas = null
})
</script>
<template>
  <section
    class="cutting-viewer space-y-3"
    aria-labelledby="cutting-viewer-title"
  >
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h3
        id="cutting-viewer-title"
        class="text-lg font-semibold"
      >
        Cutting layout
      </h3>
      <button
        type="button"
        class="button button-compact"
        :aria-pressed="editMode"
        :disabled="session === null || projection.status !== 'valid'"
        @click="editMode = !editMode"
      >
        {{ editMode ? 'Switch to View Mode' : 'Enter Edit Mode' }}
      </button>
      <div
        class="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Cutting layout view controls"
      >
        <button
          type="button"
          class="button button-compact"
          :disabled="!canvasReady"
          @click="zoom(1.25)"
        >
          Zoom in
        </button>
        <button
          type="button"
          class="button button-compact"
          :disabled="!canvasReady"
          @click="zoom(0.8)"
        >
          Zoom out
        </button>
        <button
          type="button"
          class="button button-compact"
          :disabled="!canvasReady"
          @click="fit"
        >
          Fit to view
        </button>
        <button
          type="button"
          class="button button-compact"
          :disabled="!canvasReady"
          @click="reset"
        >
          Reset view
        </button>
        <output
          v-if="canvasReady"
          aria-live="polite"
          class="text-sm text-muted"
        >{{ zoomPercent }}% of fit</output>
      </div>
    </div>
    <p
      v-if="projection.status === 'unavailable'"
      role="status"
      class="text-muted"
    >
      No cutting plan to display. Optimize the project first.
    </p>
    <p
      v-else-if="projection.status === 'invalid'"
      role="alert"
      class="text-danger"
    >
      Cannot display this cutting plan. {{ projection.message }}
    </p>
    <template v-else>
      <p
        role="status"
        class="text-sm font-semibold text-accent"
      >
        {{ editMode ? 'Edit Mode — constrained adjustments' : 'View Mode — read-only' }}
      </p>
      <p
        id="cutting-viewer-help"
        class="sr-only"
      >
        Drag to pan; click a part to inspect it. Keyboard: focus the canvas and use arrow keys to pan, +/− to zoom, 0 to fit. Dragging only pans the viewport. Use Edit Mode controls for constrained changes.
      </p>
      <p
        v-if="canvasError"
        role="status"
        class="text-muted"
      >
        {{ canvasError }}
      </p>
      <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_15rem]">
        <figure class="min-w-0 space-y-3">
          <p
            v-if="!projection.scene.parts.length"
            class="text-sm text-muted"
          >
            No parts were placed. The panel contains only waste and margins.
          </p>
          <div
            tabindex="0"
            role="region"
            aria-label="Cutting plan canvas"
            aria-describedby="cutting-viewer-help"
            class="overflow-hidden rounded-lg border border-line bg-canvas"
            @keydown="keyboard"
          >
            <div
              ref="host"
              aria-hidden="true"
              class="cutting-canvas-host w-full touch-none"
            />
          </div>
          <figcaption
            class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted"
            aria-label="Layout legend"
          >
            <span>Green: placed parts</span><span>Dashed: waste / usable area</span><span>Red: saw kerf</span><span>Arrows: grain</span>
          </figcaption>
        </figure>
        <aside
          class="min-w-0 space-y-3 rounded-lg border border-line bg-surface p-3"
          aria-label="Part inspection"
        >
          <h3 class="text-sm font-semibold">
            Inspector
          </h3>
          <FormField
            id="cutting-viewer-part"
            label="Inspect a placed copy"
          >
            <template #default="{ controlAttrs }">
              <select
                v-bind="controlAttrs"
                v-model="selectedKey"
                class="field"
                :disabled="!projection.scene.parts.length"
              >
                <option value="">
                  Select a part
                </option>
                <option
                  v-for="part in projection.scene.parts"
                  :key="part.key"
                  :value="part.key"
                >
                  {{ part.part.name }} / {{ part.copyIndex + 1 }}
                </option>
              </select>
            </template>
          </FormField>
          <div
            v-if="editMode"
            class="space-y-3 border-t border-line pt-4"
            aria-label="Constrained plan editing"
          >
            <button
              type="button"
              class="button w-full"
              :disabled="Boolean(rotationReason)"
              aria-describedby="edit-rotation-reason"
              @click="applyEdit(rotationEdit)"
            >
              Rotate selected copy 90°
            </button>
            <p
              id="edit-rotation-reason"
              class="text-sm text-muted"
            >
              {{ rotationReason || 'Uses only this copy’s reserved region and waste. Its anchor and other parts stay fixed.' }}
            </p>
            <FormField
              id="cutting-viewer-swap"
              label="Swap with placed copy"
            >
              <template #default="{ controlAttrs }">
                <select
                  v-bind="controlAttrs"
                  v-model="swapKey"
                  class="field"
                  :disabled="!selectedPart"
                >
                  <option value="">
                    Select another copy
                  </option>
                  <option
                    v-for="part in projection.scene.parts.filter(part => part.key !== selectedKey)"
                    :key="part.key"
                    :value="part.key"
                  >
                    {{ part.part.name }} / {{ part.copyIndex + 1 }}
                  </option>
                </select>
              </template>
            </FormField>
            <button
              type="button"
              class="button w-full"
              :disabled="Boolean(swapReason)"
              aria-describedby="edit-swap-reason"
              @click="applyEdit(swapEdit)"
            >
              Swap selected copies
            </button>
            <p
              id="edit-swap-reason"
              class="text-sm text-muted"
            >
              {{ swapReason || 'Both copies fit the other leaf exactly. Cut regions stay fixed; orientations may change when permitted.' }}
            </p>
            <div
              class="flex flex-wrap gap-2"
              aria-describedby="edit-history-help"
            >
              <button
                type="button"
                class="button button-compact"
                :disabled="!session || session.cursor === 0"
                @click="undo"
              >
                Undo edit
              </button>
              <button
                type="button"
                class="button button-compact"
                :disabled="!session || session.cursor >= session.history.length - 1"
                @click="redo"
              >
                Redo edit
              </button>
              <button
                type="button"
                class="button button-compact"
                :disabled="!session || session.history.length === 1"
                @click="resetOptimized"
              >
                {{ savedBaseline ? 'Reset to Saved Plan' : 'Reset to Optimized Plan' }}
              </button>
            </div>
            <p
              id="edit-history-help"
              class="text-sm text-muted"
            >
              Undo and Redo apply to accepted edits. Reset restores the optimizer result and clears history.
            </p>
            <p
              v-if="editFeedback"
              role="status"
              class="text-sm text-success"
            >
              {{ editFeedback }}
            </p>
            <p
              v-if="editError"
              role="alert"
              class="text-sm text-danger"
            >
              {{ editError }}
            </p>
          </div>
          <dl
            v-if="selectedPart"
            class="space-y-3 text-sm"
            aria-live="polite"
          >
            <div>
              <dt class="text-muted">
                Part / copy
              </dt><dd class="font-semibold">
                {{ selectedPart.part.name }} / {{ selectedPart.copyIndex + 1 }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Original length × width × thickness
              </dt><dd>{{ selectedPart.part.lengthMm }} × {{ selectedPart.part.widthMm }} × {{ selectedPart.part.thicknessMm }} mm</dd>
            </div>
            <div>
              <dt class="text-muted">
                Dimensions in panel axes
              </dt><dd>{{ selectedPart.dimensions.lengthMm }} × {{ selectedPart.dimensions.widthMm }} × {{ selectedPart.dimensions.thicknessMm }} mm</dd>
            </div>
            <div>
              <dt class="text-muted">
                Orientation
              </dt><dd>{{ selectedPart.orientation === 'rotated' ? 'Rotated 90°' : 'Normal' }} · Rotation {{ selectedPart.part.rotation }}</dd>
            </div>
            <div>
              <dt class="text-muted">
                Position along panel length / width
              </dt><dd>{{ selectedPart.region.xMm }}, {{ selectedPart.region.yMm }} mm</dd>
            </div>
            <div>
              <dt class="text-muted">
                Grain in panel axes
              </dt><dd>{{ selectedPart.grain }}</dd>
            </div>
          </dl>
          <p
            v-else
            class="text-sm text-muted"
          >
            Select a placed part to highlight it and inspect its dimensions and orientation.
          </p>
        </aside>
      </div>
    </template>
  </section>
</template>

<style scoped>
.cutting-canvas-host { height: clamp(320px, 55dvh, 680px); }
.cutting-viewer :deep(.field) { min-height: 2.25rem; padding-block: 0.375rem; font-size: 0.875rem; }
</style>
