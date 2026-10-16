<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, shallowRef, toRaw, watch } from 'vue'
import { applyPlanEdit, createPlanEditingSession, currentEditingPlan, undoPlanEdit, redoPlanEdit, resetPlanEdits, type PlanEditingSession } from '../../application/optimization/plan-editing-session'
import type { CuttingTreeEdit } from '../../domain/cutting-tree/edit-cutting-tree'
import { createCuttingPlanScene } from '../../application/optimization/cutting-plan-scene'
import type { CuttingSettings } from '../../domain/model/cutting-settings'
import type { Part } from '../../domain/model/part'
import type { PanelSnapshot } from '../../domain/model/saved-cutting-plan'
import type { PanelCuttingPlan } from '../../domain/optimizer/plan-with-strategy'
import { copyLabel } from './viewer/copy-label'
import AppIcon from '../../shared/ui/AppIcon.vue'
import { createPlanCanvas, type PlanCanvas, type PlanPalette } from './viewer/plan-canvas'
import { fitViewport, panViewport, zoomViewport, type CanvasSize, type Viewport } from './viewer/viewport'

const props = defineProps<{ plan: PanelCuttingPlan | null; panel: PanelSnapshot; parts: readonly Part[]; settings: CuttingSettings; savedBaseline?: boolean; panelLabel?: string | undefined; fitRequest?: number | undefined; selectedCopyKey?: string | undefined; confirmReset?: (() => boolean) | undefined }>()
const emit = defineEmits<{ 'plan-change': [plan: PanelCuttingPlan, modified: boolean]; 'select-copy': [key: string] }>()
const session = shallowRef<PlanEditingSession | null>(null)
const editFeedback = ref('')
const editError = ref('')
const swapKey = ref('')
const swapOpen = ref(false)
watch([() => props.plan, () => props.panel, () => props.parts, () => props.settings], () => {
  session.value = null
  swapOpen.value = false
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
const compatibleSwaps = computed(() => {
  const selected = selectedPart.value
  const editingSession = session.value
  if (!selected || !editingSession || projection.value.status !== 'valid') return []
  return projection.value.scene.parts.filter(part => part.key !== selectedKey.value && applyPlanEdit(editingSession, {
    kind: 'swap', first: { partId: selected.part.id, copyIndex: selected.copyIndex },
    second: { partId: part.part.id, copyIndex: part.copyIndex },
  }).ok)
})
watch(selectedKey, () => { swapOpen.value = false; swapKey.value = '' })
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
  swapOpen.value = false
  swapKey.value = ''
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
  return { surface: token('cutting-panel'), margin: token('cutting-waste'), ink: token('cutting-ink'), muted: token('cutting-line'), part: token('cutting-part'), partBorder: token('cutting-line'), selected: token('cutting-selection'), kerf: token('cutting-cut') }
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
function sizeToViewport(): void {
  if (paused || host.value === null) return
  const top = host.value.getBoundingClientRect().top
  host.value.style.height = `${String(Math.max(240, window.innerHeight - top - 24))}px`
}
function windowResized(): void { sizeToViewport(); resize() }
watch(() => props.plan, () => { isFitted = true })
watch(() => props.fitRequest, () => { isFitted = true; if (canvas) fit() })
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
    sizeToViewport()
    size = { width: host.value.clientWidth || 640, height: host.value.clientHeight || 400 }
    fittedView.value = fitViewport(projection.value.scene.panel, size)
    canvas = createPlanCanvas(host.value, projection.value.scene, size, palette(), key => { selectedKey.value = key }, next => { isFitted = false; view.value = next })
    canvasReady.value = true
    if (isFitted) fit()
    else canvas.setViewport(view.value)
    canvas.setSelection(selectedKey.value)
    resizeObserver?.disconnect()
    resizeObserver?.observe(host.value)
    const toolbar = host.value.closest('section')?.querySelector('.canvas-toolbar')
    if (toolbar) resizeObserver?.observe(toolbar)
  } catch {
    canvas?.destroy(); canvas = null
    canvasReady.value = false
    canvasError.value = 'The graphical viewer is unavailable. The textual cutting summary remains available.'
  }
}
watch(projection, render, { flush: 'post' })
watch(selectedKey, key => { canvas?.setSelection(key); emit('select-copy', key) })
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') resizeObserver = new ResizeObserver(windowResized)
  window.addEventListener('resize', windowResized)
  sizeToViewport()
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
onActivated(() => { if (paused) { paused = false; sizeToViewport(); render() } })
onBeforeUnmount(() => {
  resizeObserver?.disconnect(); themeObserver?.disconnect()
  window.removeEventListener('resize', windowResized)
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
      <p
        v-if="projection.status === 'valid'"
        class="panel-context text-xs text-muted"
        aria-label="Current panel dimensions"
      >
        {{ panelLabel ?? 'Panel' }} · {{ panel.lengthMm }} × {{ panel.widthMm }} × {{ panel.thicknessMm }} mm
      </p>
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
              {{ copyLabel(selectedPart.part, selectedPart.copyIndex) }}
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
      <div
        class="canvas-tools"
        role="group"
        aria-label="Cutting layout view controls"
      >
        <div
          class="tool-group"
          role="group"
          aria-label="Selection and pan"
        >
          <button
            type="button"
            class="tool"
            :disabled="!canvasReady"
            title="Focus canvas — select parts or drag to pan"
            @click="host?.parentElement?.focus()"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
            ><path d="m5 3 14 9-7 1-3 7Z" /></svg><span class="sr-only">Select and pan</span>
          </button>
        </div>
        <div
          class="tool-group"
          role="group"
          aria-label="Editing actions"
        >
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
            <button
              v-if="selectedPart"
              type="button"
              class="tool"
              :disabled="!compatibleSwaps.length"
              :aria-expanded="swapOpen"
              aria-controls="swap-options"
              :title="compatibleSwaps.length ? 'Choose a compatible part to swap' : 'No compatible placed parts to swap'"
              @click="swapOpen = !swapOpen"
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
              ><path d="M4 8h16m-4-4 4 4-4 4M20 16H4m4-4-4 4 4 4" /></svg><span class="sr-only">Choose swap target</span>
            </button>
            <div
              v-if="swapOpen && compatibleSwaps.length"
              id="swap-options"
              class="swap-options"
              @keydown.esc.stop="swapOpen = false"
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
                  v-for="part in compatibleSwaps"
                  :key="part.key"
                  :value="part.key"
                >
                  {{ copyLabel(part.part, part.copyIndex) }}
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
            </div>
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
        <div
          class="tool-group"
          role="group"
          aria-label="Zoom and fit"
        >
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
.selected-strip { display: flex; align-items: center; gap: .65rem; order: 3; flex-basis: 100%; min-width: 0; padding-top: .5rem; border-top: 1px solid var(--line); }
.canvas-tools { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; margin-left: auto; }
.tool-group { display: flex; align-items: center; gap: .2rem; }
.tool-group + .tool-group { border-left: 1px solid var(--line); padding-left: .5rem; }
.swap-options { position: absolute; z-index: 5; right: 0; top: calc(100% + .5rem); display: flex; gap: .35rem; padding: .5rem; background: var(--surface); border: 1px solid var(--line); border-radius: .5rem; box-shadow: 0 6px 20px color-mix(in srgb, var(--ink) 12%, transparent); }
.panel-context { margin-right: auto; min-width: 0; overflow-wrap: anywhere; }
.tool { display: inline-flex; align-items: center; justify-content: center; width: var(--control-height-small); height: var(--control-height-small); border: 1px solid transparent; border-radius: var(--control-radius); background: transparent; }
.tool:hover:not(:disabled) { background: var(--quiet-surface); color: var(--ink); }
.tool:disabled { opacity: .45; cursor: not-allowed; }
.tool:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.tool :deep(svg) { width: 1rem; height: 1rem; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.copy-picker { width: 12rem; max-width: 60vw; }
.graph-paper { background-color: var(--canvas); background-image: linear-gradient(color-mix(in srgb, var(--line) 45%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--line) 45%, transparent) 1px, transparent 1px); background-size: 20px 20px; }
.cutting-canvas-host { height: 400px; min-height: 240px; }
.editing-tools { position: relative; display: flex; align-items: center; gap: .25rem; }
.cutting-viewer :deep(.field) { height: var(--control-height-small); min-height: var(--control-height-small); }
@media (max-width: 640px) { .canvas-tools { flex-wrap: wrap; margin-left: 0; } .selected-strip { flex-basis: 100%; } }
</style>
