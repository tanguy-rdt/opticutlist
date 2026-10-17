<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue'
import type { Part } from '../../domain/model/part'
import { persistenceErrorMessage } from '../../shared/ui/persistence-error-message'
import { useProjectId, useProjectService } from './project-service'

const emit = defineEmits<{ adopted: [] }>()
const service = useProjectService()
const projectId = useProjectId()
const parts = shallowRef<readonly Part[]>([])
const selected = ref<Part['id'][]>([])
const loading = ref(true)
const busy = ref(false)
const error = ref('')

async function load(): Promise<void> {
  loading.value = true
  const result = await service.listLegacyParts()
  if (result.ok) {
    parts.value = result.value;
    selected.value = []
  }
  error.value = result.ok ? '' : persistenceErrorMessage(result.error, 'Part')
  loading.value = false
}

async function adopt(): Promise<void> {
  if (busy.value || selected.value.length === 0) {
    return
  }
  if (!window.confirm('Move the selected legacy parts into this project? Their IDs and dimensions will be preserved. This assigns ownership; it does not copy parts.')) {
    return
  }
  busy.value = true
  const result = await service.adoptLegacyParts(projectId, selected.value)
  if (result.ok) {
    await load();
    emit('adopted')
  } else {
    error.value = persistenceErrorMessage(result.error, 'Part')
  }
  busy.value = false
}

onMounted(load)
</script>
<template>
  <section
    v-if="loading || error || parts.length"
    class="panel space-y-4 p-6"
    aria-labelledby="legacy-parts-title"
  >
    <h2
      id="legacy-parts-title"
      class="text-xl font-semibold"
    >
      Unassigned legacy parts
    </h2>
    <p class="text-sm text-muted">
      Parts saved before projects remain untouched. Review them and explicitly move selected records into this project.
    </p>
    <p
      v-if="loading"
      role="status"
    >
      Loading legacy parts…
    </p>
    <div
      v-else-if="error"
      class="space-y-3"
    >
      <p
        role="alert"
        class="text-danger"
      >
        {{ error }}
      </p>
      <button
        type="button"
        class="button"
        :disabled="busy"
        @click="load"
      >
        Refresh legacy parts
      </button>
    </div>
    <template v-else>
      <ul class="space-y-3">
        <li
          v-for="part in parts"
          :key="part.id"
        >
          <label class="flex items-start gap-3 text-sm">
            <input
              v-model="selected"
              type="checkbox"
              class="mt-1 h-5 w-5 accent-accent"
              :value="part.id"
              :disabled="busy"
            >
            <span>{{ part.name }} · {{ part.lengthMm }} × {{ part.widthMm }} × {{ part.thicknessMm }} mm · Quantity {{ part.quantity }} · {{ part.grainDirection }} grain · Rotation {{ part.rotation }}</span>
          </label>
        </li>
      </ul>
      <button
        type="button"
        class="button"
        :disabled="busy || selected.length === 0"
        @click="adopt"
      >
        Move selected legacy parts into this project
      </button>
    </template>
  </section>
</template>
