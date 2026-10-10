<script setup lang="ts">
import { nextTick, onMounted, ref, shallowRef } from 'vue'
import { RouterLink } from 'vue-router'

import type { Material } from '../../domain/model/material'
import type { Part } from '../../domain/model/part'
import { persistenceErrorMessage } from '../../shared/ui/persistence-error-message'
import { useMaterialRepository } from '../materials/material-repository'
import PartForm from './PartForm.vue'
import { usePartRepository } from './part-repository'

const repository = usePartRepository()
const materialRepository = useMaterialRepository()
const parts = shallowRef<readonly Part[]>([])
const materials = shallowRef<readonly Material[]>([])
const loading = ref(true)
const busy = ref(false)
const loadError = ref('')
const materialError = ref('')
const operationError = ref('')
const notice = ref('')
const editing = shallowRef<Part | null>(null)
const formVersion = ref(0)
const partForm = ref<InstanceType<typeof PartForm> | null>(null)

async function load(): Promise<void> {
  loading.value = true
  const [partResult, materialResult] = await Promise.all([repository.list(), materialRepository.list()])
  loadError.value = partResult.ok ? '' : persistenceErrorMessage(partResult.error, 'Part')
  materialError.value = materialResult.ok ? '' : persistenceErrorMessage(materialResult.error, 'Material')
  parts.value = partResult.ok ? partResult.value : []
  materials.value = materialResult.ok ? materialResult.value : []
  loading.value = false
}

async function edit(part: Part | null): Promise<void> {
  editing.value = part
  formVersion.value++
  operationError.value = ''
  notice.value = ''
  await nextTick()
  partForm.value?.focusName()
}

async function save(part: Part): Promise<void> {
  if (busy.value || loading.value || loadError.value || materialError.value) return
  busy.value = true
  operationError.value = ''
  notice.value = ''
  // Check the source of truth again in case a material was deleted in another tab.
  const material = await materialRepository.get(part.materialId)
  if (!material.ok) {
    operationError.value = material.error.kind === 'notFound'
      ? 'The selected material no longer exists. Choose an existing material.'
      : persistenceErrorMessage(material.error, 'Material')
    await load()
    busy.value = false
    return
  }
  const wasEditing = editing.value !== null
  const result = wasEditing ? await repository.update(part.id, part) : await repository.create(part)
  if (result.ok) {
    editing.value = null
    formVersion.value++
    notice.value = wasEditing ? 'Part updated.' : 'Part created.'
    await load()
  } else operationError.value = persistenceErrorMessage(result.error, 'Part')
  busy.value = false
  await nextTick()
  partForm.value?.focusName()
}

async function remove(part: Part): Promise<void> {
  if (busy.value || loading.value) return
  if (!window.confirm(`Delete “${part.name}”? This cannot be undone.`)) return
  busy.value = true
  operationError.value = ''
  notice.value = ''
  const result = await repository.delete(part.id)
  if (result.ok) {
    if (editing.value?.id === part.id) {
      editing.value = null
      formVersion.value++
    }
    notice.value = 'Part deleted.'
    await load()
  } else operationError.value = persistenceErrorMessage(result.error, 'Part')
  busy.value = false
  if (result.ok) {
    await nextTick()
    partForm.value?.focusName()
  }
}

function materialName(part: Part): string {
  return materials.value.find((material) => material.id === part.materialId)?.name
    ?? (materialError.value ? 'Material unavailable' : 'Missing material')
}

onMounted(load)
</script>

