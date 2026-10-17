<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PanelSnapshot } from '../../domain/model/saved-cutting-plan'
import type { Part } from '../../domain/model/part'
import type { CuttingSettings } from '../../domain/model/cutting-settings'
import type { PanelCuttingPlan } from '../../domain/optimizer/plan-with-strategy'
import { createCuttingPlanScene } from '../../application/optimization/cutting-plan-scene'
import { createPlanCanvas, type PlanCanvas, type PlanPalette } from '../optimization/viewer/plan-canvas'
import { fitViewport } from '../optimization/viewer/viewport'
const props = defineProps<{
  plan: PanelCuttingPlan;
  panel: PanelSnapshot;
  parts: readonly Part[];
  settings: CuttingSettings;
  kept: readonly number[];
  label: string;
  panelKey: string;
  offcuts: readonly { readonly index: number; readonly label: string }[];
  selectedWaste: number | null;
  hoveredWaste: number | null
}>()
const emit = defineEmits<{ selectWaste: [index: number]; hoverWaste: [index: number | null] }>()
const host = ref<HTMLDivElement | null>(null)
const projection = computed(() => createCuttingPlanScene(props.plan, { panel: props.panel, parts: props.parts, settings: props.settings }))
const error = ref('')
let canvas: PlanCanvas | null = null
let resize: ResizeObserver | null = null
let theme: MutationObserver | null = null
function palette(): PlanPalette {
  const styles = getComputedStyle(document.documentElement)
  const token = (name: string) => styles.getPropertyValue(`--${name}`).trim()
  return {
    surface: token('cutting-panel'),
    margin: token('cutting-waste'),
    ink: token('cutting-ink'),
    muted: token('cutting-line'),
    part: token('cutting-part'),
    partBorder: token('cutting-line'),
    selected: token('cutting-selection'),
    kerf: token('cutting-kerf')
  }
}
function fit(): void {
  if (!host.value || projection.value.status !== 'valid') return
  const size = { width: host.value.clientWidth || 640, height: host.value.clientHeight || 440 }
  canvas?.resize(size);
  canvas?.setViewport(fitViewport(projection.value.scene.panel, size))
}
function render(): void {
  canvas?.destroy();
  canvas = null;
  error.value = ''
  if (!host.value || projection.value.status !== 'valid') return
  try {
    canvas = createPlanCanvas(host.value, projection.value.scene, { width: host.value.clientWidth || 640, height: host.value.clientHeight || 440 }, palette(), () => { }, () => { }, {
      indices: props.offcuts.map(offcut => offcut.index),
      labels: new Map(props.offcuts.map(offcut => [offcut.index, offcut.label])),
      onSelect: index => { emit('selectWaste', index) },
      onHover: index => { emit('hoverWaste', index) }
    })
    canvas.setKeptWaste?.(props.kept);
    canvas.setWasteInspection?.(props.selectedWaste, props.hoveredWaste);
    fit()
  } catch { error.value = 'Cutting preview unavailable on this device.' }
}
watch(() => JSON.stringify([props.panelKey, props.offcuts, props.plan.tree, props.panel, props.parts, props.settings]), render, { flush: 'post' })
watch(() => props.kept, kept => { canvas?.setKeptWaste?.(kept) })
watch(() => [props.selectedWaste, props.hoveredWaste] as const, ([selected, hovered]) => { canvas?.setWasteInspection?.(selected, hovered) })
onMounted(() => {
  render()
  if (typeof ResizeObserver !== 'undefined') {
    resize = new ResizeObserver(fit);
    if (host.value) resize.observe(host.value)
  }
  theme = new MutationObserver(() => { canvas?.setPalette(palette()) });
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })
})
onBeforeUnmount(() => {
  resize?.disconnect();
  theme?.disconnect();
  canvas?.destroy()
})
</script>
<template>
  <div class="stock-preview">
    <header class="stock-preview-toolbar">
      <div class="min-w-0">
        <h2
          class="truncate text-sm font-semibold"
          :title="label"
        >
          {{ label }}
        </h2>
        <p class="text-xs tabular-nums text-muted">
          {{ panel.lengthMm }} × {{ panel.widthMm }} × {{ panel.thicknessMm }} mm
        </p>
      </div>
    </header>
    <p
      v-if="error || projection.status === 'invalid'"
      role="alert"
      class="p-3 text-sm text-danger"
    >
      {{ error || (projection.status === 'invalid' ? projection.message : '') }}
    </p>
    <div
      ref="host"
      class="stock-preview-canvas"
      role="img"
      :aria-label="`Offcut layout: ${panel.lengthMm} × ${panel.widthMm} mm; ${kept.length} kept offcuts highlighted. Inspect offcuts using the adjacent list.`"
    />
  </div>
</template>
<style scoped>
.stock-preview-toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: .75rem; padding: .75rem 1rem; border-bottom: 1px solid var(--line); background: var(--surface); }
.stock-preview-canvas { width: 100%; min-width: 0; height: clamp(20rem, 58vh, 36rem); overflow: hidden; background: var(--canvas); }
</style>
