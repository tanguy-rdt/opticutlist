<script setup lang="ts">
import { onBeforeUnmount, onDeactivated, ref, toRaw, watch } from 'vue'
import type { PdfOrientation } from '../../application/export/cutting-plan-pdf-service'
import type { SavePlanInput } from '../../application/plans/saved-plan-service'
import FormField from '../../shared/ui/FormField.vue'
import AppButton from '../../shared/ui/AppButton.vue'
import { downloadCuttingPlanPdf, useCuttingPlanPdfService } from './pdf-export-service'

const props = defineProps<{ input: SavePlanInput; title: string; workspace?: boolean }>()
const service = useCuttingPlanPdfService()
const orientation = ref<PdfOrientation>('portrait')
const exporting = ref(false)
const error = ref('')
const feedback = ref('')
const previewUrl = ref('')
function clearPreview(): void {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = ''
}
let generation = 0
watch([() => props.input, () => props.title, orientation], () => {
  generation += 1;
  clearPreview();
  exporting.value = false;
  error.value = '';
  feedback.value = ''
}, { flush: 'sync' })
onBeforeUnmount(() => {
  generation += 1;
  clearPreview()
})
onDeactivated(() => {
  generation += 1;
  clearPreview();
  exporting.value = false
})
async function exportPdf(download: boolean): Promise<void> {
  if (exporting.value || service === undefined) return
  const current = ++generation
  exporting.value = true;
  error.value = '';
  feedback.value = ''
  try {
    const result = await service.exportProject({ ...toRaw(props.input), title: props.title, orientation: orientation.value })
    if (current !== generation) return
    if (!result.ok) {
      error.value = `PDF export failed: ${result.error.message}`;
      return
    }
    clearPreview()
    previewUrl.value = URL.createObjectURL(new Blob([result.bytes], { type: 'application/pdf' }))
    if (download) downloadCuttingPlanPdf(result.bytes)
    if (!download) feedback.value = 'Complete PDF preview generated. Inventory is unchanged.'
  } catch (cause) {
    if (current === generation) error.value = cause instanceof Error ? `PDF export failed: ${cause.message}` : 'PDF export failed. Try again.'
  } finally { if (current === generation) exporting.value = false }
}
</script>
<template>
  <section
    class="pdf-export space-y-3"
    :class="workspace ? 'export-grid' : 'rounded-lg border border-line bg-surface p-4'"
    aria-label="Complete vector PDF export"
  >
    <div :class="workspace ? 'export-sidebar panel space-y-4 p-4' : 'space-y-3'">
      <h2
        v-if="workspace"
        class="text-sm font-semibold"
      >
        Document export
      </h2>
      <div class="flex flex-wrap items-end gap-3">
        <FormField
          id="pdf-page-orientation"
          label="PDF page"
        >
          <template #default="{ controlAttrs }">
            <select
              v-bind="controlAttrs"
              v-model="orientation"
              class="field"
              :disabled="exporting"
            >
              <option value="landscape">
                A4 landscape
              </option>
              <option value="portrait">
                A4 portrait
              </option>
            </select>
          </template>
        </FormField>
        <button
          type="button"
          class="button"
          :disabled="exporting || service === undefined"
          @click="exportPdf(false)"
        >
          Preview PDF
        </button>
        <AppButton
          :disabled="service === undefined"
          :loading="exporting"
          aria-describedby="pdf-export-help"
          @click="exportPdf(true)"
        >
          {{ exporting ? 'Generating PDF…' : 'Export PDF' }}
        </AppButton>
      </div>
      <p
        id="pdf-export-help"
        class="text-sm text-muted"
      >
        One vector document includes the global summary, all panel layouts and accepted edits. PDF generation and preview never change inventory.
      </p>
      <p
        v-if="service === undefined"
        role="status"
        class="text-sm text-muted"
      >
        PDF export is unavailable.
      </p>
      <p
        v-if="error"
        role="alert"
        class="text-danger"
      >
        {{ error }}
      </p>
      <p
        v-if="feedback"
        role="status"
        class="text-success"
      >
        {{ feedback }}
      </p>
      <slot name="sidebar" />
    </div>
    <div :class="workspace ? 'export-preview panel min-w-0 p-3' : ''">
      <object
        v-if="previewUrl"
        :data="previewUrl"
        type="application/pdf"
        class="h-[70dvh] min-h-96 w-full rounded-lg border border-line"
        aria-label="Complete cutting document preview"
      >
        <p>Your browser cannot display a PDF preview. Use Export PDF to open the complete document in a PDF reader.</p>
      </object>
      <p
        v-if="workspace && !previewUrl"
        class="flex min-h-96 items-center justify-center p-8 text-center text-sm text-muted"
      >
        Use Preview PDF to view the complete cutting document. No inventory changes are made.
      </p>
    </div>
  </section>
</template>

<style scoped>
.export-grid { display: grid; gap: 1rem; align-items: start; }
.export-grid > * { margin: 0; }
.export-preview { grid-row: 1; }
@media (min-width: 1024px) {
  .export-grid { grid-template-columns: minmax(0, 1fr) 340px; }
  .export-preview { grid-column: 1; }
  .export-sidebar { grid-column: 2; grid-row: 1; }
}
</style>
