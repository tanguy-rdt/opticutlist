<script setup lang="ts">
import { computed, ref } from 'vue'
import StockTransfer from '../../features/inventory/StockTransfer.vue'
import ThemeSelector from '../theme/ThemeSelector.vue'
import AppDialog from '../../shared/ui/AppDialog.vue'
import CatalogTransfer from '../../features/suppliers/CatalogTransfer.vue'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; catalogImported: []; stockImported: [] }>()
const catalogBusy = ref(false)
const stockBusy = ref(false)
const busy = computed(() => catalogBusy.value || stockBusy.value)
const pendingCatalogImport = ref(false)
const pendingStockImport = ref(false)
function close(): void {
  if (busy.value) return
  if ((pendingCatalogImport.value || pendingStockImport.value) && !window.confirm('Discard pending import previews? Nothing has been imported.')) return
  pendingCatalogImport.value = false
  pendingStockImport.value = false
  emit('close')
}
</script>
<template>
  <AppDialog
    title="Settings"
    title-id="settings-dialog-title"
    close-label="Close Settings"
    :open="open"
    :busy="busy"
    size="small"
    @close="close"
  >
    <div class="divide-y divide-line">
      <section
        aria-labelledby="settings-appearance"
        class="pb-5"
      >
        <h3
          id="settings-appearance"
          class="mb-3 text-sm font-semibold"
        >
          Appearance
        </h3>
        <ThemeSelector />
      </section>
      <section
        aria-labelledby="settings-catalog"
        class="py-5"
      >
        <CatalogTransfer
          v-if="open"
          compact
          :disabled="stockBusy"
          @busy="catalogBusy = $event"
          @preview-pending="pendingCatalogImport = $event"
          @imported="emit('catalogImported')"
        >
          <template #heading>
            <h3
              id="settings-catalog"
              class="text-sm font-semibold"
            >
              Catalog
            </h3>
          </template>
        </CatalogTransfer>
        <h3
          v-else
          id="settings-catalog"
          class="text-sm font-semibold"
        >
          Catalog
        </h3>
      </section>
      <section
        aria-labelledby="settings-stock"
        class="pt-5"
      >
        <StockTransfer
          v-if="open"
          compact
          :disabled="catalogBusy"
          @busy="stockBusy = $event"
          @preview-pending="pendingStockImport = $event"
          @imported="emit('stockImported')"
        >
          <template #heading>
            <h3
              id="settings-stock"
              class="text-sm font-semibold"
            >
              Stock
            </h3>
          </template>
        </StockTransfer>
        <h3
          v-else
          id="settings-stock"
          class="text-sm font-semibold"
        >
          Stock
        </h3>
      </section>
    </div>
  </AppDialog>
</template>