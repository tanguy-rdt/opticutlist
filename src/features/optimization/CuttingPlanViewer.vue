<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, shallowRef, toRaw, watch } from 'vue'
import { applyPlanEdit, createPlanEditingSession, currentEditingPlan, undoPlanEdit, redoPlanEdit, resetPlanEdits, type PlanEditingSession } from '../../application/optimization/plan-editing-session'
import type { CuttingTreeEdit } from '../../domain/cutting-tree/edit-cutting-tree'
import { createCuttingPlanScene } from '../../application/optimization/cutting-plan-scene'
import type { CuttingSettings } from '../../domain/model/cutting-settings'
import type { Part } from '../../domain/model/part'
import type { PanelSnapshot } from '../../domain/model/saved-cutting-plan'
import type { PanelCuttingPlan } from '../../domain/optimizer/plan-with-strategy'
import AppIcon from '../../shared/ui/AppIcon.vue'
import { createPlanCanvas, type PlanCanvas, type PlanPalette } from './viewer/plan-canvas'
import { fitViewport, panViewport, zoomViewport, type CanvasSize, type Viewport } from './viewer/viewport'

const props = defineProps<{ plan: PanelCuttingPlan | null; panel: PanelSnapshot; parts: readonly Part[]; settings: CuttingSettings; savedBaseline?: boolean; selectedCopyKey?: string | undefined; confirmReset?: (() => boolean) | undefined }>()
const emit = defineEmits<{ 'plan-change': [plan: PanelCuttingPlan, modified: boolean]; 'select-copy': [key: string] }>()
const session = shallowRef<PlanEditingSession | null>(null)
const editFeedback = ref('')
const editError = ref('')
const swapKey = ref('')
watch([() => props.plan, () => props.panel, () => props.parts, () => props.settings], () => {
  session.value = null
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
  if (session.value === null || edit === null) return
  const outcome = applyPlanEdit(session.value, edit)
  if (!outcome.ok) { editError.value = outcome.error.message; editFeedback.value = ''; return }
  announceSession(outcome.session, edit.kind === 'rotate' ? 'Rotation accepted and independently validated.' : 'Swap accepted and independently validated.')
}
function undo(): void { if (session.value !== null) announceSession(undoPlanEdit(session.value), 'Edit undone.') }
function redo(): void { if (session.value !== null) announceSession(redoPlanEdit(session.value), 'Edit restored.') }
function resetOptimized(): void {
  if (session.value !== null && session.value.cursor > 0 && props.confirmReset?.() === false) return
  if (session.value !== null) announceSession(resetPlanEdits(session.value), props.savedBaseline ? 'Saved plan restored. Edit history cleared.' : 'Optimized plan restored. Edit history cleared.') }
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
  return { surface: token('cutting-panel'), margin: token('cutting-waste'), ink: token('cutting-ink'), muted: token('cutting-line'), part: token('cutting-part'), partBorder: token('cutting-line'), selected: token('cutting-selection'), kerf: token('cutting-kerf') }
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
    class="cutting-viewer overflow-hidden rounded-xl border border-line bg-surface"
    aria-label="Cutting layout"
  >
    <div class="canvas-toolbar">
      <div
        v-if="selectedPart"
        class="selected-strip"
        aria-label="Selected part information"
        aria-live="polite"
      >
        <dl class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <div>
            <dt class="sr-only">
              Part / copy
            </dt><dd class="font-semibold text-sm">
              {{ selectedPart.part.name }} / {{ selectedPart.copyIndex + 1 }}
            </dd>
          </div>
          <div>
            <dt class="sr-only">
              Original dimensions
            </dt><dd class="sr-only">
              {{ selectedPart.part.lengthMm }} × {{ selectedPart.part.widthMm }} × {{ selectedPart.part.thicknessMm }} mm
            </dd><dt class="sr-only">
              Dimensions in panel axes
            </dt><dd>{{ selectedPart.dimensions.lengthMm }} × {{ selectedPart.dimensions.widthMm }} × {{ selectedPart.dimensions.thicknessMm }} mm</dd>
          </div>
          <div>
            <dt class="inline text-muted">
              Position:
            </dt><dd class="inline">
              {{ selectedPart.region.xMm }}, {{ selectedPart.region.yMm }} mm
            </dd>
          </div>
          <div>
            <dt class="sr-only">
              Orientation
            </dt><dd>{{ selectedPart.orientation === 'rotated' ? 'Rotated 90°' : 'Normal' }}</dd>
          </div>
          <div class="sr-only">
            <dt>Grain in panel axes</dt><dd>{{ selectedPart.grain }}</dd>
          </div>
        </dl>
      </div>
      <p
        v-else
        class="text-sm text-muted"
      >
        Cutting layout · Select a placed part
      </p>
      <div
        class="canvas-tools"
        role="group"
        aria-label="Cutting layout view controls"
      >
        <label
          class="sr-only"
          for="cutting-viewer-part"
        >Inspect a placed copy</label>
        <select
          id="cutting-viewer-part"
          v-model="selectedKey"
          class="copy-picker field"
          :disabled="projection.status !== 'valid' || !projection.scene.parts.length"
        >
          <option value="">
            Selection
          </option>
          <template v-if="projection.status === 'valid'">
            <option
              v-for="part in projection.scene.parts"
              :key="part.key"
              :value="part.key"
            >
              {{ part.part.name }} / {{ part.copyIndex + 1 }}
            </option>
          </template>
        </select>
        <button
          type="button"
          class="tool"
          :disabled="!canvasReady"
          title="Zoom out"
          @click="zoom(0.8)"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
          ><path d="M5 12h14" /></svg><span class="sr-only">Zoom out</span>
        </button>
        <output
          aria-label="Canvas zoom"
          class="min-w-12 text-center text-xs"
          aria-live="polite"
        >{{ zoomPercent }}%<span class="sr-only"> of fit</span></output>
        <button
          type="button"
          class="tool"
          :disabled="!canvasReady"
          title="Zoom in"
          @click="zoom(1.25)"
        >
          <AppIcon name="plus" /><span class="sr-only">Zoom in</span>
        </button>
        <button
          type="button"
          class="tool"
          :disabled="!canvasReady"
          title="Fit to view"
          @click="fit"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
          ><path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5" /></svg><span class="sr-only">Fit to view</span>
        </button>
        <button
          type="button"
          class="tool"
          :disabled="!canvasReady"
          title="Reset view"
          @click="reset"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
          ><path d="M4 10V4h6M4 4a10 10 0 1 1-2 10" /></svg><span class="sr-only">Reset view</span>
        </button>
        <button
          type="button"
          class="tool"
          :disabled="Boolean(rotationReason)"
          title="Rotate selected copy 90°"
          aria-describedby="edit-rotation-reason"
          @click="applyEdit(rotationEdit)"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
          ><path d="M20 10V4h-6m6 0a10 10 0 1 0 2 10" /></svg><span class="sr-only">Rotate selected copy 90°</span>
        </button>
        <div
          v-if="projection.status === 'valid'"
          class="editing-tools"
          aria-label="Constrained plan editing"
        >
          <label
            class="sr-only"
            for="cutting-viewer-swap"
          >Swap with placed copy</label>
          <select
            v-if="selectedPart"
            id="cutting-viewer-swap"
            v-model="swapKey"
            class="copy-picker field"
            aria-label="Swap with placed copy"
          >
            <option value="">
              Swap with…
            </option>
            <option
              v-for="part in projection.scene.parts.filter(part => part.key !== selectedKey)"
              :key="part.key"
              :value="part.key"
            >
              {{ part.part.name }} / {{ part.copyIndex + 1 }}
            </option>
          </select>
          <button
            v-if="selectedPart"
            type="button"
            class="tool"
            :disabled="Boolean(swapReason)"
            title="Swap selected copies"
            aria-describedby="edit-swap-reason"
            @click="applyEdit(swapEdit)"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
            ><path d="M4 8h16m-4-4 4 4-4 4M20 16H4m4-4-4 4 4 4" /></svg><span class="sr-only">Swap selected copies</span>
          </button>
          <button
            type="button"
            class="tool"
            :disabled="!session || session.cursor === 0"
            title="Undo edit"
            @click="undo"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
            ><path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 0 14" /></svg><span class="sr-only">Undo edit</span>
          </button>
          <button
            type="button"
            class="tool"
            :disabled="!session || session.cursor >= session.history.length - 1"
            title="Redo edit"
            @click="redo"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
            ><path d="m16 4 5 5-5 5M21 9H11a7 7 0 0 0 0 14" /></svg><span class="sr-only">Redo edit</span>
          </button>
          <button
            type="button"
            class="tool"
            :disabled="!session || session.history.length === 1"
            :title="savedBaseline ? 'Reset to Saved Plan' : 'Reset to Optimized Plan'"
            @click="resetOptimized"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
            ><path d="M4 10V4h6M4 4a10 10 0 1 1-2 10" /></svg><span class="sr-only">{{ savedBaseline ? 'Reset to Saved Plan' : 'Reset to Optimized Plan' }}</span>
          </button>
        </div>
      </div>
    </div>
    <p
      v-if="projection.status === 'unavailable'"
      role="status"
      class="p-4 text-muted"
    >
      No cutting plan to display. Optimize the project first.
    </p>
    <p
      v-else-if="projection.status === 'invalid'"
      role="alert"
      class="p-4 text-danger"
    >
      Cannot display this cutting plan. {{ projection.message }}
    </p>
    <template v-else>
      <p
        id="cutting-viewer-help"
        class="sr-only"
      >
        Drag to pan; click a part to inspect it. Keyboard: focus the canvas and use arrow keys to pan, +/− to zoom, 0 to fit. Dragging only pans the viewport. Part dimensions are fixed; constrained edits are independently validated.
      </p>
      <p
        v-if="canvasError"
        role="status"
        class="p-3 text-muted"
      >
        {{ canvasError }}
      </p>
      <figure>
        <p
          v-if="!projection.scene.parts.length"
          class="p-3 text-sm text-muted"
        >
          No parts were placed. The panel contains only waste and margins.
        </p>
        <div
          tabindex="0"
          role="region"
          aria-label="Cutting plan canvas"
          aria-describedby="cutting-viewer-help"
          class="graph-paper overflow-hidden"
          @keydown="keyboard"
        >
          <div
            ref="host"
            aria-hidden="true"
            class="cutting-canvas-host w-full touch-none"
          />
        </div>
        <figcaption
          class="sr-only"
          aria-label="Layout legend"
        >
          <span>Outlined: placed parts</span><span>Dashed: waste / usable area</span><span>Shaded strips: saw kerf</span><span>Arrows: grain</span>
        </figcaption>
      </figure>
      <div class="px-3 pb-2 text-xs text-muted">
        <p
          id="edit-rotation-reason"
          :class="selectedPart && rotationReason ? '' : 'sr-only'"
        >
          {{ rotationReason }}
        </p><p
          id="edit-swap-reason"
          :class="swapKey && swapReason ? '' : 'sr-only'"
        >
          {{ swapKey ? swapReason : '' }}
        </p>
        <p
          v-if="editFeedback"
          role="status"
          class="text-success"
        >
          {{ editFeedback }}
        </p><p
          v-if="editError"
          role="alert"
          class="text-danger"
        >
          {{ editError }}
        </p>
      </div>
    </template>
  </section>
</template>
<style scoped>
.canvas-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem; padding: .5rem .65rem; border-bottom: 1px solid var(--line); }
.selected-strip { display: flex; align-items: center; gap: .65rem; flex: 1; }
.canvas-tools { display: flex; align-items: center; gap: .25rem; margin-left: auto; }
.tool { display: inline-flex; align-items: center; justify-content: center; width: 2rem; height: 2rem; border: 1px solid var(--line); border-radius: .4rem; background: var(--surface); }
.tool:hover:not(:disabled) { background: var(--success-surface); color: var(--accent); }
.tool:disabled { opacity: .4; }
.tool :deep(svg) { width: 1rem; height: 1rem; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.copy-picker { width: 6.5rem; }
.graph-paper { background-color: var(--canvas); background-image: linear-gradient(color-mix(in srgb, var(--line) 45%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--line) 45%, transparent) 1px, transparent 1px); background-size: 20px 20px; }
.cutting-canvas-host { height: clamp(360px, 62dvh, 800px); }
.editing-tools { display: flex; align-items: center; gap: .25rem; }
.cutting-viewer :deep(.field) { min-height: 2rem; padding-block: .375rem; font-size: .875rem; }
@media (max-width: 640px) { .canvas-tools { flex-wrap: wrap; margin-left: 0; } .selected-strip { flex-basis: 100%; } }
</style>
