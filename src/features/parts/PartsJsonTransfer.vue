<script setup lang="ts">
import AppButton from '../../shared/ui/AppButton.vue'
import { useToastStore } from '../../shared/ui/toast-store'
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import { RouterLink } from 'vue-router'
import { materialIdSchema, type MaterialId } from '../../domain/model/ids'
import type { PartsImportPreview } from '../../application/projects/parts-transfer-service'
import { useProjectId } from '../projects/project-service'
import { usePartsTransferService } from './parts-transfer-service'
import AppDialog from '../../shared/ui/AppDialog.vue'
import MaterialSelector from '../materials/MaterialSelector.vue'
import { persistenceErrorMessage } from '../../shared/ui/persistence-error-message'
import type { PersistenceError } from '../../application/persistence/repositories'
const props = defineProps<{ disabled: boolean }>()
const emit = defineEmits<{ imported: [] }>()
const projectId = useProjectId()
const service = usePartsTransferService()
const open = ref(false)
const busy = ref(false)
const error = ref('')
const toasts = useToastStore()
const preview = shallowRef<PartsImportPreview | null>(null)
const materialIds = ref<readonly (MaterialId | null)[]>([])
const options = computed(() => preview.value?.materials.map(material => ({ value: material.id, name: material.name, group: material.category, presetId: material.libraryPresetId })) ?? [])
let generation = 0
onBeforeUnmount(() => {
  generation++
})

function message(failure: PersistenceError): string {
  return failure.kind === 'invalidRecord' ? failure.issues.map(issue => `${issue.path.join('.') || 'File'}: ${issue.message}`).join('; ') : persistenceErrorMessage(failure, 'Part')
}

function start(): void {
  open.value = true;
  preview.value = null;
  error.value = '';
  materialIds.value = []
}

function close(): void {
  if (!busy.value) {
    generation++;
    open.value = false
  }
}

async function select(event: Event): Promise<void> {
  if (!service || busy.value || !(event.target instanceof HTMLInputElement)) {
    return
  }
  const file = event.target.files?.[0]
  if (!file) {
    return
  }
  const current = ++generation
  busy.value = true;
  error.value = '';
  preview.value = null
  try {
    const result = await service.preview(projectId, await file.text())
    if (current !== generation) {
      return
    }
    if (result.ok) {
      preview.value = result.value;
      materialIds.value = result.value.materialIds
    } else {
      error.value = message(result.error)
    }
  } catch {
    if (current === generation) {
      error.value = 'Could not read the selected JSON file.'
    }
  }
  finally {
    if (current === generation) {
      busy.value = false
    }
  }
}

function choose(index: number, value: string): void {
  const parsed = materialIdSchema.safeParse(value)
  materialIds.value = materialIds.value.map((id, position) => position === index ? parsed.success ? parsed.data : null : id)
}

async function confirm(): Promise<void> {
  if (!service || !preview.value || busy.value || props.disabled) {
    return
  }
  const current = ++generation
  busy.value = true;
  error.value = ''
  const result = await service.import(projectId, preview.value.file, materialIds.value, true)
  if (current !== generation) {
    return
  }
  busy.value = false
  if (!result.ok) {
    error.value = message(result.error);
    return
  }
  close();
  toasts.success('Parts imported', `${String(result.value)} ${result.value === 1 ? 'part' : 'parts'} added`);
  emit('imported')
}
</script>
<template>
  <div class="flex flex-wrap items-center gap-2">
    <slot
      name="import"
      :start="start"
      :disabled="disabled || busy || !service"
    >
      <AppButton
        type="button"
        variant="secondary"
        :disabled="disabled || busy || !service"
        @click="start"
      >
        Import JSON
      </AppButton>
    </slot>
    <span
      v-if="error && !open"
      role="alert"
      class="text-sm text-danger"
    >{{ error }}</span>
    <AppDialog
      v-if="open"
      title="Import Parts JSON"
      :busy="busy"
      @close="close"
    >
      <form
        class="space-y-4"
        @submit.prevent="confirm"
      >
        <label
          class="block text-sm font-medium"
          for="parts-json-file"
        >Parts file (.oclparts.json or .json)</label>
        <input
          id="parts-json-file"
          type="file"
          accept=".oclparts.json,.json,application/json"
          class="field"
          :disabled="busy"
          @change="select"
        >
        <p
          v-if="busy"
          role="status"
          class="text-sm text-muted"
        >
          Processing Parts JSON…
        </p>
        <p
          v-if="error"
          role="alert"
          class="text-sm text-danger"
        >
          {{ error }}
        </p>
        <section
          v-if="preview"
          class="space-y-3"
          aria-label="Parts import preview"
        >
          <p class="text-sm">
            {{ preview.file.parts.length }} parts will be added. Existing parts will remain unchanged.
          </p>
          <p
            v-if="preview.file.parts.length && !options.length"
            class="text-sm text-muted"
          >
            Select eligible materials or panels in <RouterLink
              :to="`/projects/${projectId}/materials`"
              class="text-accent underline"
            >
              Materials
            </RouterLink> before importing.
          </p>
          <ul class="max-h-[45vh] space-y-3 overflow-y-auto pr-1">
            <li
              v-for="(part, index) in preview.file.parts"
              :key="index"
              class="grid gap-2 border-b border-line pb-3 sm:grid-cols-[minmax(0,1fr)_240px]"
            >
              <div class="min-w-0 text-sm">
                <p class="font-medium">
                  {{ part.name }}
                </p>
                <p class="text-muted">
                  {{ part.length }} × {{ part.width }} × {{ part.thickness }} mm · Qty {{ part.quantity }}
                </p>
                <p class="text-xs text-muted">
                  {{ part.material }} · Grain: {{ part.grainDirection }} · Rotation: {{ part.rotation }}
                </p>
              </div>
              <div>
                <label
                  :for="`import-part-material-${index}`"
                  class="mb-1 block text-xs text-muted"
                >Project material for {{ part.name }}</label>
                <MaterialSelector
                  :id="`import-part-material-${index}`"
                  :model-value="materialIds[index] ?? ''"
                  :options="options"
                  :disabled="busy || !options.length"
                  :allow-custom-creation="false"
                  @update:model-value="choose(index, $event)"
                />
              </div>
            </li>
          </ul>
        </section>
        <div class="flex justify-end gap-2">
          <AppButton
            type="button"
            variant="secondary"
            :disabled="busy"
            @click="close"
          >
            Cancel
          </AppButton>
          <AppButton
            type="submit"
            variant="primary"
            :disabled="busy || disabled || !preview || materialIds.some(id => id === null)"
          >
            Import parts
          </AppButton>
        </div>
      </form>
    </AppDialog>
  </div>
</template>