<template>
  <section class="min-w-0 space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div class="space-y-2">
        <p class="eyebrow">
          Workshop library
        </p>
        <h1 class="text-3xl font-semibold tracking-tight">
          Parts
        </h1>
        <p class="max-w-2xl text-muted">
          Your finished parts, with dimensions, quantities, and cutting constraints.
        </p>
      </div>
      <button
        type="button"
        class="button button-primary"
        :disabled="busy || loading || Boolean(loadError) || Boolean(materialError)"
        @click="edit(null)"
      >
        + New part
      </button>
    </div>
    <p
      v-if="notice"
      role="status"
      class="rounded-lg border border-success bg-success-surface px-4 py-3 text-sm text-success"
    >
      {{ notice }}
    </p>
    <p
      v-if="operationError"
      role="alert"
      class="rounded-lg border border-danger bg-danger-surface px-4 py-3 text-sm text-danger"
    >
      {{ operationError }}
    </p>
    <div
      v-if="!loading && materialError"
      class="panel space-y-3 p-5"
    >
      <p
        role="alert"
        class="text-danger"
      >
        Could not load materials. {{ materialError }}
      </p>
      <button
        type="button"
        class="button"
        :disabled="busy"
        @click="load"
      >
        Retry loading
      </button>
    </div>
    <p
      v-else-if="!loading && materials.length === 0"
      class="panel p-5 text-sm text-muted"
    >
      Add a material before creating or editing parts.
      <RouterLink
        to="/suppliers"
        class="font-medium text-accent underline underline-offset-4"
      >
        Open supplier catalog
      </RouterLink>
    </p>
    <div
      class="panel min-w-0 overflow-hidden"
      :aria-busy="loading"
    >
      <div class="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
        <h2 class="font-semibold">
          Part library <span
            v-if="!loading && !loadError"
            class="ml-2 rounded-full bg-subtle px-2 py-0.5 text-xs text-muted"
          >{{ parts.length }}</span>
        </h2>
        <button
          type="button"
          class="button"
          :disabled="loading || busy"
          @click="load"
        >
          Refresh
        </button>
      </div>
      <p
        v-if="loading"
        role="status"
        class="px-6 py-14 text-center text-muted"
      >
        Loading parts…
      </p>
      <div
        v-else-if="loadError"
        class="space-y-4 px-6 py-10"
      >
        <p
          role="alert"
          class="text-danger"
        >
          {{ loadError }}
        </p>
        <button
          type="button"
          class="button"
          :disabled="busy"
          @click="load"
        >
          Try again
        </button>
      </div>
      <div
        v-else-if="parts.length === 0"
        class="space-y-3 px-6 py-14 text-center"
      >
        <h3 class="text-lg font-semibold">
          No parts yet
        </h3>
        <p class="text-sm text-muted">
          Use the form below to add your first part.
        </p>
      </div>
      <div
        v-else
        class="overflow-x-auto"
        tabindex="0"
        role="region"
        aria-label="Parts table, scroll horizontally to see all columns"
      >
        <table class="w-full text-left text-sm">
          <caption class="sr-only">
            Saved parts. Dimensions are length × width × thickness in millimeters.
          </caption>
          <thead class="bg-subtle text-xs text-muted">
            <tr>
              <th
                scope="col"
                class="px-4 py-3 font-semibold"
              >
                Part
              </th>
              <th
                scope="col"
                class="px-4 py-3 font-semibold"
              >
                Material
              </th>
              <th
                scope="col"
                class="px-4 py-3 font-semibold"
              >
                Dimensions (mm)<span class="block font-normal">Length × width × thickness</span>
              </th>
              <th
                scope="col"
                class="px-4 py-3 font-semibold"
              >
                Quantity
              </th>
              <th
                scope="col"
                class="px-4 py-3 font-semibold"
              >
                Grain
              </th>
              <th
                scope="col"
                class="px-4 py-3 font-semibold"
              >
                90° rotation
              </th>
              <th
                scope="col"
                class="px-4 py-3 text-right font-semibold"
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="part in parts"
              :key="part.id"
              class="border-t border-line"
            >
              <th
                scope="row"
                class="min-w-32 px-4 py-4 font-medium [overflow-wrap:anywhere]"
              >
                {{ part.name }}
              </th>
              <td class="min-w-32 px-4 py-4 [overflow-wrap:anywhere]">
                {{ materialName(part) }}
              </td>
              <td class="whitespace-nowrap px-4 py-4 tabular-nums">
                {{ part.lengthMm }} × {{ part.widthMm }} × {{ part.thicknessMm }}
              </td>
              <td class="px-4 py-4 tabular-nums">
                {{ part.quantity }}
              </td>
              <td class="whitespace-nowrap px-4 py-4">
                {{ part.grainDirection === 'none' ? 'None' : (part.grainDirection === 'length' ? 'Along length' : 'Along width') }}
              </td>
              <td class="px-4 py-4">
                {{ part.rotation === 'allowed' ? 'Allowed' : 'Forbidden' }}
              </td>
              <td class="px-4 py-4">
                <div class="flex justify-end gap-2">
                  <button
                    type="button"
                    class="button"
                    :disabled="busy || loading || Boolean(materialError)"
                    :aria-label="`Edit ${part.name}`"
                    @click="edit(part)"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    class="button button-danger"
                    :disabled="busy || loading"
                    :aria-label="`Delete ${part.name}`"
                    @click="remove(part)"
                  >
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <PartForm
      :key="formVersion"
      ref="partForm"
      :part="editing"
      :materials="materials"
      :disabled="loading || Boolean(loadError) || Boolean(materialError)"
      :busy="busy"
      @save="save"
      @cancel="edit(null)"
    />
  </section>
</template>
