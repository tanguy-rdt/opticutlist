<script setup lang="ts">
import type { StockItem } from '../../domain/model/stock-item'
import type { Material } from '../../domain/model/material'
import type { CuttingConfirmation } from '../../domain/model/cutting-confirmation'
import MaterialThumbnail from '../materials/MaterialThumbnail.vue'
import AppIcon from '../../shared/ui/AppIcon.vue'

defineProps<{ item: StockItem; material: Material | undefined; history: readonly CuttingConfirmation[]; historyLoading: boolean; historyError: string; writable: boolean; busy: boolean }>()
const emit = defineEmits<{ edit: []; delete: [] }>()
</script>
<template>
  <section
    class="space-y-5"
    aria-label="Stock item details"
  >
    <MaterialThumbnail
      :preset-id="material?.libraryPresetId"
      variant="preview"
    />
    <header>
      <h3 class="text-lg font-semibold">
        {{ material?.name ?? 'Missing material' }}
      </h3><p class="mt-1 text-sm text-muted">
        {{ item.kind === 'offcut' ? 'Offcut' : 'Full panel' }}
      </p>
    </header>
    <div class="rounded-lg bg-subtle p-3">
      <p class="font-semibold tabular-nums">
        {{ item.lengthMm }} × {{ item.widthMm }} × {{ item.thicknessMm }} mm
      </p><p class="mt-2 text-sm">
        {{ item.quantity }} physically owned
      </p>
    </div>
    <section
      aria-label="Stock specifications"
      class="space-y-3"
    >
      <h4 class="text-sm font-semibold">
        Specifications
      </h4>
      <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        <dt class="text-muted">
          Thickness
        </dt><dd class="text-right">
          {{ item.thicknessMm }} mm
        </dd>
        <dt class="text-muted">
          Grain
        </dt><dd class="text-right">
          {{ item.grainDirection === 'none' ? 'No constraint' : `Along ${item.grainDirection}` }}
        </dd>
        <dt class="text-muted">
          Source
        </dt><dd class="text-right capitalize">
          {{ item.provenance.source }}
        </dd>
      </dl>
      <p class="break-all text-xs text-muted">
        Stock reference: {{ item.id }}
      </p>
      <p
        v-if="item.provenance.source === 'purchase'"
        class="break-all text-xs text-muted"
      >
        Catalog reference: {{ item.provenance.supplierProductId }}
      </p>
      <div
        v-if="item.provenance.source === 'cutting'"
        class="space-y-1 break-all text-xs text-muted"
      >
        <p>Project: {{ item.provenance.projectId }}</p><p>Cutting result: {{ item.provenance.savedPlanId }}</p><p v-if="item.provenance.sourceStockItemId">
          Source stock: {{ item.provenance.sourceStockItemId }}
        </p><p v-else>
          External catalogue panel: {{ item.provenance.supplierProductId }}
        </p><p>Panel {{ item.provenance.panelIndex + 1 }}, offcut {{ item.provenance.wasteIndex + 1 }}</p>
      </div>
    </section>
    <section
      aria-label="Cutting movement history"
      class="space-y-3 border-t border-line pt-4"
    >
      <h4 class="text-sm font-semibold">
        Cutting history
      </h4>
      <p
        v-if="historyLoading"
        role="status"
        class="text-sm text-muted"
      >
        Loading history…
      </p>
      <p
        v-else-if="historyError"
        role="alert"
        class="text-sm text-danger"
      >
        {{ historyError }}
      </p>
      <p
        v-else-if="!history.length"
        class="text-sm text-muted"
      >
        No recorded cutting movements for this reference.
      </p>
      <ul
        v-else
        class="space-y-3 text-sm"
      >
        <li
          v-for="receipt in history"
          :key="receipt.id"
          class="space-y-1"
        >
          <time
            :datetime="receipt.confirmedAt"
            class="font-medium"
          >{{ new Date(receipt.confirmedAt).toLocaleString() }}</time>
          <p
            v-for="movement in receipt.consumed.filter(movement => movement.stock.id === item.id)"
            :key="movement.stock.id"
          >
            Consumed {{ movement.quantity }} · {{ movement.stock.lengthMm }} × {{ movement.stock.widthMm }} × {{ movement.stock.thicknessMm }} mm
          </p>
          <p v-if="receipt.offcuts.some(offcut => offcut.id === item.id)">
            Retained after cutting
          </p>
          <p class="break-all text-xs text-muted">
            Project {{ receipt.projectId }} · Result {{ receipt.id }}
          </p>
        </li>
      </ul>
    </section>
    <div class="grid gap-2 border-t border-line pt-4">
      <button
        type="button"
        class="button"
        :disabled="!writable || busy"
        @click="emit('edit')"
      >
        <AppIcon name="edit" />Edit stock item
      </button>
      <button
        type="button"
        class="button button-danger"
        :disabled="!writable || busy"
        @click="emit('delete')"
      >
        <AppIcon name="delete" />Delete stock item
      </button>
    </div>
  </section>
</template>
