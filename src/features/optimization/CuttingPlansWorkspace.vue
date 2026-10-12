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
const workspace = ref<HTMLElement | null>(null)
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
function canContinueRendering(signal: AbortSignal): boolean { return !signal.aborted && !disposed }
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
  if (viewport.value) viewport.value.scrollTop = 0
}
function updateCurrentPage(): void {
  const root = viewport.value
  if (!root || !root.clientHeight) return
  const marker = root.getBoundingClientRect().top + Math.min(root.clientHeight / 4, 160)
  const pages = paper.value?.querySelectorAll<HTMLElement>('[data-pdf-page]')
  if (!pages) return
  for (const element of pages) {
    if (element.getBoundingClientRect().bottom > marker) {
      page.value = Number(element.dataset.pdfPage)
      return
    }
  }
  if (pages.length) page.value = pages.length
}
async function renderPages(): Promise<void> {
  const anchor = page.value
  const oldPage = paper.value?.querySelector<HTMLElement>(`[data-pdf-page="${String(anchor)}"]`)
  const oldHeight = oldPage?.getBoundingClientRect().height ?? 0
  const fraction = oldHeight > 0 && viewport.value && oldPage
    ? Math.max(-1, Math.min(1, (viewport.value.getBoundingClientRect().top - oldPage.getBoundingClientRect().top) / oldHeight)) : 0
  // Keep the current pages readable until the replacement is complete.
  renderVersion += 1; renderController.abort(); renderController = new AbortController()
  if (!pdf || !canRender()) return
  const current = renderVersion
  const document = pdf
  const signal = renderController.signal
  const width = Math.min((viewport.value?.clientWidth || 824) - 24, 900)
  const scale = zoom.value
  const pages = window.document.createDocumentFragment()
  rendering.value = true
  try {
    for (let index = 1; index <= document.pageCount; index += 1) {
      if (!canContinueRendering(signal)) return
      const canvas = window.document.createElement('canvas')
      canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `Cutting document page ${String(index)}`)
      await document.render(index, canvas, width, scale, signal)
      if (!canContinueRendering(signal)) return
      const sheet = window.document.createElement('div')
      sheet.className = 'pdf-page'; sheet.dataset.pdfPage = String(index)
      sheet.append(canvas); pages.append(sheet)
    }
    if (current === renderVersion && !disposed) {
      paper.value?.replaceChildren(pages)
      const target = paper.value?.querySelector<HTMLElement>(`[data-pdf-page="${String(anchor)}"]`)
      if (oldHeight > 0 && target && viewport.value) {
        viewport.value.scrollTop += target.getBoundingClientRect().top - viewport.value.getBoundingClientRect().top + fraction * target.getBoundingClientRect().height
      }
      updateCurrentPage()
    }
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
    generating.value = false
    await nextTick(); await renderPages()
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
watch(zoom, () => { void renderPages() })
function sizeWorkspace(): void {
  const root = workspace.value
  if (!root || disposed) return
  const main = root.closest('main')
  const bottomPadding = main ? Number.parseFloat(getComputedStyle(main).paddingBottom) || 20 : 20
  root.style.height = `${String(Math.max(0, window.innerHeight - root.getBoundingClientRect().top - bottomPadding))}px`
}
onMounted(() => {
  sizeWorkspace()
  window.addEventListener('resize', sizeWorkspace)
  if (typeof ResizeObserver !== 'undefined' && viewport.value) {
    let width = viewport.value.clientWidth
    observer = new ResizeObserver(() => {
      sizeWorkspace()
      const next = viewport.value?.clientWidth ?? 0
      if (next !== width) { width = next; void renderPages() }
    })
    observer.observe(viewport.value)
    if (workspace.value) observer.observe(workspace.value)
  }
})
onBeforeUnmount(() => { disposed = true; generation += 1; observer?.disconnect(); window.removeEventListener('resize', sizeWorkspace); clearDocument() })
</script>
<template>
  <section
    ref="workspace"
    class="document-workspace"
    aria-label="Cutting Plans document workspace"
  >
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
    <div class="document-grid">
      <div class="preview-column">
        <div class="preview-toolbar">
          <span class="text-xs font-medium text-muted">PDF preview</span>
          <output
            aria-label="Current PDF page"
            class="page-indicator"
          >{{ pageCount ? page : 0 }} / {{ pageCount }}</output>
          <div
            class="zoom-controls"
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
          <span
            v-if="generating || rendering"
            role="status"
            class="text-xs text-muted"
          >{{ generating ? 'Generating cutting document…' : 'Rendering pages…' }}</span>
        </div>
        <div
          ref="viewport"
          class="document-viewport"
          tabindex="0"
          role="region"
          aria-label="Scrollable cutting document"
          :aria-busy="generating || rendering"
          @scroll.passive="updateCurrentPage"
        >
          <div
            ref="paper"
            class="paper"
          />
        </div>
      </div>
      <aside
        class="document-settings"
        aria-labelledby="document-settings-title"
      >
        <h2
          id="document-settings-title"
          class="text-base font-semibold"
        >
          Document settings
        </h2>
        <fieldset
          class="setting"
          aria-label="Page size"
        >
          <legend>Paper size</legend>
          <div class="options">
            <button
              v-for="size in ['A4', 'A3'] as const"
              :key="size"
              type="button"
              :aria-pressed="pageSize === size"
              @click="pageSize = size"
            >
              {{ size }}
            </button>
          </div>
        </fieldset>
        <fieldset
          class="setting"
          aria-label="Orientation"
        >
          <legend>Orientation</legend>
          <div class="options">
            <button
              v-for="direction in ['portrait', 'landscape'] as const"
              :key="direction"
              type="button"
              :aria-pressed="orientation === direction"
              @click="orientation = direction"
            >
              {{ direction === 'portrait' ? 'Portrait' : 'Landscape' }}
            </button>
          </div>
        </fieldset>
        <div class="setting">
          <p class="setting-label">
            Scaling
          </p>
          <p class="text-sm">
            Fit to page
          </p>
        </div>
        <div class="document-action">
          <button
            type="button"
            class="button button-primary button-compact w-full"
            :disabled="!bytes || generating"
            @click="download"
          >
            Download PDF
          </button>
        </div>
      </aside>
    </div>
  </section>
</template>
<style scoped>
.document-workspace { width: 100%; max-width: 1440px; margin-inline: auto; min-width: 0; min-height: 0; height: calc(100dvh - 240px); display: flex; flex-direction: column; gap: .5rem; overflow: hidden; }
.document-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 270px; gap: 1.25rem; align-items: start; }
.preview-column { height: 100%; min-height: 0; min-width: 0; display: flex; flex-direction: column; overflow: hidden; border: 1px solid color-mix(in srgb, var(--line) 75%, var(--canvas)); border-radius: .75rem; background: var(--canvas); box-shadow: 0 2px 8px color-mix(in srgb, var(--ink) 4%, transparent); }
.preview-toolbar { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: .65rem; padding: .5rem .9rem; background: color-mix(in srgb, var(--surface) 65%, var(--canvas)); border-bottom: 1px solid var(--line); }
.page-indicator { margin-left: auto; color: var(--muted); font-size: .75rem; font-variant-numeric: tabular-nums; }
.zoom-controls { display: flex; align-items: center; gap: .2rem; padding-left: .65rem; border-left: 1px solid var(--line); }
.zoom-button { width: 1.875rem; height: 1.875rem; border-radius: .35rem; }
.zoom-button:hover:not(:disabled) { background: var(--subtle); }
.zoom-button:disabled { opacity: .4; }
.document-viewport { flex: 1; min-height: 0; overflow: auto; padding: 1.5rem 2rem; background: var(--canvas); scrollbar-gutter: stable; }
.paper { width: max-content; min-width: 100%; display: flex; flex-direction: column; align-items: center; gap: 1.5rem; }
.paper :deep(.pdf-page) { flex: none; background: white; box-shadow: 0 1px 3px rgb(0 0 0 / .07), 0 5px 16px rgb(0 0 0 / .08); }
.paper :deep(canvas) { display: block; }
.document-settings { padding: 1.25rem; background: color-mix(in srgb, var(--surface) 92%, var(--canvas)); border: 1px solid var(--line); border-radius: .75rem; box-shadow: 0 2px 8px color-mix(in srgb, var(--ink) 4%, transparent); }
.setting { margin-top: 1.25rem; min-width: 0; }
.setting legend, .setting-label { margin-bottom: .5rem; font-size: .75rem; color: var(--muted); font-weight: 600; }
.options { display: flex; gap: .25rem; padding: .2rem; background: var(--canvas); border-radius: .45rem; }
.options button { flex: 1; min-height: 2.25rem; padding: .3rem .5rem; border-radius: .3rem; font-size: .8125rem; }
.options button[aria-pressed='true'] { background: var(--surface); color: var(--accent); font-weight: 600; box-shadow: 0 1px 3px rgb(0 0 0 / .08); }
.options button:hover { color: var(--accent); }
.document-action { margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--line); }
@media (max-width: 1000px) { .document-grid { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); gap: .75rem; } .document-settings { grid-row: 1; display: flex; flex-wrap: wrap; gap: .75rem 1.25rem; align-items: center; padding: 1rem; } .document-settings h2 { flex-basis: 100%; } .setting { margin-top: 0; } .document-action { margin: 0 0 0 auto; padding: 0; border: 0; } }
@media (max-width: 640px) { .document-viewport { padding: 1rem; } .paper { gap: 1.25rem; } .document-settings { gap: .75rem 1rem; } }
</style>
