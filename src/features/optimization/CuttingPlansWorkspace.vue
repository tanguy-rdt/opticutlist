<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, toRaw, watch } from 'vue'
import type { PdfOrientation, PdfPageSize } from '../../application/export/cutting-plan-pdf-service'
import type { SavePlanInput } from '../../application/plans/saved-plan-service'
import { downloadCuttingPlanPdf, useCuttingPlanPdfService } from './pdf-export-service'
import { loadPdfPreview, type PdfPreviewDocument } from './pdf-preview'

const props = defineProps<{ input: SavePlanInput; title: string }>()
const service = useCuttingPlanPdfService()
const pageSize = ref<PdfPageSize>('A4')
const orientation = ref<PdfOrientation>('landscape')
const page = ref(1)
const pageCount = ref(0)
const zoom = ref(1)
const generating = ref(false)
const rendering = ref(false)
const error = ref('')
const feedback = ref('')
const paper = ref<HTMLDivElement | null>(null)
const viewport = ref<HTMLDivElement | null>(null)
const bytes = shallowRef<Uint8Array<ArrayBuffer> | null>(null)
let pdf: PdfPreviewDocument | null = null
let generation = 0
let renderVersion = 0
let loading = new AbortController()
let renderController = new AbortController()
let observer: ResizeObserver | null = null
let disposed = false
function canRender(): boolean { return paper.value !== null && !disposed }
function isCurrent(current: number): boolean { return current === generation && !disposed }
function clearRender(): void {
  renderVersion += 1; renderController.abort(); renderController = new AbortController()
  paper.value?.replaceChildren(); rendering.value = false
}
function clearDocument(): void {
  loading.abort(); loading = new AbortController(); clearRender()
  const previous = pdf; pdf = null
  if (previous) void previous.destroy().catch(() => { /* already cancelled */ })
  bytes.value = null; pageCount.value = 0
}
async function renderPage(): Promise<void> {
  clearRender()
  if (!pdf || !canRender()) return
  const current = renderVersion
  const document = pdf
  const canvas = window.document.createElement('canvas')
  canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `Cutting document page ${String(page.value)}`)
  rendering.value = true
  try {
    await document.render(page.value, canvas, viewport.value?.clientWidth || 800, zoom.value, renderController.signal)
    if (current === renderVersion && !disposed) paper.value?.replaceChildren(canvas)
  } catch (cause) {
    if (current === renderVersion && !disposed) error.value = cause instanceof Error ? cause.message : 'PDF preview failed.'
  } finally { if (current === renderVersion) rendering.value = false }
}
async function regenerate(): Promise<void> {
  const current = ++generation
  clearDocument(); error.value = ''; feedback.value = ''; page.value = 1; generating.value = true
  const signal = loading.signal
  if (!service) { error.value = 'PDF generation is unavailable.'; generating.value = false; return }
  try {
    const result = await service.exportProject({ ...toRaw(props.input), title: props.title, pageSize: pageSize.value, orientation: orientation.value })
    if (!isCurrent(current)) return
    if (!result.ok) { error.value = result.error.message; return }
    bytes.value = result.bytes
    const loaded = await loadPdfPreview(result.bytes, signal)
    if (!isCurrent(current)) { await loaded.destroy(); return }
    pdf = loaded; pageCount.value = loaded.pageCount
    await nextTick(); await renderPage()
  } catch (cause) {
    if (isCurrent(current)) error.value = cause instanceof Error ? cause.message : 'Could not prepare the cutting document.'
  } finally { if (current === generation) generating.value = false }
}
function download(): void {
  if (!bytes.value || generating.value) return
  try { downloadCuttingPlanPdf(bytes.value); feedback.value = 'PDF download started.' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'PDF download failed.' }
}
watch([() => props.input, () => props.title, pageSize, orientation], () => { void regenerate() }, { immediate: true, flush: 'sync' })
watch([page, zoom], () => { void renderPage() })
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined' && viewport.value) {
    let width = viewport.value.clientWidth
    observer = new ResizeObserver(() => { const next = viewport.value?.clientWidth ?? 0; if (next !== width) { width = next; void renderPage() } })
    observer.observe(viewport.value)
  }
})
onBeforeUnmount(() => { disposed = true; generation += 1; observer?.disconnect(); clearDocument() })
</script>
<template>
  <section
    class="document-workspace"
    aria-label="Cutting Plans document workspace"
  >
    <div class="document-toolbar">
      <h2 class="mr-2 text-sm font-semibold">
        Cutting Plan
      </h2>
      <fieldset
        class="options"
        aria-label="Page size"
      >
        <button
          v-for="size in ['A4', 'A3'] as const"
          :key="size"
          type="button"
          :aria-pressed="pageSize === size"
          @click="pageSize = size"
        >
          {{ size }}
        </button>
      </fieldset>
      <fieldset
        class="options"
        aria-label="Orientation"
      >
        <button
          v-for="direction in ['portrait', 'landscape'] as const"
          :key="direction"
          type="button"
          :aria-pressed="orientation === direction"
          @click="orientation = direction"
        >
          {{ direction === 'portrait' ? 'Portrait' : 'Landscape' }}
        </button>
      </fieldset>
      <span class="text-xs text-muted">Fit to page</span>
      <div
        class="flex items-center gap-1"
        role="group"
        aria-label="Preview zoom"
      >
        <button
          type="button"
          class="zoom-button"
          aria-label="Zoom out preview"
          :disabled="zoom <= 0.5"
          @click="zoom = Math.max(0.5, zoom - 0.25)"
        >
          −
        </button>
        <output class="min-w-10 text-center text-xs">{{ Math.round(zoom * 100) }}%</output>
        <button
          type="button"
          class="zoom-button"
          aria-label="Zoom in preview"
          :disabled="zoom >= 2"
          @click="zoom = Math.min(2, zoom + 0.25)"
        >
          +
        </button>
      </div>
      <button
        type="button"
        class="button button-primary button-compact ml-auto"
        :disabled="!bytes || generating"
        @click="download"
      >
        Download PDF
      </button>
    </div>
    <p
      v-if="error"
      role="alert"
      class="text-sm text-danger"
    >
      {{ error }} <button
        type="button"
        class="button button-compact"
        @click="regenerate"
      >
        Retry
      </button>
    </p>
    <p
      v-if="feedback"
      role="status"
      class="text-sm text-success"
    >
      {{ feedback }}
    </p>
    <div
      ref="viewport"
      class="document-viewport"
      :aria-busy="generating || rendering"
    >
      <p
        v-if="generating || rendering"
        role="status"
        class="p-4 text-center text-sm text-muted"
      >
        {{ generating ? 'Generating cutting document…' : 'Rendering page…' }}
      </p>
      <div
        ref="paper"
        class="paper"
      />
    </div>
    <nav
      class="page-navigation"
      aria-label="Document pages"
    >
      <button
        type="button"
        class="button button-compact"
        :disabled="page <= 1 || generating"
        @click="page -= 1"
      >
        Previous page
      </button>
      <span
        class="text-sm"
        aria-live="polite"
      >Page {{ pageCount ? page : 0 }} of {{ pageCount }}</span>
      <button
        type="button"
        class="button button-compact"
        :disabled="page >= pageCount || generating"
        @click="page += 1"
      >
        Next page
      </button>
    </nav>
  </section>
</template>
<style scoped>
.document-workspace { min-width: 0; display: flex; flex-direction: column; gap: .75rem; }
.document-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: .65rem; padding: .5rem 0; }
.options { display: flex; gap: .125rem; border: 1px solid var(--line); padding: .125rem; border-radius: .45rem; }
.options button, .zoom-button { min-height: 2rem; padding: .25rem .6rem; border-radius: .3rem; font-size: .75rem; }
.options button[aria-pressed='true'] { background: var(--success-surface); color: var(--accent); font-weight: 600; }
.options button:hover, .zoom-button:hover { background: var(--subtle); }
.document-viewport { min-height: 55dvh; max-height: 70dvh; overflow: auto; padding: 1.25rem; background: var(--subtle); border-radius: .5rem; }
.paper { width: max-content; margin-inline: auto; }
.paper :deep(canvas) { display: block; background: white; box-shadow: 0 2px 12px rgb(0 0 0 / .12); }
.page-navigation { display: flex; justify-content: center; align-items: center; gap: 1rem; }
</style>
