<script setup lang="ts">
import { ref } from 'vue'
import AppIcon from '../../shared/ui/AppIcon.vue'
import ThemeSelector from '../theme/ThemeSelector.vue'
import CatalogFormDialog from '../../features/suppliers/CatalogFormDialog.vue'
import CatalogTransfer from '../../features/suppliers/CatalogTransfer.vue'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; catalogImported: [] }>()
const busy = ref(false)
const pendingImport = ref(false)
function close(): void {
  if (busy.value) return
  if (pendingImport.value && !window.confirm('Discard this catalog import preview? Nothing has been imported.')) return
  pendingImport.value = false
  emit('close')
}
</script>
<template>
  <CatalogFormDialog
    title="Settings"
    title-id="settings-dialog-title"
    close-label="Close Settings"
    :open="open"
    :busy="busy"
    style="max-width: 32rem"
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
          :disabled="false"
          @busy="busy = $event"
          @preview-pending="pendingImport = $event"
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
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h3
            id="settings-stock"
            class="text-sm font-semibold"
          >
            Stock
          </h3>
          <div class="flex gap-2">
            <button
              type="button"
              class="button button-compact"
              disabled
              aria-label="Export Stock"
              aria-describedby="settings-stock-unavailable"
            >
              <AppIcon name="export" />Export
            </button>
            <button
              type="button"
              class="button button-compact"
              disabled
              aria-label="Import Stock"
              aria-describedby="settings-stock-unavailable"
            >
              <AppIcon name="import" />Import
            </button>
          </div>
        </div>
        <p
          id="settings-stock-unavailable"
          class="mt-2 text-xs text-muted"
        >
          Stock transfers are not available yet.
        </p>
      </section>
    </div>
  </CatalogFormDialog>
</template>
<style scoped>
:deep(button[aria-label='Close Settings']) {
  min-height: 2rem;
  width: 2rem;
  height: 2rem;
  padding: 0.375rem;
  border-color: transparent;
  background: transparent;
}
</style>
