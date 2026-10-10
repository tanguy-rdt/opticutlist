<script setup lang="ts">
import { nextTick, onMounted, ref, shallowRef } from 'vue'

import { materialSchema, type Material } from '../../domain/model/material'
import FormField from '../../shared/ui/FormField.vue'
import { persistenceErrorMessage } from '../../shared/ui/persistence-error-message'
import { useMaterialRepository } from './material-repository'

const repository = useMaterialRepository()
const materials = shallowRef<readonly Material[]>([])
const loading = ref(true)
const busy = ref(false)
const loadError = ref('')
const operationError = ref('')
const notice = ref('')
const editing = shallowRef<Material | null>(null)
const name = ref('')
const category = ref('')
const nameError = ref('')
const categoryError = ref('')
const nameInput = ref<HTMLInputElement | null>(null)
const categoryInput = ref<HTMLInputElement | null>(null)

async function load(): Promise<void> {
  loading.value = true
  loadError.value = ''
  const result = await repository.list()
  if (result.ok) materials.value = result.value
  else {
    materials.value = []
    loadError.value = persistenceErrorMessage(result.error, 'Material')
  }
  loading.value = false
}

function clearErrors(): void {
  nameError.value = ''
  categoryError.value = ''
  operationError.value = ''
}

function resetForm(): void {
  editing.value = null
  name.value = ''
  category.value = ''
  clearErrors()
}

async function startNew(): Promise<void> {
  resetForm()
  notice.value = ''
  await nextTick()
  nameInput.value?.focus()
}

async function edit(material: Material): Promise<void> {
  editing.value = material
  name.value = material.name
  category.value = material.category
  clearErrors()
  notice.value = ''
  await nextTick()
  nameInput.value?.focus()
}

async function save(): Promise<void> {
  if (busy.value || loading.value) return
  clearErrors()
  notice.value = ''
  const parsed = materialSchema.safeParse({ id: editing.value?.id ?? crypto.randomUUID(), name: name.value, category: category.value })
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      if (issue.path[0] === 'name') nameError.value = issue.message
      if (issue.path[0] === 'category') categoryError.value = issue.message
    }
    await nextTick()
    if (nameError.value) nameInput.value?.focus()
    else categoryInput.value?.focus()
    return
  }
  busy.value = true
  const wasEditing = editing.value !== null
  const result = editing.value === null
    ? await repository.create(parsed.data)
    : await repository.update(editing.value.id, parsed.data)
  if (result.ok) {
    resetForm()
    notice.value = wasEditing ? 'Material updated.' : 'Material created.'
    await load()
  } else operationError.value = persistenceErrorMessage(result.error, 'Material')
  busy.value = false
  await nextTick()
  nameInput.value?.focus()
}

async function remove(material: Material): Promise<void> {
  if (busy.value || loading.value) return
  if (!window.confirm(`Delete “${material.name}”? This cannot be undone.`)) return
  busy.value = true
  operationError.value = ''
  notice.value = ''
  const result = await repository.delete(material.id)
  if (result.ok) {
    if (editing.value?.id === material.id) resetForm()
    notice.value = 'Material deleted.'
    await load()
  } else operationError.value = persistenceErrorMessage(result.error, 'Material')
  busy.value = false
  // Restore focus after the deleted row and its action disappear.
  if (result.ok) {
    await nextTick()
    nameInput.value?.focus()
  }
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
          The materials you work with, organized by name and category.
        </p>
      </div>
      <button
        type="button"
        class="button button-primary"
        :disabled="busy || loading"
        @click="startNew"
      >
        + New material
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
            :disabled="loading || busy"
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
            :disabled="busy"
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
            Your library starts here
          </h3>
          <p class="mx-auto max-w-sm text-sm leading-relaxed text-muted">
            Add your first material using the form. Give it a clear name, such as “Birch plywood BB/BB”, and a category like “Plywood”.
          </p>
          <button
            type="button"
            class="button mt-2"
            :disabled="busy"
            @click="startNew"
          >
            Add your first material
          </button>
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
                  Actions
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
                  <div class="flex justify-end gap-2">
                    <button
                      type="button"
                      class="button"
                      :disabled="busy || loading"
                      :aria-label="`Edit ${material.name}`"
                      @click="edit(material)"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      class="button button-danger"
                      :disabled="busy || loading"
                      :aria-label="`Delete ${material.name}`"
                      @click="remove(material)"
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

      <aside
        class="panel p-6"
        aria-labelledby="material-form-title"
      >
        <div class="mb-6 space-y-2">
          <p class="eyebrow">
            {{ editing ? 'Update your library' : 'Add to your library' }}
          </p>
          <h2
            id="material-form-title"
            class="text-xl font-semibold"
          >
            {{ editing ? 'Edit material' : 'New material' }}
          </h2>
          <p class="text-sm leading-relaxed text-muted">
            Describe the material itself. Panel dimensions belong to parts, products, and stock.
          </p>
        </div>
        <form
          novalidate
          class="space-y-5"
          :aria-busy="busy"
          @submit.prevent="save"
        >
          <FormField
            id="material-name"
            label="Name"
            required
            :error="nameError"
          >
            <template #default="{ controlAttrs }">
              <input
                ref="nameInput"
                v-model="name"
                v-bind="controlAttrs"
                class="field"
                name="name"
                maxlength="200"
                autocomplete="off"
                :disabled="busy || loading"
                placeholder="e.g. Birch plywood BB/BB"
              >
            </template>
          </FormField>
          <FormField
            id="material-category"
            label="Category"
            required
            :error="categoryError"
          >
            <template #default="{ controlAttrs }">
              <input
                ref="categoryInput"
                v-model="category"
                v-bind="controlAttrs"
                class="field"
                name="category"
                maxlength="200"
                autocomplete="off"
                :disabled="busy || loading"
                placeholder="e.g. Plywood"
              >
            </template>
          </FormField>
          <div class="flex flex-wrap gap-2">
            <button
              type="submit"
              class="button button-primary flex-1"
              :disabled="busy || loading"
            >
              {{ busy ? 'Please wait…' : (editing ? 'Save changes' : 'Create material') }}
            </button>
            <button
              v-if="editing"
              type="button"
              class="button"
              :disabled="busy || loading"
              @click="startNew"
            >
              Cancel
            </button>
          </div>
        </form>
      </aside>
    </div>
  </section>
</template>
