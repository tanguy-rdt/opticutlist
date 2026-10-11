<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { Part } from '../../domain/model/part'
import type { PanelSnapshot } from '../../domain/model/saved-cutting-plan'
import type { CuttingSettings } from '../../domain/model/cutting-settings'
import type { AllocatedPanel } from '../../domain/optimizer/project-plan'
import type { PanelCuttingPlan } from '../../domain/optimizer/plan-with-strategy'
import CuttingPlanViewer from './CuttingPlanViewer.vue'

const props = defineProps<{ allocation: AllocatedPanel; panel: PanelSnapshot; parts: readonly Part[]; settings: CuttingSettings; materialName: string; savedEdited?: boolean; savedBaseline?: boolean; confirmReset?: () => boolean }>()
const emit = defineEmits<{ 'plan-change': [plan: PanelCuttingPlan, modified: boolean] }>()
const editedPlan = shallowRef<PanelCuttingPlan | null>(null)
const displayedPlan = computed(() => editedPlan.value ?? props.allocation.plan)
function planChanged(plan: PanelCuttingPlan, modified: boolean): void { editedPlan.value = modified ? plan : null; emit('plan-change', plan, modified) }
function partName(id: string): string { return props.parts.find(part => part.id === id)?.name ?? id }
</script>
<template>
  <section
    v-if="displayedPlan"
    class="panel space-y-3 p-3 sm:p-4"
    aria-label="Panel cutting workspace"
  >
    <p
      v-if="editedPlan || savedEdited"
      role="status"
      class="text-xs font-medium text-accent"
    >
      Accepted manual edits
    </p>
    <CuttingPlanViewer
      :confirm-reset="confirmReset"
      :saved-baseline="savedBaseline"
      :plan="allocation.plan"
      :panel="panel"
      :parts="parts"
      :settings="settings"
      @plan-change="planChanged"
    />
    <details class="border-t border-line pt-3">
      <summary class="w-fit cursor-pointer rounded text-sm font-medium text-muted">
        Cutting details and placements
      </summary>
      <dl class="mt-3 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt class="text-xs text-muted">
            {{ editedPlan || savedEdited ? 'Optimizer baseline strategy' : 'Selected strategy' }}
          </dt><dd class="font-medium">
            {{ allocation.strategy }}
          </dd>
        </div>
        <div>
          <dt class="text-xs text-muted">
            Waste area (including kerf and margins)
          </dt><dd>{{ displayedPlan.metrics.wasteAreaMm2.toLocaleString() }} mm²</dd>
        </div>
        <div>
          <dt class="text-xs text-muted">
            Cutting settings
          </dt><dd>Kerf {{ settings.kerfMm }} mm · Edge margin {{ settings.edgeMarginMm }} mm</dd>
        </div>
      </dl>
      <div
        v-if="displayedPlan.placements.length"
        class="overflow-x-auto"
        tabindex="0"
        role="region"
        aria-label="Placed parts"
      >
        <table class="w-full text-left text-sm">
          <caption class="sr-only">
            Placements on the selected panel
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                class="p-3"
              >
                Part / copy
              </th><th
                scope="col"
                class="p-3"
              >
                Position x, y (mm)
              </th><th
                scope="col"
                class="p-3"
              >
                Length × width × thickness (mm)
              </th><th
                scope="col"
                class="p-3"
              >
                Orientation
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="placed in displayedPlan.placements"
              :key="`${placed.partId}-${placed.copyIndex}`"
              class="border-t border-line"
            >
              <td class="p-3">
                {{ partName(placed.partId) }} / {{ placed.copyIndex + 1 }}
              </td><td class="p-3">
                {{ placed.region.xMm }}, {{ placed.region.yMm }}
              </td><td class="p-3">
                {{ placed.dimensions.lengthMm }} × {{ placed.dimensions.widthMm }} × {{ placed.dimensions.thicknessMm }}
              </td><td class="p-3">
                {{ placed.orientation }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  </section>
</template>
