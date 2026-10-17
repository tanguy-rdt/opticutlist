<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRaw } from 'vue'
import type { SavePlanInput } from '../../application/plans/saved-plan-service'
import { prepareProjectPdfDocument } from '../../application/export/cutting-plan-pdf-service'
import type { CuttingConfirmationService } from '../../application/inventory/cutting-confirmation-service'
import type { SavedPlanSummary } from '../../domain/model/saved-cutting-plan'
import CuttingConfirmation from '../inventory/CuttingConfirmation.vue'
import PdfExportControls from './PdfExportControls.vue'

const props = defineProps<{
  input: SavePlanInput;
  summary: SavedPlanSummary | null;
  cutting: ReturnType<CuttingConfirmationService['forProject']> | undefined;
  inventoryProblem: string;
  embedded?: boolean
}>()
const emit = defineEmits<{ close: []; confirmed: []; working: [value: boolean] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const working = ref(false)
const document = computed(() => prepareProjectPdfDocument({ ...toRaw(props.input), title: 'Project cutting result', orientation: 'landscape' }))
const reasons = {
  noCompatiblePanel: 'No compatible selected panel',
  constraintsPreventPlacement: 'Dimensions, grain, rotation, kerf or margins prevent placement',
  panelLimitReached: 'Insufficient panel quantity or remaining usable space'
}
let previousFocus: HTMLElement | null = null

function close(): void {
  if (!working.value) {
    emit('close')
  }
}

onMounted(() => {
  if (props.embedded) {
    return
  }
  previousFocus = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null
  if (typeof dialog.value?.showModal === 'function') {
    dialog.value.showModal()
  } else if (dialog.value) {
    dialog.value.open = true;
    dialog.value.querySelector('button')?.focus()
  }
})
onBeforeUnmount(() => {
  if (props.embedded) {
    return;
  }
  if (typeof dialog.value?.close === 'function') {
    dialog.value.close();
  }
  previousFocus?.focus()
})
</script>
<template>
  <component
    :is="embedded ? 'section' : 'dialog'"
    ref="dialog"
    class="cutting-export text-ink"
    :class="embedded ? 'space-y-3' : 'panel m-auto max-h-[90dvh] w-full max-w-5xl space-y-6 overflow-y-auto p-6 backdrop:bg-canvas/80'"
    :aria-labelledby="embedded ? undefined : 'finalization-title'"
    @cancel.prevent="close"
  >
    <div
      v-if="!embedded"
      class="flex items-start justify-between gap-4"
    >
      <h2
        id="finalization-title"
        class="text-2xl font-semibold"
      >
        Finalize cutting
      </h2>
      <button
        type="button"
        class="button"
        :disabled="working"
        @click="close"
      >
        Close finalization
      </button>
    </div>
    <p
      v-if="!document.ok"
      role="alert"
      class="text-danger"
    >
      This result is invalid and cannot be finalized: {{ document.error.message }}
    </p>
    <template v-else>
      <PdfExportControls
        :input="input"
        title="Project cutting result"
        :workspace="embedded"
      >
        <template #sidebar>
          <section
            class="space-y-2 border-t border-line pt-3 text-xs"
            aria-label="Complete cutting result summary"
          >
            <p class="font-semibold">
              {{ document.document.panels.length }} panels · {{ document.document.metrics.placedCount }} copies placed · {{ document.document.metrics.unplacedCount }} copies unplaced
            </p>
            <p
              v-if="document.document.metrics.unplacedCount"
              role="alert"
              class="text-danger"
            >
              Incomplete optimization. These layouts do not produce all requested parts. Confirming cutting records only the panels shown here.
            </p>
            <p
              v-else
              class="text-success"
            >
              All requested copies are placed.
            </p>
            <p>Utilization {{ document.document.metrics.utilizationPercent.toFixed(2) }}% · Waste {{ document.document.metrics.wasteAreaMm2.toLocaleString() }} mm² (including kerf and margins).</p>
            <ul class="space-y-2">
              <li
                v-for="(panel, index) in document.document.panels"
                :key="index"
              >
                Panel {{ index + 1 }} · {{ panel.panel.name }} · {{ panel.materialName }} · {{ panel.panel.lengthMm }} × {{ panel.panel.widthMm }} × {{ panel.panel.thicknessMm }} mm · Grain {{ panel.panel.grainDirection }} · Kerf {{ panel.settings.kerfMm }} mm · Margin {{ panel.settings.edgeMarginMm }} mm{{ panel.edited ? ' · Accepted manual edits' : '' }}
              </li>
            </ul>
            <div
              v-if="document.document.unplaced.length"
              class="space-y-2"
            >
              <h3 class="font-semibold">
                Unplaced parts
              </h3>
              <ul>
                <li
                  v-for="item in document.document.unplaced"
                  :key="`${item.partId}-${item.firstCopyIndex}`"
                >
                  {{ input.parts.find(part => part.id === item.partId)?.name ?? item.partId }} · {{ item.count }} copies · {{ reasons[item.reason] }}
                </li>
              </ul>
            </div>
          </section>

          <p class="text-sm text-muted">
            PDF export is independent of inventory confirmation. Catalogue panels describe purchasable products, not owned stock. Previously recorded movements and offcuts will not be reversed or reconciled by this operation.
          </p>
          <p
            v-if="inventoryProblem"
            role="status"
            class="text-muted"
          >
            Inventory confirmation unavailable: {{ inventoryProblem }} PDF generation remains available.
          </p>
          <CuttingConfirmation
            v-else-if="cutting && summary"
            :service="cutting"
            :summary="summary"
            embedded
            @working="working = $event; emit('working', $event)"
            @confirmed="emit('confirmed')"
          />
          <section
            class="border-t border-line pt-3 text-xs text-muted"
            aria-label="Export formats"
          >
            <h3 class="font-medium text-ink">
              Formats
            </h3><p>Vector PDF is currently supported.</p>
          </section>
        </template>
      </PdfExportControls>
    </template>
  </component>
</template>

<style scoped>
.cutting-export :deep(.panel[aria-labelledby='cutting-confirm-title']) { border: 0; padding: 0; border-radius: 0; font-size: 0.875rem; }
.cutting-export :deep(.panel[aria-labelledby='cutting-confirm-title'] h3) { font-size: 1rem; }
</style>
