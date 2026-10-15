<script setup lang="ts">
import type { StockItem } from '../../domain/model/stock-item'
import type { Material } from '../../domain/model/material'
import type { CuttingConfirmation } from '../../domain/model/cutting-confirmation'
import PanelDimensionPreview from '../../shared/ui/PanelDimensionPreview.vue'

defineProps<{ item: StockItem; material: Material | undefined; history: readonly CuttingConfirmation[]; historyLoading: boolean; historyError: string }>()
</script>
<template>
  <section
    class="space-y-5"
    aria-label="Stock item details"
  >
    <header>
      <h3 class="text-lg font-semibold">
        {{ material?.name ?? 'Missing material' }}
      </h3><p class="mt-1 text-sm text-muted">
        {{ item.kind === 'offcut' ? 'Offcut' : 'Full panel' }}
      </p>
    </header>
    <PanelDimensionPreview
      :length-mm="item.lengthMm"
      :width-mm="item.widthMm"
      :grain-direction="item.grainDirection"
      size="small"
      label="Physical stock panel preview"
    />
    <div class="space-y-1">
      <p class="font-semibold tabular-nums">
        {{ item.lengthMm }} × {{ item.widthMm }} × {{ item.thicknessMm }} mm
      </p><p class="text-sm text-muted">
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
      </dl>
    </section>
    <section
      aria-label="Stock provenance"
      class="space-y-2 text-sm"
    >
      <h4 class="text-sm font-semibold">
        Provenance
      </h4>
      <p
        v-if="item.provenance.source === 'manual'"
        class="text-muted"
      >
        Manually recorded
      </p>
      <p
        v-else-if="item.provenance.source === 'purchase'"
        class="text-muted"
      >
        Purchased catalog panel
      </p>
      <div
        v-else
        class="space-y-1 text-muted"
      >
        <p>Retained from cutting · Panel {{ item.provenance.panelIndex + 1 }}, offcut {{ item.provenance.wasteIndex + 1 }}</p>
        <p>{{ item.provenance.sourceStockItemId ? 'From owned stock' : 'From a catalog panel' }}</p>
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
        </li>
      </ul>
    </section>
  </section>
</template>
