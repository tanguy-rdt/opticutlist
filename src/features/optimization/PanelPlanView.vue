<script setup lang="ts">
import type { Part } from '../../domain/model/part'
import type { PanelSnapshot } from '../../domain/model/saved-cutting-plan'
import type { CuttingSettings } from '../../domain/model/cutting-settings'
import type { AllocatedPanel } from '../../domain/optimizer/project-plan'
import type { PanelCuttingPlan } from '../../domain/optimizer/plan-with-strategy'
import CuttingPlanViewer from './CuttingPlanViewer.vue'

defineProps<{ allocation: AllocatedPanel; panel: PanelSnapshot; parts: readonly Part[]; settings: CuttingSettings; materialName: string; savedEdited?: boolean; savedBaseline?: boolean; confirmReset?: () => boolean; selectedCopyKey?: string }>()
const emit = defineEmits<{ 'plan-change': [plan: PanelCuttingPlan, modified: boolean]; 'select-copy': [key: string] }>()
</script>
<template>
  <section
    class="min-w-0"
    aria-label="Panel cutting workspace"
  >
    <CuttingPlanViewer
      :confirm-reset="confirmReset"
      :saved-baseline="savedBaseline"
      :plan="allocation.plan"
      :panel="panel"
      :parts="parts"
      :settings="settings"
      :selected-copy-key="selectedCopyKey"
      @select-copy="emit('select-copy', $event)"
      @plan-change="(plan, modified) => emit('plan-change', plan, modified)"
    />
  </section>
</template>
