<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PanelSnapshot } from '../../domain/model/saved-cutting-plan'
import type { Part } from '../../domain/model/part'
import type { CuttingSettings } from '../../domain/model/cutting-settings'
import type { PanelCuttingPlan } from '../../domain/optimizer/plan-with-strategy'
import { createCuttingPlanScene } from '../../application/optimization/cutting-plan-scene'
import { createPlanCanvas, type PlanCanvas, type PlanPalette } from '../optimization/viewer/plan-canvas'
import { fitViewport } from '../optimization/viewer/viewport'
const props = defineProps<{ plan: PanelCuttingPlan; panel: PanelSnapshot; parts: readonly Part[]; settings: CuttingSettings; kept: readonly number[] }>()
const host = ref<HTMLDivElement | null>(null)
const projection = computed(() => createCuttingPlanScene(props.plan, { panel: props.panel, parts: props.parts, settings: props.settings }))
const error = ref('')
let canvas: PlanCanvas | null = null
let resize: ResizeObserver | null = null
let theme: MutationObserver | null = null
function palette(): PlanPalette {
  const styles = getComputedStyle(document.documentElement)
  const token = (name: string) => styles.getPropertyValue(`--${name}`).trim()
  return { surface: token('cutting-panel'), margin: token('cutting-waste'), ink: token('cutting-ink'), muted: token('cutting-line'), part: token('cutting-part'), partBorder: token('cutting-line'), selected: token('cutting-selection'), kerf: token('cutting-kerf') }
}
function fit(): void {
  if (!host.value || projection.value.status !== 'valid') return
  const size = { width: host.value.clientWidth || 640, height: host.value.clientHeight || 440 }
  canvas?.resize(size); canvas?.setViewport(fitViewport(projection.value.scene.panel, size))
}
function render(): void {
  canvas?.destroy(); canvas = null; error.value = ''
  if (!host.value || projection.value.status !== 'valid') return
  try {
    canvas = createPlanCanvas(host.value, projection.value.scene, { width: host.value.clientWidth || 640, height: host.value.clientHeight || 440 }, palette(), () => {}, () => {})
    canvas.setKeptWaste?.(props.kept); fit()
  } catch { error.value = 'Cutting preview unavailable on this device.' }
}
watch(() => JSON.stringify([props.plan.tree, props.panel, props.parts, props.settings]), render)
watch(() => props.kept, kept => { canvas?.setKeptWaste?.(kept) })
onMounted(() => {
  render()
  if (typeof ResizeObserver !== 'undefined') { resize = new ResizeObserver(fit); if (host.value) resize.observe(host.value) }
  theme = new MutationObserver(() => { canvas?.setPalette(palette()) }); theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })
})
onBeforeUnmount(() => { resize?.disconnect(); theme?.disconnect(); canvas?.destroy() })
</script>
<template>
  <div>
    <p
      v-if="error || projection.status === 'invalid'"
      role="alert"
    >
      {{ error || (projection.status === 'invalid' ? projection.message : '') }}
    </p><div
      ref="host"
      class="h-[min(62vh,600px)] min-h-80 w-full"
      role="img"
      :aria-label="`Cutting layout: ${panel.lengthMm} × ${panel.widthMm} mm; ${kept.length} kept offcuts highlighted`"
    /><button
      type="button"
      class="button mt-2"
      @click="fit"
    >
      Fit to view
    </button>
  </div>
</template>
