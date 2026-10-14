<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef } from 'vue'
import { RouterLink } from 'vue-router'
import { projectPartMaterialIds } from '../../application/projects/part-materials'
import { useStockRepository } from '../inventory/stock-repository'
import type { Material } from '../../domain/model/material'
import type { Part } from '../../domain/model/part'
import AppIcon from '../../shared/ui/AppIcon.vue'
import { persistenceErrorMessage } from '../../shared/ui/persistence-error-message'
import MaterialThumbnail from '../materials/MaterialThumbnail.vue'
import { useMaterialRepository } from '../materials/material-repository'
import { useProjectId, useProjectService } from '../projects/project-service'
import CatalogFormDialog from '../suppliers/CatalogFormDialog.vue'
import { useCatalogRepositories } from '../suppliers/catalog-repositories'
import PartsJsonTransfer from './PartsJsonTransfer.vue'
import PartDiagram from './PartDiagram.vue'
import PartForm from './PartForm.vue'
import { usePartRepository } from './part-repository'

const repository = usePartRepository()
const materialRepository = useMaterialRepository()
const service = useProjectService()
const projectId = useProjectId()
const catalog = useCatalogRepositories()
const stockRepository = useStockRepository()
const parts = shallowRef<readonly Part[]>([])
const materials = shallowRef<readonly Material[]>([])
const availableIds = ref<readonly Material['id'][]>([])
const availableMaterials = computed(() => materials.value.filter(material => availableIds.value.includes(material.id)))
const query = ref('')
const visibleParts = computed(() => parts.value.filter(part => part.name.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())))
const selectedId = ref<Part['id'] | null>(null)
const selected = computed(() => visibleParts.value.find(part => part.id === selectedId.value) ?? visibleParts.value[0])
const loading = ref(true)
const busy = ref(false)
const loadError = ref('')
const materialError = ref('')
const operationError = ref('')
const notice = ref('')
const editing = shallowRef<Part | null>(null)
const formOpen = ref(false)
const formVersion = ref(0)
const partForm = ref<InstanceType<typeof PartForm> | null>(null)

async function loadMaterials(): Promise<void> {
  const [materialResult, project, products, stock] = await Promise.all([
    materialRepository.list(), service.projects.get(projectId), catalog.supplierProducts.list(), stockRepository?.list() ?? Promise.resolve({ ok: true as const, value: [] }),
  ])
  materials.value = materialResult.ok ? materialResult.value : []
  availableIds.value = []
  materialError.value = ''
  if (!materialResult.ok) materialError.value = persistenceErrorMessage(materialResult.error, 'Material')
  else if (!project.ok) materialError.value = persistenceErrorMessage(project.error, 'Project')
  else if (!products.ok) materialError.value = persistenceErrorMessage(products.error, 'Product')
  else if (!stock.ok) materialError.value = persistenceErrorMessage(stock.error, 'Stock item')
  else availableIds.value = projectPartMaterialIds(project.value, products.value, stock.value)
}
async function load(): Promise<void> {
  loading.value = true
  const [partResult] = await Promise.all([repository.list(), loadMaterials()])
  loadError.value = partResult.ok ? '' : persistenceErrorMessage(partResult.error, 'Part')
  parts.value = partResult.ok ? partResult.value : []
  loading.value = false
}
async function edit(part: Part | null): Promise<void> {
  editing.value = part
  formVersion.value++
  operationError.value = ''
  notice.value = ''
  formOpen.value = true
  await nextTick()
  partForm.value?.focusName()
}
function closeForm(): void { if (!busy.value) { formOpen.value = false; operationError.value = '' } }
async function save(part: Part): Promise<void> {
  if (busy.value || loading.value || loadError.value || materialError.value) return
  busy.value = true
  operationError.value = ''
  notice.value = ''
  // Reread both selection and catalog sources before committing a draft.
  await loadMaterials()
  if (materialError.value || !availableMaterials.value.some(material => material.id === part.materialId)) {
    operationError.value = materialError.value || 'The selected material is no longer available to this project. Select it in Materials or choose another.'
    busy.value = false
    return
  }
  const material = await materialRepository.get(part.materialId)
  if (!material.ok) {
    operationError.value = material.error.kind === 'notFound'
      ? 'The selected material no longer exists. Choose an existing material.'
      : persistenceErrorMessage(material.error, 'Material')
    busy.value = false
    return
  }
  const wasEditing = editing.value !== null
  const result = wasEditing ? await repository.update(part.id, part) : await repository.create(part)
  if (result.ok) {
    formOpen.value = false
    selectedId.value = result.value.id
    notice.value = wasEditing ? 'Part updated.' : 'Part created.'
    await load()
  } else operationError.value = persistenceErrorMessage(result.error, 'Part')
  busy.value = false
}
async function remove(part: Part): Promise<void> {
  if (busy.value || loading.value) return
  if (!window.confirm(`Delete “${part.name}”? This cannot be undone.`)) return
  busy.value = true
  operationError.value = ''
  notice.value = ''
  const result = await repository.delete(part.id)
  if (result.ok) {
    if (editing.value?.id === part.id) formOpen.value = false
    notice.value = 'Part deleted.'
    await load()
  } else operationError.value = persistenceErrorMessage(result.error, 'Part')
  busy.value = false
}
function materialFor(part: Part): Material | undefined { return materials.value.find(material => material.id === part.materialId) }
function materialName(part: Part): string { return materialFor(part)?.name ?? (materialError.value ? 'Material unavailable' : 'Missing material') }
function grain(part: Part): string { return part.grainDirection === 'none' ? 'None' : part.grainDirection === 'length' ? 'Along length' : 'Along width' }
onMounted(load)
</script>

