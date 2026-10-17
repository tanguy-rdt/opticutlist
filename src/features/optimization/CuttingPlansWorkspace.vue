<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, toRaw, watch } from 'vue'
import { pdfSettingsSchema, type PdfSettings } from '../../domain/model/pdf-settings'
import FormField from '../../shared/ui/FormField.vue'
import AppButton from '../../shared/ui/AppButton.vue'
import AppIcon from '../../shared/ui/AppIcon.vue'
import { useToastStore } from '../../shared/ui/toast-store'
import { openPdfPrintView, type PdfPrintView } from './pdf-print-view'
import type { PdfOrientation, PdfPageSize } from '../../application/export/cutting-plan-pdf-service'
import type { SavePlanInput } from '../../application/plans/saved-plan-service'
import { readCoverImage, downloadCuttingPlanPdf, useCuttingPlanPdfService } from './pdf-export-service'
import { loadPdfPreview, type PdfPreviewDocument } from './pdf-preview'

const props = defineProps<{ input: SavePlanInput; title: string; settings?: PdfSettings; settingsError?: string }>()
const emit = defineEmits<{ settingsChange: [settings: PdfSettings] }>()
const configuration = ref<PdfSettings>(pdfSettingsSchema.parse(props.settings ?? {}))
const imageError = ref('')
const imageBusy = ref(false)
const imageInput = ref<HTMLInputElement | null>(null)
let imageRevision = 0
const coverImageUrl = computed(() => configuration.value.coverImage ? `data:${configuration.value.coverImage.mimeType};base64,${configuration.value.coverImage.data}` : undefined)
function updateSettings(next: PdfSettings): void {
  const parsed = pdfSettingsSchema.safeParse(next)
  if (!parsed.success) { imageError.value = parsed.error.issues.map(issue => issue.message).join('; '); return }
  imageError.value = ''; configuration.value = parsed.data; emit('settingsChange', parsed.data)
}
function updateText(event: Event, field: 'titleOverride' | 'description'): void {
  if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) return
  const next = { ...configuration.value }
  const value = event.target.value.trim()
  if (!value || (field === 'titleOverride' && value === props.title)) {
    if (field === 'titleOverride') delete next.titleOverride
    else delete next.description
  }
  else next[field] = value
  updateSettings(next)
  if (field === 'titleOverride' && !next.titleOverride) event.target.value = props.title
}
async function selectImage(event: Event): Promise<void> {
  if (!(event.target instanceof HTMLInputElement)) return
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  const current = ++imageRevision
  imageBusy.value = true; imageError.value = ''
  try {
    const image = await readCoverImage(file)
    if (!disposed && current === imageRevision) updateSettings({ ...configuration.value, coverImage: image })
  } catch (cause) { if (!disposed && current === imageRevision) imageError.value = cause instanceof Error ? cause.message : 'Could not read this image.' }
  finally { if (current === imageRevision) imageBusy.value = false }
}
function removeImage(): void {
  imageRevision++; imageBusy.value = false
  const next = { ...configuration.value }; delete next.coverImage
  updateSettings(next)
}
watch(() => props.settings, settings => {
  if (JSON.stringify(settings ?? {}) !== JSON.stringify(configuration.value)) configuration.value = pdfSettingsSchema.parse(settings ?? {})
})

