<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { stockMatchesPanel, type CuttingConfirmationService, type CuttingPreview } from '../../application/inventory/cutting-confirmation-service'
import type { SavedPlanSummary } from '../../domain/model/saved-cutting-plan'
import { confirmCuttingInputSchema } from '../../domain/model/cutting-confirmation'
import { persistenceErrorMessage } from '../../shared/ui/persistence-error-message'
import FormField from '../../shared/ui/FormField.vue'

const props = defineProps<{ service: ReturnType<CuttingConfirmationService['forProject']>; summary: SavedPlanSummary; embedded?: boolean }>()
const emit = defineEmits<{ close: []; confirmed: []; working: [value: boolean] }>()
const preview = shallowRef<CuttingPreview | null>(null)
const loading = ref(true)
const working = ref(false)
const error = ref('')
const review = ref(false)
const assignments = ref<Record<number, string>>({})
const selected = ref<string[]>([])
let active = true
const panels = computed(() => preview.value?.saved.plan.panels.map((allocation, index) => ({ index, source: preview.value?.saved.contents.sources.find(source => source.product.id === allocation.supplierProductId) })) ?? [])
function options(index: number) {
  const source = panels.value[index]?.source
  return preview.value?.stock.filter(stock => {
    try {
      return source !== undefined && stockMatchesPanel(stock, source.product)
    } catch { return false }
  }) ?? []
}
const ready = computed(() => panels.value.length > 0 && panels.value.every(panel => !!assignments.value[panel.index])
  && Object.entries(assignments.value).every(([index, id]) => options(Number(index)).some(stock => stock.id === id))
  && preview.value?.stock.every(stock => Object.values(assignments.value).filter(id => id === stock.id).length <= stock.quantity))