<template>
  <section class="min-w-0 space-y-5">
    <header class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <div class="flex items-center gap-3">
          <h1 class="text-3xl font-semibold tracking-tight">
            Parts
          </h1>
          <span
            v-if="!loading && !loadError"
            class="rounded-full bg-subtle px-3 py-1 text-sm text-muted"
          >{{ parts.length }} parts</span>
        </div>
        <p class="mt-2 text-sm text-muted">
          Finished dimensions, production quantities and cutting constraints for this project.
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <PartsJsonTransfer
          :disabled="busy || loading || Boolean(loadError) || formOpen"
          @imported="load"
        />
        <button
          type="button"
          class="button button-primary"
          :disabled="busy || loading || Boolean(loadError) || Boolean(materialError) || availableMaterials.length === 0"
          @click="edit(null)"
        >
          <AppIcon
            name="plus"
            class="size-4"
          /> New part
        </button>
      </div>
    </header>
    <p
      v-if="notice"
      role="status"
      class="rounded-lg bg-success-surface px-4 py-3 text-sm text-success"
    >
      {{ notice }}
    </p>
    <p
      v-if="operationError && !formOpen"
      role="alert"
      class="text-sm text-danger"
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
    <div
      v-else-if="!loading && availableMaterials.length === 0"
      class="panel space-y-3 p-5"
    >
      <h2 class="font-semibold">
        Select materials to get started
      </h2>
      <p class="text-sm text-muted">
        Select materials for this project before creating or editing parts. Your existing parts stay saved.
      </p>
      <RouterLink
        :to="`/projects/${projectId}/materials`"
        class="button button-primary"
      >
        Select materials
      </RouterLink>
    </div>
    <div class="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div
        class="panel min-w-0 overflow-hidden"
        :aria-busy="loading"
      >
        <div class="flex items-center gap-3 border-b border-line p-4">
          <div class="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-subtle px-3 focus-within:ring-2 focus-within:ring-accent">
            <AppIcon
              name="search"
              class="size-4 shrink-0 text-muted"
            />
            <input
              v-model="query"
              aria-label="Search parts by name"
              type="search"
              class="h-10 w-full min-w-0 bg-transparent text-sm outline-none"
              placeholder="Search parts…"
            >
          </div>
          <button
            type="button"
            class="button text-sm"
            :disabled="loading || busy"
            @click="load"
          >
            Refresh
          </button>
        </div>
        <p
          v-if="loading"
          role="status"
          class="p-10 text-center text-muted"
        >
          Loading parts…
        </p>
        <div
          v-else-if="loadError"
          class="space-y-4 p-6"
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
          class="space-y-3 px-6 py-12 text-center"
        >
          <AppIcon
            name="layers"
            class="mx-auto size-8 text-muted"
          />
          <h2 class="text-lg font-semibold">
            No parts yet
          </h2>
          <p class="text-sm text-muted">
            Add the finished pieces you want to cut for this project.
          </p>
          <button
            type="button"
            class="button button-primary"
            :disabled="busy || Boolean(materialError) || availableMaterials.length === 0"
            @click="edit(null)"
          >
            Add first part
          </button>
        </div>
        <p
          v-else-if="visibleParts.length === 0"
          class="p-8 text-center text-sm text-muted"
        >
          No parts match your search.
        </p>
        <div
          v-else
          class="overflow-x-auto"
          tabindex="0"
          role="region"
          aria-label="Parts table, scroll horizontally to see all columns"
        >
          <table class="w-full text-left text-sm">
            <caption class="sr-only">
              Project parts with finished dimensions in millimeters.
            </caption>
            <thead class="bg-subtle text-xs text-muted">
              <tr>
                <th
                  scope="col"
                  class="px-4 py-3"
                >
                  Part
                </th><th
                  scope="col"
                  class="px-3 py-3"
                >
                  Material
                </th>
                <th
                  scope="col"
                  class="whitespace-nowrap px-3 py-3 text-right"
                >
                  Length × width (mm)
                </th>
                <th
                  scope="col"
                  class="px-3 py-3 text-right"
                >
                  Thickness (mm)
                </th>
                <th
                  scope="col"
                  class="px-3 py-3 text-right"
                >
                  Quantity
                </th>
                <th
                  scope="col"
                  class="px-3 py-3"
                >
                  Grain
                </th><th
                  scope="col"
                  class="px-3 py-3"
                >
                  90° rotation
                </th>
                <th
                  scope="col"
                  class="px-3 py-3 text-right"
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="part in visibleParts"
                :key="part.id"
                class="cursor-pointer border-t border-line hover:bg-subtle"
                :class="selected?.id === part.id ? 'bg-success-surface' : ''"
                @click="selectedId = part.id"
              >
                <th
                  scope="row"
                  class="min-w-32 px-4 py-3 font-medium"
                >
                  <button
                    type="button"
                    class="text-left text-ink [overflow-wrap:anywhere]"
                    :aria-label="`Select ${part.name}`"
                    :aria-pressed="selected?.id === part.id"
                    @click.stop="selectedId = part.id"
                  >
                    {{ part.name }}
                  </button>
                </th>
                <td class="min-w-40 px-3 py-3">
                  <div class="flex items-center gap-2">
                    <MaterialThumbnail :preset-id="materialFor(part)?.libraryPresetId" /><span>{{ materialName(part) }}<span
                      v-if="!availableIds.includes(part.materialId)"
                      class="mt-1 block text-xs text-danger"
                    >Not selected for this project</span></span>
                  </div>
                </td>
                <td class="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                  {{ part.lengthMm }} × {{ part.widthMm }}
                </td>
                <td class="px-3 py-3 text-right tabular-nums">
                  {{ part.thicknessMm }}
                </td><td class="px-3 py-3 text-right tabular-nums">
                  {{ part.quantity }}
                </td>
                <td class="whitespace-nowrap px-3 py-3">
                  {{ grain(part) }}
                </td><td class="px-3 py-3">
                  {{ part.rotation === 'allowed' ? 'Allowed' : 'Forbidden' }}
                </td>
                <td class="px-3 py-3">
                  <div class="flex justify-end gap-1">
                    <button
                      type="button"
                      class="button size-9 justify-center p-2"
                      :disabled="busy || Boolean(materialError) || availableMaterials.length === 0"
                      :aria-label="`Edit ${part.name}`"
                      @click.stop="edit(part)"
                    >
                      <AppIcon
                        name="edit"
                        class="size-4"
                      />
                    </button>
                    <button
                      type="button"
                      class="button size-9 justify-center p-2 text-danger"
                      :disabled="busy"
                      :aria-label="`Delete ${part.name}`"
                      @click.stop="remove(part)"
                    >
                      <AppIcon
                        name="delete"
                        class="size-4"
                      />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <aside
        v-if="!loading && !loadError"
        class="panel grid min-w-0 gap-5 p-5 sm:grid-cols-2 xl:sticky xl:top-5 xl:grid-cols-1"
        aria-label="Part details"
      >
        <template v-if="selected">
          <div class="mx-auto w-full max-w-[300px] space-y-4">
            <MaterialThumbnail
              :preset-id="materialFor(selected)?.libraryPresetId"
              variant="preview"
              class="max-h-36"
            />
            <div>
              <p class="eyebrow">
                Part details
              </p><h2 class="mt-1 break-words text-xl font-semibold">
                {{ selected.name }}
              </h2><p class="mt-1 text-sm text-muted">
                {{ materialName(selected) }}
              </p>
            </div>
            <PartDiagram :part="selected" />
          </div>
          <div class="space-y-5">
            <dl class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <dt class="text-muted">
                Length
              </dt><dd class="text-right tabular-nums">
                {{ selected.lengthMm }} mm
              </dd>
              <dt class="text-muted">
                Width
              </dt><dd class="text-right tabular-nums">
                {{ selected.widthMm }} mm
              </dd>
              <dt class="text-muted">
                Thickness
              </dt><dd class="text-right tabular-nums">
                {{ selected.thicknessMm }} mm
              </dd>
              <dt class="text-muted">
                Quantity
              </dt><dd class="text-right tabular-nums">
                {{ selected.quantity }}
              </dd>
              <dt class="text-muted">
                Grain direction
              </dt><dd class="text-right">
                {{ grain(selected) }}
              </dd>
              <dt class="text-muted">
                90° rotation
              </dt><dd class="text-right">
                {{ selected.rotation === 'allowed' ? 'Allowed' : 'Forbidden' }}
              </dd>
            </dl>
            <p
              v-if="!availableIds.includes(selected.materialId)"
              class="text-sm text-muted"
            >
              This part's material is not selected for the project. Its saved association has been preserved.
            </p>
            <div class="flex flex-wrap gap-2 border-t border-line pt-4">
              <button
                type="button"
                class="button button-primary flex-1"
                :disabled="busy || Boolean(materialError) || availableMaterials.length === 0"
                @click="edit(selected)"
              >
                Edit part
              </button>
              <button
                type="button"
                class="button button-danger"
                :disabled="busy"
                @click="remove(selected)"
              >
                Delete part
              </button>
            </div>
          </div>
        </template>
        <p
          v-else
          class="text-sm text-muted"
        >
          Select a part to inspect its dimensions and cutting constraints.
        </p>
      </aside>
    </div>
    <CatalogFormDialog
      v-if="formOpen"
      :title="editing ? 'Edit part' : 'New part'"
      :busy="busy"
      drawer
      close-label="Close part form"
      @close="closeForm"
    >
      <p
        v-if="operationError"
        role="alert"
        class="mb-4 text-sm text-danger"
      >
        {{ operationError }}
      </p>
      <p
        v-if="editing && !availableIds.includes(editing.materialId)"
        class="mb-4 text-sm text-muted"
      >
        The saved material is not available to this project. Select it in Materials or choose an available replacement.
      </p>
      <PartForm
        :key="formVersion"
        ref="partForm"
        :part="editing"
        :materials="availableMaterials"
        :disabled="loading || Boolean(loadError) || Boolean(materialError)"
        :busy="busy"
        @save="save"
        @cancel="closeForm"
      />
    </CatalogFormDialog>
  </section>
</template>