const service = useCuttingPlanPdfService()
const pageSize = computed<PdfPageSize>(() => configuration.value.pageSize ?? 'A4')
const orientation = computed<PdfOrientation>(() => configuration.value.orientation ?? 'portrait')
const page = ref(1)
const pageCount = ref(0)
const zoom = ref(1)
const generating = ref(false)
const rendering = ref(false)
const error = ref('')
const action = ref<'download' | 'print' | null>(null)
const toasts = useToastStore()
let pendingPrint: PdfPrintView | null = null
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
async function regenerate(): Promise<Uint8Array<ArrayBuffer> | null> {
  const current = ++generation
  clearDocument(); error.value = ''; page.value = 1; generating.value = true
  const signal = loading.signal
  if (!service) { error.value = 'PDF generation is unavailable.'; generating.value = false; return null }
  try {
    const result = await service.exportProject({ ...toRaw(props.input), title: props.title, cover: {
      ...(configuration.value.titleOverride ? { title: configuration.value.titleOverride } : {}),
      ...(configuration.value.description ? { description: configuration.value.description } : {}),
      ...(configuration.value.coverImage ? { image: toRaw(configuration.value.coverImage) } : {}),
    }, pageSize: pageSize.value, orientation: orientation.value })
    if (!isCurrent(current)) return null
    if (!result.ok) { error.value = result.error.message; return null }
    bytes.value = result.bytes
    const loaded = await loadPdfPreview(result.bytes, signal)
    if (!isCurrent(current)) { await loaded.destroy(); return null }
    pdf = loaded; pageCount.value = loaded.pageCount
    generating.value = false
    await nextTick(); await renderPages()
  } catch (cause) {
    if (isCurrent(current)) error.value = cause instanceof Error ? cause.message : 'Could not prepare the cutting document.'
  } finally { if (current === generation) generating.value = false }
  return isCurrent(current) ? bytes.value : null
}
async function exportPdf(kind: 'download' | 'print'): Promise<void> {
  if (action.value || generating.value || !service) return
  action.value = kind
  let viewer: PdfPrintView | null = null
  try {
    if (kind === 'print') { viewer = openPdfPrintView(); pendingPrint = viewer }
    const document = await regenerate()
    if (disposed) return
    if (!document) throw new Error(error.value || 'The document changed while preparing it. Try again.')
    if (viewer) viewer.show(document)
    else downloadCuttingPlanPdf(document)
    pendingPrint = null
  } catch (cause) {
    viewer?.close()
    if (!disposed) toasts.error(kind === 'print' ? 'Could not prepare PDF for printing' : 'Could not download PDF', cause instanceof Error ? cause.message : 'Try again. If the problem continues, reload the document.')
  } finally {
    if (disposed) viewer?.close()
    pendingPrint = null; action.value = null
  }
}
watch([() => props.input, () => props.title, configuration], () => { void regenerate() }, { immediate: true, deep: true })
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
onBeforeUnmount(() => { disposed = true; pendingPrint?.close(); generation += 1; observer?.disconnect(); window.removeEventListener('resize', sizeWorkspace); clearDocument() })
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
        <section
          class="cover-settings settings-section"
          aria-labelledby="cover-page-title"
        >
          <h3
            id="cover-page-title"
            class="text-sm font-semibold"
          >
            Cover page
          </h3>
          <FormField
            id="pdf-document-title"
            label="Document title"
          >
            <template #default="{ controlAttrs }">
              <input
                v-bind="controlAttrs"
                :value="configuration.titleOverride ?? title"
                maxlength="300"
                class="field field-small"
                @change="updateText($event, 'titleOverride')"
              >
            </template>
          </FormField>
          <FormField
            id="pdf-description"
            label="Description"
          >
            <template #default="{ controlAttrs }">
              <textarea
                v-bind="controlAttrs"
                :value="configuration.description ?? ''"
                maxlength="2000"
                rows="4"
                class="field"
                @change="updateText($event, 'description')"
              />
            </template>
          </FormField>
          <FormField
            id="pdf-cover-image-picker"
            label="Cover image"
            :error="imageError"
          >
            <template #default="{ controlAttrs }">
              <input
                id="pdf-cover-image"
                ref="imageInput"
                type="file"
                accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                class="hidden"
                aria-hidden="true"
                tabindex="-1"
                :disabled="imageBusy"
                @change="selectImage"
              >
              <div
                v-if="coverImageUrl"
                class="cover-image-preview"
              >
                <img
                  :src="coverImageUrl"
                  alt="Selected cover image"
                  class="cover-image-thumbnail"
                  @error="imageError = 'The saved cover image cannot be displayed. Replace or remove it.'"
                >
                <div class="cover-image-actions">
                  <AppButton
                    v-bind="controlAttrs"
                    size="small"
                    label="Replace cover image"
                    :disabled="imageBusy"
                    @click="imageInput?.click()"
                  >
                    Replace
                  </AppButton>
                  <AppButton
                    size="small"
                    variant="ghost"
                    label="Remove cover image"
                    @click="removeImage"
                  >
                    Remove
                  </AppButton>
                </div>
              </div>
              <AppButton
                v-else
                v-bind="controlAttrs"
                size="small"
                :disabled="imageBusy"
                @click="imageInput?.click()"
              >
                Choose image
              </AppButton>
            </template>
          </FormField>
          <p
            v-if="imageBusy"
            role="status"
            class="text-xs text-muted"
          >
            Reading image…
          </p>
          <div
            v-if="settingsError"
            role="alert"
            class="text-xs text-danger"
          >
            {{ settingsError }}
            <AppButton
              size="small"
              @click="emit('settingsChange', configuration)"
            >
              Retry save
            </AppButton>
          </div>
        </section>
        <section
          class="page-layout settings-section"
          aria-labelledby="page-layout-title"
        >
          <h3
            id="page-layout-title"
            class="text-sm font-semibold"
          >
            Page layout
          </h3>
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
                @click="updateSettings({ ...configuration, pageSize: size })"
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
                @click="updateSettings({ ...configuration, orientation: direction })"
              >
                {{ direction === 'portrait' ? 'Portrait' : 'Landscape' }}
              </button>
            </div>
          </fieldset>
        </section>
        <div class="document-action">
          <AppButton
            size="small"
            variant="secondary"
            class="print-action"
            :label="action === 'print' ? 'Preparing…' : 'Print'"
            :disabled="generating || action !== null || !service"
            :loading="action === 'print'"
            @click="exportPdf('print')"
          >
            <AppIcon
              v-if="action !== 'print'"
              name="printer"
            />
            <span class="action-label">{{ action === 'print' ? 'Preparing…' : 'Print' }}</span>
          </AppButton>
          <AppButton
            variant="primary"
            size="small"
            class="download-action"
            :label="action === 'download' ? 'Generating PDF…' : 'Download PDF'"
            :disabled="generating || action !== null || !service"
            :loading="action === 'download'"
            @click="exportPdf('download')"
          >
            <AppIcon
              v-if="action !== 'download'"
              name="export"
            />
            <span class="action-label">{{ action === 'download' ? 'Generating PDF…' : 'Download PDF' }}</span>
          </AppButton>
          <span
            class="sr-only"
            role="status"
          >{{ action === 'download' ? 'Generating PDF…' : action === 'print' ? 'Preparing PDF for printing…' : '' }}</span>
        </div>
      </aside>
    </div>
  </section>
