<script setup lang="ts">
import AppButton from '../../shared/ui/AppButton.vue'
import { watch, onBeforeUnmount, ref, shallowRef, toRaw } from 'vue'
import type { StockImportPreview } from '../../application/inventory/stock-transfer-service'
import type { PersistenceError } from '../../application/persistence/repositories'
import { useStockTransferService } from './stock-transfer-service'
import { downloadJson } from '../../shared/ui/download-json'
import { persistenceErrorMessage } from '../../shared/ui/persistence-error-message'
import FormField from '../../shared/ui/FormField.vue'
import AppIcon from '../../shared/ui/AppIcon.vue'
const props = defineProps<{ disabled: boolean; compact?: boolean }>()
const emit = defineEmits<{ imported: []; busy: [value: boolean]; previewPending: [value: boolean] }>()
const service = useStockTransferService()
const preview = shallowRef<StockImportPreview | null>(null)
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
  return persistenceErrorMessage(failure, 'Stock item') + (failure.kind === 'invalidRecord' ? ` ${failure.issues.map(issue => `${issue.path.map(String).join('.')}: ${issue.message}`).join('; ')}` : '')
}

function pending(value: boolean): void {
  busy.value = value;
  emit('busy', value)
}

async function exportStock(): Promise<void> {
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
    downloadJson(result.value, 'stock', 'oclstock.json')
    feedback.value = 'Stock download started. Project inventory history is not included.'
  } catch (cause) {
    if (current === generation) {
      error.value = cause instanceof Error ? cause.message : 'Could not export the stock.'
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
  if (!file.name.toLowerCase().endsWith('.json')) {
    error.value = 'Select an OptiCutList .oclstock.json, .json stock file.';
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
      error.value = cause instanceof Error ? cause.message : 'Could not read this stock file.'
    }
  }
  finally {
    if (current === generation) {
      pending(false)
    }
  }
}

async function importStock(): Promise<void> {
  if (
    !service
    || !preview.value
    || busy.value
    || props.disabled
    || !window.confirm('Import this stock? Only new records will be added. Identical records are unchanged; conflicts block the entire import. Project inventory history will not change.')
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
    feedback.value = 'Stock imported successfully.';
    emit('imported')
  } catch (cause) {
    if (current === generation) {
      error.value = cause instanceof Error ? cause.message : 'Could not import the stock.'
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
          :aria-label="compact ? 'Export Stock' : undefined"
          :disabled="disabled || busy"
          @click="exportStock"
        >
          <AppIcon name="export" />{{ compact ? 'Export' : 'Export Stock' }}
        </AppButton>
        <AppButton
          type="button"
          size="small"
          :aria-label="compact ? 'Import Stock' : undefined"
          :disabled="disabled || busy"
          :aria-expanded="showImport"
          aria-controls="stock-import"
          @click="showImport = !showImport"
        >
          <AppIcon name="import" />{{ compact ? 'Import' : 'Import Stock' }}
        </AppButton>
      </div>
    </div>
    <div
      v-if="showImport"
      id="stock-import"
      class="space-y-4 pt-2"
    >
      <FormField
        id="stock-import-file"
        label="Stock file (.oclstock.json, .json)"
        required
      >
        <template #default="{ controlAttrs }">
          <input
            v-bind="controlAttrs"
            type="file"
            accept=".oclstock.json,.json"
            class="field"
            :disabled="disabled || busy"
            @change="select"
          >
        </template>
      </FormField>
      <section
        v-if="preview"
        aria-labelledby="stock-preview-title"
        class="space-y-3"
      >
        <h2
          id="stock-preview-title"
          class="text-sm font-semibold"
        >
          Stock import preview
        </h2>
        <p>{{ preview.file.stockItems.length }} stock references · {{ preview.file.materials.length }} material dependencies</p>
        <p>{{ preview.added }} new references · {{ preview.reused }} identical references unchanged.</p>
        <p class="text-muted">
          Adds new stock only. Existing quantities are never merged or overwritten. Materials, project-generated offcuts and inventory history are not recreated. Dependencies are checked again when importing.
        </p>
        <AppButton
          type="button"
          variant="primary"
          :disabled="disabled || busy"
          @click="importStock"
        >
          Confirm Stock Import
        </AppButton>
      </section>
    </div>
    <p
      v-if="busy"
      role="status"
    >
      Processing stock…
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
