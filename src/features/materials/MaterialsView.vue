<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { RouterLink } from 'vue-router'
import type { Material } from '../../domain/model/material'
import { persistenceErrorMessage } from '../../shared/ui/persistence-error-message'
import { useMaterialRepository } from './material-repository'

const repository = useMaterialRepository()
const materials = shallowRef<readonly Material[]>([])
const selectedIds = ref<readonly Material['id'][]>([])
const selectedMaterials = computed(() => materials.value.filter((material) => selectedIds.value.includes(material.id)))
const loading = ref(true)
const loadError = ref('')
async function load(): Promise<void> {
  loading.value = true
  loadError.value = ''
  const result = await repository.list()
  if (result.ok) materials.value = result.value
  else { materials.value = []; loadError.value = persistenceErrorMessage(result.error, 'Material') }
  loading.value = false
}
function toggle(material: Material): void {
  selectedIds.value = selectedIds.value.includes(material.id)
    ? selectedIds.value.filter((id) => id !== material.id)
    : [...selectedIds.value, material.id]
}
onMounted(load)
</script>

<template>
  <section class="space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div class="space-y-2">
        <p class="eyebrow">
          Workshop library
        </p>
        <h1 class="text-3xl font-semibold tracking-tight">
          Materials
        </h1>
        <p class="max-w-2xl text-muted">
          Select existing catalog materials for use. These choices are temporary; project-specific saving is not available yet.
        </p>
      </div>
    </div>

    <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div
        class="panel min-w-0 overflow-hidden"
        :aria-busy="loading"
      >
        <div class="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
          <h2 class="font-semibold">
            Material library <span
              v-if="!loading && !loadError"
              class="ml-2 rounded-full bg-subtle px-2 py-0.5 text-xs text-muted"
            >{{ materials.length }}</span>
          </h2>
          <button
            type="button"
            class="button"
            :disabled="loading"
            @click="load"
          >
            Refresh
          </button>
        </div>
        <div
          v-if="loading"
          role="status"
          class="px-6 py-14 text-center text-muted"
        >
          Loading materials…
        </div>
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
            :disabled="loading"
            @click="load"
          >
            Try again
          </button>
        </div>
        <div
          v-else-if="materials.length === 0"
          class="space-y-3 px-6 py-14 text-center"
        >
          <h3 class="text-lg font-semibold">
            No catalog materials yet
          </h3>
          <p class="mx-auto max-w-sm text-sm leading-relaxed text-muted">
            Create materials in a supplier product's Material field. This page selects existing catalog materials.
          </p>
          <RouterLink
            to="/suppliers"
            class="button"
          >
            Open supplier catalog
          </RouterLink>
        </div>
        <div
          v-else
          class="overflow-x-auto"
        >
          <table class="w-full text-left text-sm">
            <caption class="sr-only">
              Saved materials and their categories
            </caption>
            <thead class="bg-subtle text-xs text-muted">
              <tr>
                <th
                  scope="col"
                  class="px-5 py-3 font-semibold"
                >
                  Material
                </th>
                <th
                  scope="col"
                  class="px-5 py-3 font-semibold"
                >
                  Category
                </th>
                <th
                  scope="col"
                  class="px-5 py-3 text-right font-semibold"
                >
                  Use
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="material in materials"
                :key="material.id"
                class="border-t border-line"
              >
                <th
                  scope="row"
                  class="min-w-44 px-5 py-4 font-medium [overflow-wrap:anywhere]"
                >
                  {{ material.name }}
                </th>
                <td class="px-5 py-4 [overflow-wrap:anywhere]">
                  {{ material.category }}
                </td>
                <td class="px-5 py-4">
                  <input
                    type="checkbox"
                    class="h-5 w-5 accent-accent"
                    :checked="selectedIds.includes(material.id)"
                    :disabled="loading"
                    :aria-label="`Use ${material.name}`"
                    @change="toggle(material)"
                  >
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <aside
        class="panel space-y-4 p-6"
        aria-labelledby="material-selection-title"
      >
        <h2
          id="material-selection-title"
          class="text-xl font-semibold"
        >
          Selected materials
        </h2>
        <p
          v-if="selectedMaterials.length === 0"
          class="text-sm text-muted"
        >
          Choose materials from the catalog table.
        </p>
        <ul
          v-else
          class="space-y-2"
        >
          <li
            v-for="material in selectedMaterials"
            :key="material.id"
            class="text-sm [overflow-wrap:anywhere]"
          >
            {{ material.name }} · {{ material.category }}
          </li>
        </ul>
        <p class="text-sm text-muted">
          Selections stay on this page only. Catalog records are not changed.
        </p>
      </aside>
    </div>
  </section>
</template>
