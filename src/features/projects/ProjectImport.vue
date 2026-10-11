<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef, toRaw } from 'vue'
import { RouterLink } from 'vue-router'
import type { ImportPreview } from '../../application/projects/project-transfer-service'
import type { CuttingProject } from '../../domain/model/cutting-project'
import { useProjectTransferService } from './project-transfer-service'
import { persistenceErrorMessage } from '../../shared/ui/persistence-error-message'
import FormField from '../../shared/ui/FormField.vue'
const service = useProjectTransferService()
const preview = shallowRef<ImportPreview | null>(null)
const imported = shallowRef<CuttingProject | null>(null)
const busy = ref(false)
const error = ref('')
let generation = 0
onBeforeUnmount(() => { generation += 1 })
async function select(event: Event): Promise<void> {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const file = target.files?.[0]
  const current = ++generation
  preview.value = null; imported.value = null; error.value = ''; busy.value = false
  if (!file || !service) return
  busy.value = true
  try {
    const text = await file.text()
    if (current !== generation) return
    const result = await service.preview(text)
    if (current !== generation) return
    if (result.ok) preview.value = result.value
    else error.value = persistenceErrorMessage(result.error, 'Project') + (result.error.kind === 'invalidRecord' ? ` ${result.error.issues.map(issue => issue.message).join('; ')}` : '')
  } catch (cause) { if (current === generation) error.value = cause instanceof Error ? cause.message : 'Could not read this project file.' }
  finally { if (current === generation) busy.value = false }
}
async function importProject(): Promise<void> {
  if (!service || !preview.value || busy.value || !window.confirm(`Import “${preview.value.file.project.name}” as a new project? Existing records will not be overwritten. Inventory and cutting confirmations are not imported.`)) return
  const current = generation
  busy.value = true; error.value = ''
  try {
    const result = await service.import(toRaw(preview.value.file), true)
    if (current !== generation) return
    if (result.ok) { imported.value = result.value; preview.value = null }
    else error.value = persistenceErrorMessage(result.error, 'Project') + (result.error.kind === 'invalidRecord' ? ` ${result.error.issues.map(issue => issue.message).join('; ')}` : '')
  } catch (cause) { if (current === generation) error.value = cause instanceof Error ? cause.message : 'Could not import this project.' }
  finally { if (current === generation) busy.value = false }
}
</script>
<template>
  <section class="space-y-6">
    <RouterLink
      to="/"
      class="button"
    >
      ← Back to Home
    </RouterLink>
    <h1 class="text-3xl font-semibold">
      Import Project
    </h1>
    <div class="panel space-y-4 p-6">
      <p class="text-muted">
        Select an OptiCutList .pocl project file (legacy .json files are also accepted). Preview and confirm before any records are imported.
      </p>
      <FormField
        id="project-import-file"
        label="Project file (.pocl or .json)"
        required
      >
        <template #default="{ controlAttrs }">
          <input
            v-bind="controlAttrs"
            type="file"
            accept=".pocl,.json,application/json"
            class="field"
            :disabled="busy || !service"
            @change="select"
          >
        </template>
      </FormField>
      <p
        v-if="busy"
        role="status"
      >
        {{ preview ? 'Importing project…' : 'Reading and validating project…' }}
      </p>
      <p
        v-if="!service"
        role="status"
      >
        Project import is unavailable.
      </p>
      <p
        v-if="error"
        role="alert"
        class="text-danger"
      >
        {{ error }}
      </p>
    </div>
    <section
      v-if="preview"
      class="panel space-y-4 p-6"
      aria-labelledby="import-preview-title"
    >
      <h2
        id="import-preview-title"
        class="text-xl font-semibold"
      >
        Import preview: {{ preview.file.project.name }}
      </h2>
      <p>{{ preview.file.parts.length }} Parts · {{ preview.file.project.materialIds.length }} selected materials · {{ preview.file.project.supplierProductIds.length }} selected products · {{ preview.file.savedPlans.length }} saved plans</p>
      <ul>
        <li
          v-for="material in preview.file.catalog.materials"
          :key="material.id"
        >
          {{ material.name }} · {{ material.category }}
        </li>
      </ul>
      <p v-if="preview.projectIdCollision">
        This project ID already exists. A new project ID will be assigned.
      </p>
      <p>{{ preview.catalogConflicts }} catalog conflicts will receive new IDs · {{ preview.reusedCatalogRecords }} identical catalog records can be reused.</p>
      <p class="text-muted">
        Relationships and saved historical layouts are preserved. Stock and physical cutting confirmations are excluded; imported plans do not indicate physical cutting. Conflicts are checked again during import.
      </p>
      <button
        class="button button-primary"
        type="button"
        :disabled="busy"
        @click="importProject"
      >
        Confirm Import
      </button>
    </section>
    <div
      v-if="imported"
      class="panel space-y-4 p-6"
      role="status"
    >
      <p class="text-success">
        Project “{{ imported.name }}” imported successfully.
      </p>
      <RouterLink
        :to="{ name: 'project-parts', params: { projectId: imported.id } }"
        class="button button-primary"
      >
        Open imported project
      </RouterLink>
    </div>
  </section>
</template>
