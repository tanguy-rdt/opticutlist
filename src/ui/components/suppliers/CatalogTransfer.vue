<script setup lang="ts">
import AppButton from '@/ui/components/common/AppButton.vue'
import { watch, onBeforeUnmount, ref, shallowRef, toRaw } from 'vue'
import type { CatalogImportPreview } from '@/application/catalog/catalog-transfer-service'
import type { PersistenceError } from '@/application/persistence/repositories'
import { useCatalogTransferService } from '@/ui/composables/use-catalog-transfer-service'
import { downloadJson } from '@/ui/utils/download-json'
import { persistenceErrorMessage } from '@/ui/utils/persistence-error-message'
import FormField from '@/ui/components/common/FormField.vue'
import AppIcon from '@/ui/components/common/AppIcon.vue'
const props = defineProps<{ disabled: boolean; compact?: boolean }>()
const emit = defineEmits<{ imported: []; busy: [value: boolean]; previewPending: [value: boolean] }>()
const service = useCatalogTransferService()
const preview = shallowRef<CatalogImportPreview | null>(null)
const busy = ref(false)
const showImport = ref(false)
const error = ref('')
const feedback = ref('')
watch(preview, value => {
  emit('previewPending', value !== null)
})
let generation = 0
onBeforeUnmount(() => {
  generation++
})

function message(failure: PersistenceError): string {
  return persistenceErrorMessage(failure, 'Catalog') + (failure.kind === 'invalidRecord' ? ` ${failure.issues.map(issue => issue.message).join('; ')}` : '')
}

function pending(value: boolean): void {
  busy.value = value;
  emit('busy', value)
}

async function exportCatalog(): Promise<void> {
  if (!service || busy.value || props.disabled) {
    return
  }
  const current = generation
  pending(true);
  error.value = '';
  feedback.value = ''
  try {
    const result = await service.export()
    if (current !== generation) {
      return
    }
    if (!result.ok) {
      error.value = message(result.error);
      return
    }
    downloadJson(result.value, 'opticutlist-catalog', 'cocl')
    feedback.value = 'Catalog download started. Projects and physical inventory are excluded.'
  } catch (cause) {
    if (current === generation) {
      error.value = cause instanceof Error ? cause.message : 'Could not export the catalog.'
    }
  }
  finally {
    if (current === generation) {
      pending(false)
    }
  }
}

async function select(event: Event): Promise<void> {
  if (!service || busy.value || props.disabled || !(event.target instanceof HTMLInputElement)) {
    return
  }
  const file = event.target.files?.[0]
  const current = ++generation
  preview.value = null;
  error.value = '';
  feedback.value = ''
  if (!file) {
    return
  }
  if (!file.name.toLowerCase().endsWith('.cocl')) {
    error.value = 'Select an OptiCutList .cocl catalog file.';
    return
  }
  pending(true)
  try {
    const text = await file.text()
    if (current !== generation) {
      return
    }
    const result = await service.preview(text)
    if (current !== generation) {
      return
    }
    if (result.ok) {
      preview.value = result.value
    } else {
      error.value = message(result.error)
    }
  } catch (cause) {
    if (current === generation) {
      error.value = cause instanceof Error ? cause.message : 'Could not read this catalog file.'
    }
  }
  finally {
    if (current === generation) {
      pending(false)
    }
  }
}

async function importCatalog(): Promise<void> {
  if (
    !service
    || !preview.value
    || busy.value
    || props.disabled
    || !window.confirm('Import this catalog? Existing records will not be overwritten. Projects and physical inventory will not change.')
  ) {
    return
  }
  const current = generation
  pending(true);
  error.value = '';
  feedback.value = ''
  try {
    const result = await service.import(toRaw(preview.value.file), true)
    if (current !== generation) {
      return
    }
    if (!result.ok) {
      error.value = message(result.error);
      return
    }
    preview.value = null;
    feedback.value = 'Catalog imported successfully.';
    emit('imported')
  } catch (cause) {
    if (current === generation) {
      error.value = cause instanceof Error ? cause.message : 'Could not import the catalog.'
    }
  }
  finally {
    if (current === generation) {
      pending(false)
    }
  }
}
</script>
<template>
  <div
    v-if="service"
    class="space-y-3"
  >
    <div class="flex flex-wrap items-center justify-between gap-3">
      <slot name="heading" />
      <div class="flex gap-2">
        <AppButton
          type="button"
          size="small"
          :aria-label="compact ? 'Export Catalog' : undefined"
          :disabled="disabled || busy"
          @click="exportCatalog"
        >
          <AppIcon name="export" />{{ compact ? 'Export' : 'Export Catalog' }}
        </AppButton>
        <AppButton
          type="button"
          size="small"
          :aria-label="compact ? 'Import Catalog' : undefined"
          :disabled="disabled || busy"
          :aria-expanded="showImport"
          aria-controls="catalog-import"
          @click="showImport = !showImport"
        >
          <AppIcon name="import" />{{ compact ? 'Import' : 'Import Catalog' }}
        </AppButton>
      </div>
    </div>
    <div
      v-if="showImport"
      id="catalog-import"
      class="space-y-4 pt-2"
    >
      <FormField
        id="catalog-import-file"
        label="Catalog file (.cocl)"
        required
      >
        <template #default="{ controlAttrs }">
          <input
            v-bind="controlAttrs"
            type="file"
            accept=".cocl"
            class="field"
            :disabled="disabled || busy"
            @change="select"
          >
        </template>
      </FormField>
      <section
        v-if="preview"
        aria-labelledby="catalog-preview-title"
        class="space-y-3"
      >
        <h2
          id="catalog-preview-title"
          class="text-sm font-semibold"
        >
          Catalog import preview
        </h2>
        <p>{{ preview.file.catalog.materials.length }} materials · {{ preview.file.catalog.suppliers.length }} suppliers · {{ preview.file.catalog.products.length }} products</p>
        <p>{{ preview.conflicts }} conflicts will receive new IDs · {{ preview.reused }} identical records can be reused.</p>
        <p class="text-muted">
          Relationships are preserved. Conflicts are checked again during import. Projects and physical inventory are excluded.
        </p>
        <AppButton
          type="button"
          variant="primary"
          :disabled="disabled || busy"
          @click="importCatalog"
        >
          Confirm Catalog Import
        </AppButton>
      </section>
    </div>
    <p
      v-if="busy"
      role="status"
    >
      Processing catalog…
    </p>
    <p
      v-if="error"
      role="alert"
      class="text-danger"
    >
      {{ error }}
    </p>
    <p
      v-if="feedback"
      role="status"
      class="text-sm text-muted"
    >
      {{ feedback }}
    </p>
  </div>
</template>