</template>
<style scoped>
.document-workspace { width: 100%; max-width: 1440px; margin-inline: auto; min-width: 0; min-height: 0; height: calc(100dvh - 240px); display: flex; flex-direction: column; gap: .5rem; overflow: hidden; }
.document-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 270px; grid-template-rows: minmax(0, 1fr); gap: 1.25rem; align-items: start; }
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
.document-settings { min-width: 0; max-height: 100%; overflow-y: auto; padding: 1rem; background: var(--surface); border: 1px solid var(--line); border-radius: .75rem; }
.settings-section { display: grid; gap: .875rem; min-width: 0; }
.cover-settings { margin-top: 1rem; }
.page-layout { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--line); }
.document-settings :deep(label), .setting legend { font-size: .75rem; color: var(--muted); font-weight: 600; }
.cover-settings textarea.field { min-height: 6.5rem; line-height: 1.5; resize: vertical; }
.cover-image-preview { display: flex; align-items: center; gap: .75rem; min-width: 0; }
.cover-image-thumbnail { flex: none; width: 4rem; height: 4rem; object-fit: contain; padding: .2rem; border: 1px solid var(--line); border-radius: var(--control-radius); background: var(--quiet-surface); }
.cover-image-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .25rem; min-width: 0; }
.cover-image-actions .button { padding-inline: .5rem; font-size: .75rem; }
.setting { min-width: 0; }
.setting legend { margin-bottom: .375rem; }
.options { display: flex; gap: .25rem; padding: .2rem; background: var(--canvas); border-radius: .45rem; }
.options button { flex: 1; height: var(--control-height-small); min-height: var(--control-height-small); padding: .3rem .5rem; border-radius: var(--control-radius); font-size: .8125rem; }
.options button[aria-pressed='true'] { background: var(--surface); color: var(--accent); font-weight: 600; box-shadow: 0 1px 3px rgb(0 0 0 / .08); }
.options button:hover { color: var(--accent); }
.document-action { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: center; gap: .5rem; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--line); }
.document-action .button { width: 100%; min-width: 0; padding-inline: .25rem; gap: .25rem; font-size: .75rem; white-space: nowrap; }
.action-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 1000px) { .document-grid { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); gap: .75rem; } .document-settings { grid-row: 1; max-height: min(45dvh, 24rem); } }
@media (max-width: 640px) { .document-viewport { padding: 1rem; } .paper { gap: 1.25rem; } }
</style>
