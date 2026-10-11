<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { Part } from '../../domain/model/part'
import type { SupplierProduct } from '../../domain/model/supplier-product'
import type { CuttingSettings } from '../../domain/model/cutting-settings'
import type { AllocatedPanel } from '../../domain/optimizer/project-plan'
import type { PanelCuttingPlan } from '../../domain/optimizer/plan-with-strategy'
import CuttingPlanViewer from './CuttingPlanViewer.vue'
import PdfExportControls from './PdfExportControls.vue'

const props = defineProps<{ allocation: AllocatedPanel; panel: SupplierProduct; parts: readonly Part[]; settings: CuttingSettings; materialName: string }>()
const editedPlan = shallowRef<PanelCuttingPlan | null>(null)
const displayedPlan = computed(() => editedPlan.value ?? props.allocation.plan)
function planChanged(plan: PanelCuttingPlan, modified: boolean): void { editedPlan.value = modified ? plan : null }
function partName(id: string): string { return props.parts.find(part => part.id === id)?.name ?? id }
</script>
<template>
  <section
    v-if="displayedPlan"
    class="panel space-y-5 p-6"
    aria-labelledby="panel-result-title"
  >
    <h2
      id="panel-result-title"
      class="text-xl font-semibold"
    >
      {{ editedPlan ? 'Validated edited panel plan' : 'Validated panel plan' }}
    </h2>
    <p role="status">
      {{ displayedPlan.placements.length }} copies on this panel. Other copies are accounted for in the project summary.
    </p>
    <CuttingPlanViewer
      :plan="allocation.plan"
      :panel="panel"
      :parts="parts"
      :settings="settings"
      @plan-change="planChanged"
    />
    <PdfExportControls
      :plan="displayedPlan"
      :panel="panel"
      :parts="parts"
      :settings="settings"
      :material-name="materialName"
      :edited="editedPlan !== null"
    />
    <dl class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <dt class="text-sm text-muted">
          {{ editedPlan ? 'Optimizer baseline strategy' : 'Selected strategy' }}
        </dt><dd class="font-semibold">
          {{ allocation.strategy }}
        </dd>
      </div>
      <div>
        <dt class="text-sm text-muted">
          Panel utilization
        </dt><dd class="font-semibold">
          {{ displayedPlan.metrics.utilizationPercent.toFixed(2) }}%
        </dd>
      </div>
      <div>
        <dt class="text-sm text-muted">
          Waste area (including kerf and margins)
        </dt><dd class="font-semibold">
          {{ displayedPlan.metrics.wasteAreaMm2.toLocaleString() }} mm²
        </dd>
      </div>
      <div>
        <dt class="text-sm text-muted">
          Panel
        </dt><dd class="font-semibold">
          {{ panel.name }} · {{ panel.lengthMm }} × {{ panel.widthMm }} × {{ panel.thicknessMm }} mm
        </dd>
      </div>
    </dl>
    <p class="text-sm text-muted">
      Kerf {{ settings.kerfMm }} mm · Edge margin {{ settings.edgeMarginMm }} mm. Coordinates are measured along the panel length (x) and width (y).
    </p>
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
  </section>
</template>
