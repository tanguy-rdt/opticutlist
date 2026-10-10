<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createCuttingPlanScene } from '../../application/optimization/cutting-plan-scene'
import type { CuttingSettings } from '../../domain/model/cutting-settings'
import type { Part } from '../../domain/model/part'
import type { SupplierProduct } from '../../domain/model/supplier-product'
import type { PanelCuttingPlan } from '../../domain/optimizer/plan-with-strategy'
import FormField from '../../shared/ui/FormField.vue'
import { createPlanCanvas, type PlanCanvas, type PlanPalette } from './viewer/plan-canvas'
import { fitViewport, panViewport, zoomViewport, type CanvasSize, type Viewport } from './viewer/viewport'

const props = defineProps<{ plan: PanelCuttingPlan | null; panel: SupplierProduct; parts: readonly Part[]; settings: CuttingSettings }>()
const projection = computed(() => createCuttingPlanScene(props.plan, { panel: props.panel, parts: props.parts, settings: props.settings }))
const host = ref<HTMLDivElement | null>(null)
const selectedKey = ref('')
const selectedPart = computed(() => projection.value.status === 'valid' ? projection.value.scene.parts.find(part => part.key === selectedKey.value) : undefined)
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
  if (host.value === null || projection.value.status !== 'valid') return
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
  selectedKey.value = ''
  if (projection.value.status !== 'valid' || host.value === null) return
  try {
    size = { width: host.value.clientWidth || 640, height: host.value.clientHeight || 400 }
    fittedView.value = fitViewport(projection.value.scene.panel, size)
    canvas = createPlanCanvas(host.value, projection.value.scene, size, palette(), key => { selectedKey.value = key }, next => { isFitted = false; view.value = next })
    canvasReady.value = true
    fit()
    resizeObserver?.disconnect()
    resizeObserver?.observe(host.value)
  } catch {
    canvas?.destroy(); canvas = null
    canvasReady.value = false
    canvasError.value = 'The graphical viewer is unavailable. The textual cutting summary remains available.'
  }
}
watch(projection, render, { flush: 'post' })
watch(selectedKey, key => { canvas?.setSelection(key) })
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
onBeforeUnmount(() => {
  resizeObserver?.disconnect(); themeObserver?.disconnect()
  window.removeEventListener('resize', resize)
  media?.removeEventListener('change', themeChanged)
  canvas?.destroy(); canvas = null
})
</script>
<template>
  <section
    class="space-y-4"
    aria-labelledby="cutting-viewer-title"
  >
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h3
        id="cutting-viewer-title"
        class="text-lg font-semibold"
      >
        Cutting layout
      </h3>
      <div
        class="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Cutting layout view controls"
      >
        <button
          type="button"
          class="button"
          :disabled="!canvasReady"
          @click="zoom(1.25)"
        >
          Zoom in
        </button>
        <button
          type="button"
          class="button"
          :disabled="!canvasReady"
          @click="zoom(0.8)"
        >
          Zoom out
        </button>
        <button
          type="button"
          class="button"
          :disabled="!canvasReady"
          @click="fit"
        >
          Fit to view
        </button>
        <button
          type="button"
          class="button"
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
      No cutting plan to display. Optimize a panel first.
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
        id="cutting-viewer-help"
        class="text-sm text-muted"
      >
        Drag to pan; click a part to inspect it. Keyboard: focus the canvas and use arrow keys to pan, +/− to zoom, 0 to fit. Parts cannot be moved or edited.
      </p>
      <p
        v-if="canvasError"
        role="status"
        class="text-muted"
      >
        {{ canvasError }}
      </p>
      <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <figure class="min-w-0 space-y-3">
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
              class="h-80 w-full touch-none sm:h-[400px]"
            />
          </div>
          <figcaption class="space-y-2 text-sm text-muted">
            <p>{{ projection.scene.parts.length }} placed copies · {{ projection.scene.waste.length }} waste regions · {{ projection.scene.kerfs.length }} guillotine cuts.</p>
            <p v-if="!projection.scene.parts.length">
              No parts were placed. The panel contains only waste and margins.
            </p>
            <p>Panel: {{ panel.lengthMm }} × {{ panel.widthMm }} × {{ panel.thicknessMm }} mm · Grain: {{ panel.grainDirection }}{{ panel.grainDirection === 'length' ? ' ↔' : panel.grainDirection === 'width' ? ' ↕' : '' }}.</p>
            <ul
              class="flex flex-wrap gap-x-4 gap-y-2"
              aria-label="Layout legend"
            >
              <li>
                <span
                  aria-hidden="true"
                  class="mr-1 inline-block h-3 w-3 border border-success bg-success-surface"
                />Placed part
              </li>
              <li>
                <span
                  aria-hidden="true"
                  class="mr-1 inline-block h-3 w-3 border border-dashed border-muted bg-subtle"
                />Waste
              </li>
              <li>
                <span
                  aria-hidden="true"
                  class="mr-1 inline-block h-3 w-3 border border-danger bg-danger"
                />Saw kerf (zero kerf is a line)
              </li>
              <li>Outer outline: full panel · Dashed outline: usable area · Edge band: margins · Arrows: grain</li>
            </ul>
          </figcaption>
        </figure>
        <aside
          class="space-y-4 rounded-lg border border-line bg-surface p-4"
          aria-label="Part inspection"
        >
          <FormField
            id="cutting-viewer-part"
            label="Inspect a placed copy"
            hint="Keyboard alternative to clicking the canvas."
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
