<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import type { StockItem } from '../../domain/model/stock-item'
import type { Material } from '../../domain/model/material'
import { useCatalogStockRepository } from '../suppliers/catalog-repositories'
import { useMaterialRepository } from '../materials/material-repository'
import { persistenceErrorMessage } from '../../shared/ui/persistence-error-message'
const repository = useCatalogStockRepository()
const materialRepository = useMaterialRepository()
const stock = shallowRef<readonly StockItem[]>([])
const materials = shallowRef<readonly Material[]>([])
const loading = ref(true)
const error = ref('')
let generation = 0
onBeforeUnmount(() => { generation++ })
async function load(): Promise<void> {
  const current = ++generation; loading.value = true; error.value = ''
  if (!repository) { error.value = 'Inventory information is not available.'; loading.value = false; return }
  const [items, names] = await Promise.all([repository.list(), materialRepository.list()])
  if (current !== generation) return
  if (!items.ok) error.value = persistenceErrorMessage(items.error, 'Stock item')
  else if (!names.ok) error.value = persistenceErrorMessage(names.error, 'Material')
  else { stock.value = items.value; materials.value = names.value }
  loading.value = false
}
onMounted(load)
</script>
<template>
  <section class="space-y-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">
          Stock
        </h1><p class="mt-1 text-sm text-muted">
          Physically owned panels and offcuts. Catalog products are not inventory.
        </p>
      </div>
      <button
        type="button"
        class="button button-compact"
        :disabled="loading"
        @click="load"
      >
        Refresh stock
      </button>
    </div>
    <p class="text-sm text-muted">
      Inventory changes are recorded through cutting finalization inside a project.
    </p>
    <p
      v-if="loading"
      role="status"
    >
      Loading owned stock…
    </p>
    <p
      v-else-if="error"
      role="alert"
      class="text-danger"
    >
      {{ error }}
    </p>
    <p
      v-else-if="!stock.length"
      class="panel p-5 text-sm text-muted"
    >
      No physical stock items yet.
    </p>
    <div
      v-else
      class="panel overflow-x-auto"
      tabindex="0"
      role="region"
      aria-label="Physical stock table"
    >
      <table class="w-full text-left text-sm">
        <caption class="sr-only">
          Owned panels and offcuts; dimensions in millimeters
        </caption>
        <thead class="bg-subtle text-xs text-muted">
          <tr>
            <th
              scope="col"
              class="px-4 py-3"
            >
              Material
            </th><th
              scope="col"
              class="px-4 py-3"
            >
              Type
            </th><th
              scope="col"
              class="px-4 py-3"
            >
              Length × width × thickness (mm)
            </th><th
              scope="col"
              class="px-4 py-3"
            >
              Quantity
            </th><th
              scope="col"
              class="px-4 py-3"
            >
              Grain
            </th><th
              scope="col"
              class="px-4 py-3"
            >
              Origin
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in stock"
            :key="item.id"
            class="border-t border-line"
          >
            <th
              scope="row"
              class="px-4 py-3 font-medium"
            >
              {{ materials.find(material => material.id === item.materialId)?.name ?? 'Missing material' }}<span class="block text-xs font-normal text-muted">{{ item.id }}</span>
            </th><td class="px-4 py-3">
              {{ item.kind === 'offcut' ? 'Offcut' : 'Full panel' }}
            </td><td class="whitespace-nowrap px-4 py-3 tabular-nums">
              {{ item.lengthMm }} × {{ item.widthMm }} × {{ item.thicknessMm }}
            </td><td class="px-4 py-3 tabular-nums">
              {{ item.quantity }}
            </td><td class="px-4 py-3">
              {{ item.grainDirection }}
            </td><td class="px-4 py-3">
              {{ item.provenance.source }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
