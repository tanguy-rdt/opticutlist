<script setup lang="ts">
import { onBeforeUnmount, ref, toRaw, watch } from 'vue'
import type { PdfOrientation } from '../../application/export/cutting-plan-pdf-service'
import type { CuttingSettings } from '../../domain/model/cutting-settings'
import type { Part } from '../../domain/model/part'
import type { SupplierProduct } from '../../domain/model/supplier-product'
import type { PanelCuttingPlan } from '../../domain/optimizer/plan-with-strategy'
import FormField from '../../shared/ui/FormField.vue'
import { downloadCuttingPlanPdf, useCuttingPlanPdfService } from './pdf-export-service'

const props = defineProps<{ plan: PanelCuttingPlan; panel: SupplierProduct; parts: readonly Part[]; settings: CuttingSettings; materialName: string; edited: boolean }>()
const service = useCuttingPlanPdfService()
const orientation = ref<PdfOrientation>('landscape')
const exporting = ref(false)
const error = ref('')
const feedback = ref('')
let generation = 0
watch([() => props.plan, () => props.panel, () => props.parts, () => props.settings, orientation], () => {
  generation += 1; exporting.value = false; error.value = ''; feedback.value = ''
}, { flush: 'sync' })
onBeforeUnmount(() => { generation += 1 })
async function exportPdf(): Promise<void> {
  if (exporting.value || service === undefined) return
  const current = ++generation
  exporting.value = true; error.value = ''; feedback.value = ''
  try {
    const result = await service.export({ plan: toRaw(props.plan), panel: toRaw(props.panel), parts: toRaw(props.parts), settings: toRaw(props.settings), materialName: props.materialName, orientation: orientation.value, edited: props.edited })
    if (current !== generation) return
    if (!result.ok) { error.value = `PDF export failed: ${result.error.message}`; return }
    downloadCuttingPlanPdf(result.bytes)
    feedback.value = 'PDF download started. The exported plan was independently validated.'
  } catch (cause) {
    if (current === generation) error.value = cause instanceof Error ? `PDF export failed: ${cause.message}` : 'PDF export failed. Try again.'
  } finally { if (current === generation) exporting.value = false }
}
</script>
<template>
  <section
    class="space-y-3 rounded-lg border border-line bg-surface p-4"
    aria-label="Vector PDF export"
  >
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
        :aria-busy="exporting"
        aria-describedby="pdf-export-help"
        @click="exportPdf"
      >
        {{ exporting ? 'Generating PDF…' : 'Export PDF' }}
      </button>
    </div>
    <p
      id="pdf-export-help"
      class="text-sm text-muted"
    >
      Exports the currently displayed plan, including accepted edits, as vector graphics. Complete part details follow the layout page.
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
  </section>
</template>