const kept = computed(() => preview.value?.offcuts.filter(item => selected.value.includes(`${String(item.panelIndex)}:${String(item.wasteIndex)}`)) ?? [])
async function load(): Promise<void> {
  loading.value = true;
  error.value = ''
  const result = await props.service.preview(props.summary.id)
  if (!active) return
  if (result.ok) preview.value = result.value
  else error.value = persistenceErrorMessage(result.error, 'Saved plan')
  loading.value = false
}
async function confirm(): Promise<void> {
  if (working.value || !ready.value || !review.value
    || !window.confirm('Confirm physical cutting? Deduct the selected stock and keep only the checked offcuts. This cannot be undone.')) return
  working.value = true;
  emit('working', true);
  error.value = ''
  const input = confirmCuttingInputSchema.parse({
    confirmed: true,
    assignments: panels.value.map(panel => ({ panelIndex: panel.index, stockItemId: assignments.value[panel.index] })),
    offcuts: kept.value.map(item => ({ panelIndex: item.panelIndex, wasteIndex: item.wasteIndex }))
  })
  const result = await props.service.confirm(props.summary.id, input)
  if (!active) return
  if (result.ok) {
    if (preview.value) preview.value = { ...preview.value, confirmation: result.value };
    emit('confirmed')
  }
  else {
    error.value = persistenceErrorMessage(result.error, 'Saved plan');
    review.value = false
  }
  working.value = false;
  emit('working', false)
}
onMounted(load)
onBeforeUnmount(() => { active = false })
</script>
<template>
  <section
    class="panel space-y-5 p-6"
    aria-labelledby="cutting-confirm-title"
  >
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h3
        id="cutting-confirm-title"
        class="text-xl font-semibold"
      >
        Inventory confirmation
      </h3>
      <button
        v-if="!embedded"
        class="button"
        type="button"
        :disabled="working"
        @click="emit('close')"
      >
        Close confirmation
      </button>
    </div>
    <p class="text-muted">
      This records physical cutting of the automatically persisted layouts. Catalogue products are not owned stock.
    </p>
    <p
      v-if="loading"
      role="status"
    >
      Loading validated plan and owned stock…
    </p>
    <p
      v-if="error"
      role="alert"
      class="text-danger"
    >
      {{ error }}
    </p>
    <button
      v-if="!preview && !loading"
      class="button"
      type="button"
      @click="load"
    >
      Retry confirmation
    </button>
    <p
      v-if="preview?.confirmation"
      role="status"
      class="text-success"
    >
      Cutting confirmed on {{ new Date(preview.confirmation.confirmedAt).toLocaleString() }}. Inventory movements are recorded; this plan cannot be confirmed again.
    </p>
    <template v-else-if="preview">
      <p
        v-if="!panels.length"
        role="status"
      >
        This plan has no panels to cut.
      </p>
      <fieldset
        :disabled="working || review"
        class="space-y-4"
      >
        <legend class="font-semibold">
          Identify owned panels
        </legend>
        <div
          v-for="panel in panels"
          :key="panel.index"
          class="space-y-2"
        >
          <p>Panel {{ panel.index + 1 }} · {{ panel.source?.product.name }} · {{ panel.source?.materialName }} · {{ panel.source?.product.lengthMm }} × {{ panel.source?.product.widthMm }} × {{ panel.source?.product.thicknessMm }} mm · Grain {{ panel.source?.product.grainDirection }}</p>
          <FormField
            :id="`cutting-stock-${panel.index}`"
            label="StockItem to consume"
            required
          >
            <template #default="{ controlAttrs }">
              <select
                v-bind="controlAttrs"
                v-model="assignments[panel.index]"
                class="field"
              >
                <option value="">
                  Select matching owned stock
                </option>
                <option
                  v-for="stock in options(panel.index)"
                  :key="stock.id"
                  :value="stock.id"
                >
                  {{ stock.id }} · {{ stock.kind }} · {{ stock.quantity }} available
                </option>
              </select>
            </template>
          </FormField>
          <p
            v-if="!options(panel.index).length"
            class="text-muted"
          >
            No matching owned stock. Exact material, thickness, dimensions and grain are required.
          </p>
        </div>
        <h4 class="font-semibold">
          Reusable offcuts — optional
        </h4>
        <p class="text-muted">
          Nothing is selected initially. Leave all unchecked to keep no offcuts. Only rectangular waste leaves are candidates; kerf and trimmed margins are excluded.
        </p>
        <p
          v-if="!preview.offcuts.length"
          class="text-muted"
        >
          No reusable offcut candidates.
        </p>
        <label
          v-for="candidate in preview.offcuts"
          :key="`${candidate.panelIndex}:${candidate.wasteIndex}`"
          class="flex items-center gap-3"
        >
          <input
            v-model="selected"
            type="checkbox"
            :value="`${candidate.panelIndex}:${candidate.wasteIndex}`"
          >
          Panel {{ candidate.panelIndex + 1 }} · Offcut {{ candidate.wasteIndex + 1 }} · {{ candidate.materialName }} · {{ candidate.region.lengthMm }} × {{ candidate.region.widthMm }} × {{ candidate.panel.thicknessMm }} mm · Grain {{ candidate.panel.grainDirection }}
        </label>
      </fieldset>
      <p
        v-if="!ready && panels.length"
        class="text-muted"
      >
        Choose stock for every panel without exceeding its available quantity.
      </p>
      <button
        v-if="!review"
        class="button button-primary"
        type="button"
        :disabled="!ready || working"
        @click="review = true"
      >
        Review inventory changes
      </button>
      <div
        v-else
        class="space-y-3 border-t border-line pt-4"
      >
        <h4 class="font-semibold">
          Final inventory summary
        </h4>
        <ul>
          <li
            v-for="stock in preview.stock.filter(stock => Object.values(assignments).includes(stock.id))"
            :key="stock.id"
          >
            Consume {{ Object.values(assignments).filter(id => id === stock.id).length }} from {{ stock.id }} ({{ stock.quantity }} available).
          </li>
        </ul>
        <p>Keep {{ kept.length }} selected offcuts{{ kept.length ? ':' : '. No offcuts will be added.' }}</p>
        <ul>
          <li
            v-for="item in kept"
            :key="`${item.panelIndex}:${item.wasteIndex}`"
          >
            Panel {{ item.panelIndex + 1 }} · {{ item.materialName }} · {{ item.region.lengthMm }} × {{ item.region.widthMm }} × {{ item.panel.thicknessMm }} mm
          </li>
        </ul>
        <button
          class="button"
          type="button"
          :disabled="working"
          @click="review = false"
        >
          Back to selection
        </button>
        <button
          class="button button-primary"
          type="button"
          :disabled="working"
          @click="confirm"
        >
          {{ working ? 'Confirming…' : 'Confirm Cutting' }}
        </button>
      </div>
    </template>
  </section>
</template>
