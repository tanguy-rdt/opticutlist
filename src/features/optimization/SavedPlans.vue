<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import type { SavedPlanService } from '../../application/plans/saved-plan-service'
import type { SavedPlanSummary } from '../../domain/model/saved-cutting-plan'
import { persistenceErrorMessage } from '../../shared/ui/persistence-error-message'
import { useCuttingConfirmationService } from '../inventory/cutting-confirmation-service'
import CuttingConfirmation from '../inventory/CuttingConfirmation.vue'

const props = defineProps<{ plans: ReturnType<SavedPlanService['forProject']>; disabled: boolean }>()
const emit = defineEmits<{ open: [summary: SavedPlanSummary]; renamed: [summary: SavedPlanSummary]; deleted: [summary: SavedPlanSummary] }>()
const summaries = shallowRef<readonly SavedPlanSummary[]>([])
const loading = ref(false)
const working = ref(false)
const error = ref('')
const names = ref<Record<string, string>>({})
const cutting = useCuttingConfirmationService()
const confirmationPlan = shallowRef<SavedPlanSummary | null>(null)
const confirmedIds = ref<string[]>([])
const confirmationError = ref('')
let generation = 0
async function refresh(): Promise<void> {
  const current = ++generation
  loading.value = true
  const result = await props.plans.list()
  if (current !== generation) return
  if (result.ok) { summaries.value = result.value; names.value = Object.fromEntries(result.value.map(summary => [summary.id, summary.name])); error.value = '' }
  else error.value = persistenceErrorMessage(result.error, 'Saved plan')
  if (cutting && result.ok && result.value[0]) {
    const receipts = await cutting.forProject(result.value[0].projectId).list()
    if (current !== generation) return
    if (receipts.ok) { confirmedIds.value = receipts.value.map(receipt => receipt.id); confirmationError.value = '' }
    else confirmationError.value = persistenceErrorMessage(receipts.error, 'Saved plan')
  }
  loading.value = false
}
async function rename(summary: SavedPlanSummary): Promise<void> {
  if (working.value || props.disabled || !window.confirm(`Rename saved plan “${summary.name}”?`)) return
  working.value = true
  const result = await props.plans.rename(summary.id, names.value[summary.id] ?? '')
  if (result.ok) { emit('renamed', result.value); await refresh() }
  else error.value = persistenceErrorMessage(result.error, 'Saved plan')
  working.value = false
}
async function remove(summary: SavedPlanSummary): Promise<void> {
  if (working.value || props.disabled || !window.confirm(`Delete saved plan “${summary.name}”? This cannot be undone.`)) return
  working.value = true
  const result = await props.plans.delete(summary.id)
  if (result.ok) { emit('deleted', summary); await refresh() }
  else error.value = persistenceErrorMessage(result.error, 'Saved plan')
  working.value = false
}
onMounted(refresh)
onBeforeUnmount(() => { generation += 1 })
defineExpose({ refresh })
</script>
<template>
  <section
    class="panel space-y-4 p-6"
    aria-labelledby="saved-plans-title"
  >
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2
        id="saved-plans-title"
        class="text-xl font-semibold"
      >
        Saved plans
      </h2>
      <button
        type="button"
        class="button"
        :disabled="disabled || working || loading"
        @click="refresh"
      >
        Refresh saved plans
      </button>
    </div>
    <p
      v-if="loading"
      role="status"
      class="text-muted"
    >
      Loading saved plan summaries…
    </p>
    <p
      v-if="error"
      role="alert"
      class="text-danger"
    >
      {{ error }}
    </p>
    <p
      v-if="!loading && !error && !summaries.length"
      class="text-muted"
    >
      No saved plans in this project.
    </p>
    <ul class="space-y-4">
      <li
        v-for="summary in summaries"
        :key="summary.id"
        class="flex flex-wrap items-end gap-3 border-t border-line pt-4"
      >
        <div class="min-w-48 flex-1 space-y-1">
          <label
            :for="`saved-plan-name-${summary.id}`"
            class="text-sm font-semibold"
          >Saved plan name</label>
          <input
            :id="`saved-plan-name-${summary.id}`"
            v-model="names[summary.id]"
            class="field"
            :disabled="disabled || working"
            :aria-label="`Rename ${summary.name}`"
          >
          <p class="text-sm text-muted">
            Created {{ new Date(summary.createdAt).toLocaleString() }}
          </p>
          <p
            v-if="confirmedIds.includes(summary.id)"
            class="text-sm text-success"
          >
            Cutting confirmed · Inventory movements recorded
          </p>
        </div>
        <button
          type="button"
          class="button button-primary"
          :disabled="disabled || working"
          :aria-label="`Open plan ${summary.name}`"
          @click="emit('open', summary)"
        >
          Open Plan
        </button>
        <button
          type="button"
          class="button"
          :disabled="disabled || working"
          :aria-label="`Rename plan ${summary.name}`"
          @click="rename(summary)"
        >
          Rename
        </button>
        <button
          type="button"
          class="button button-danger"
          :disabled="disabled || working || confirmedIds.includes(summary.id)"
          :aria-label="`Delete plan ${summary.name}`"
          @click="remove(summary)"
        >
          Delete
        </button>
        <button
          v-if="cutting"
          type="button"
          class="button"
          :disabled="disabled || working || !!confirmationError || confirmedIds.includes(summary.id)"
          :aria-label="`Confirm cutting ${summary.name}`"
          @click="confirmationPlan = summary"
        >
          Confirm Cutting
        </button>
      </li>
    </ul>
    <p
      v-if="confirmationError"
      role="alert"
      class="text-danger"
    >
      {{ confirmationError }}
    </p>
    <CuttingConfirmation
      v-if="cutting && confirmationPlan"
      :key="confirmationPlan.id"
      :service="cutting.forProject(confirmationPlan.projectId)"
      :summary="confirmationPlan"
      @close="confirmationPlan = null"
      @confirmed="refresh"
    />
  </section>
</template>
