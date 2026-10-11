<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { RouterLink } from 'vue-router'
import { cuttingProjectSchema, type CuttingProject } from '../../domain/model/cutting-project'
import FormField from '../../shared/ui/FormField.vue'
import AppIcon from '../../shared/ui/AppIcon.vue'
import { persistenceErrorMessage } from '../../shared/ui/persistence-error-message'
import ProjectCreationDialog from '../../features/projects/ProjectCreationDialog.vue'
import ProjectList from '../../features/projects/ProjectList.vue'
import ProjectStartTiles from '../../features/projects/ProjectStartTiles.vue'
import ProjectExport from '../../features/projects/ProjectExport.vue'
import CatalogFormDialog from '../../features/suppliers/CatalogFormDialog.vue'
import { useProjectService } from '../../features/projects/project-service'

const service = useProjectService()
const projects = shallowRef<readonly CuttingProject[]>([])
const loading = ref(true)
const search = ref('')
const selectedId = ref('')
const selected = computed(() => projects.value.find(project => project.id === selectedId.value))
const visible = computed(() => projects.value.filter(project => project.name.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())))
const name = ref('')
const nameError = ref('')
const error = ref('')
const formError = ref('')
const notice = ref('')
const busy = ref(false)
const formMode = ref<'create' | 'rename' | null>(null)
const editing = shallowRef<CuttingProject | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)
let generation = 0
onBeforeUnmount(() => { generation++ })
async function load(): Promise<void> {
  const current = ++generation
  loading.value = true; error.value = ''
  const result = await service.projects.list()
  if (current !== generation) return
  loading.value = false
  if (!result.ok) { error.value = persistenceErrorMessage(result.error, 'Project'); return }
  projects.value = result.value
  if (!projects.value.some(project => project.id === selectedId.value)) selectedId.value = projects.value[0]?.id ?? ''
}
async function openForm(project: CuttingProject | null = null): Promise<void> {
  if (busy.value || loading.value || error.value) return
  editing.value = project; formMode.value = project ? 'rename' : 'create'; name.value = project?.name ?? ''
  nameError.value = ''; formError.value = ''; notice.value = ''
  await nextTick(); nameInput.value?.focus()
}
function closeForm(): void { if (!busy.value) { formMode.value = null; editing.value = null } }
async function save(): Promise<void> {
  if (busy.value) return
  nameError.value = ''; formError.value = ''
  if (!editing.value) return
  const parsed = cuttingProjectSchema.safeParse({ ...editing.value, name: name.value })
  if (!parsed.success) { nameError.value = parsed.error.issues.find(issue => issue.path[0] === 'name')?.message ?? 'Invalid project name'; nameInput.value?.focus(); return }
  busy.value = true
  const current = generation
  // Read again so renaming never replaces the cached ownership/catalog selections.
  const latest = await service.projects.get(editing.value.id)
  const result = latest.ok ? await service.projects.update(latest.value.id, { ...latest.value, name: parsed.data.name }) : latest
  if (current !== generation) return
  busy.value = false
  if (!result.ok) { formError.value = persistenceErrorMessage(result.error, 'Project'); return }
  closeForm(); selectedId.value = result.value.id
  notice.value = 'Project renamed.'; await load()
}
async function remove(project: CuttingProject): Promise<void> {
  if (busy.value || !window.confirm(`Delete project “${project.name}”? Shared catalog and physical stock will not be deleted. Projects with parts or cutting results cannot be deleted.`)) return
  busy.value = true; error.value = ''; notice.value = ''
  const current = generation
  const result = await service.projects.delete(project.id)
  if (current !== generation) return
  busy.value = false
  if (!result.ok) error.value = persistenceErrorMessage(result.error, 'Project')
  else { notice.value = 'Project deleted.'; await load() }
}
onMounted(load)
</script>
<template>
  <section class="space-y-5">
    <header class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 class="text-[28px] font-semibold tracking-tight">
          Projects
        </h1><p class="mt-1 text-sm text-muted">
          Your builds, ready for the next workshop session.
        </p>
      </div>
    </header>
    <p
      v-if="notice"
      role="status"
      class="rounded-lg bg-success-surface p-3 text-sm text-success"
    >
      {{ notice }}
    </p>
    <p
      v-if="loading"
      role="status"
      class="panel p-6 text-muted"
    >
      Loading projects…
    </p>
    <div
      v-else-if="error"
      class="panel space-y-3 p-5"
    >
      <p
        role="alert"
        class="text-danger"
      >
        {{ error }}
      </p><button
        type="button"
        class="button"
        :disabled="busy"
        @click="load"
      >
        Retry projects
      </button>
    </div>
    <div
      v-if="!loading && !error && projects.length === 0"
      class="space-y-5"
    >
      <div>
        <h2 class="text-xl font-semibold">
          Make room for your next idea.
        </h2><p class="mt-2 text-muted">
          No projects yet. Start a new build or bring one from another workshop.
        </p>
      </div>
      <div class="grid gap-5 md:grid-cols-2">
        <ProjectStartTiles
          interactive
          @create="openForm()"
        />
      </div>
    </div>
    <div
      v-else-if="!loading && projects.length"
      class="grid items-start gap-5 md:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.5fr)] xl:grid-cols-[340px_minmax(0,1fr)]"
    >
      <aside
        class="panel space-y-4 p-4"
        aria-label="Project selection"
      >
        <div class="flex items-center justify-between">
          <h2 class="font-semibold">
            Your projects
          </h2><span class="rounded-full bg-subtle px-2 py-1 text-xs text-muted">{{ projects.length }}</span>
        </div>
        <div class="flex flex-wrap gap-2">
          <RouterLink
            to="/import?from=projects"
            class="button button-compact"
          >
            <AppIcon name="import" />Import Project
          </RouterLink>
          <button
            type="button"
            class="button button-primary button-compact"
            :disabled="loading || busy || !!error"
            @click="openForm()"
          >
            <AppIcon name="plus" />New Project
          </button>
        </div>
        <ProjectExport
          v-if="selected"
          :key="selected.id"
          :project-id="selected.id"
        />
        <label
          for="project-search"
          class="sr-only"
        >Search projects</label><input
          id="project-search"
          v-model="search"
          type="search"
          class="field"
          placeholder="Search projects…"
          :disabled="busy"
        >
        <ProjectList
          :projects="visible"
          :selected-id="selectedId"
          :disabled="busy || !!formMode"
          @select="selectedId = $event.id"
        />
        <p
          v-if="!visible.length"
          role="status"
          class="py-4 text-sm text-muted"
        >
          No matching projects.
        </p>
      </aside>
      <article
        v-if="selected"
        class="panel overflow-hidden"
        aria-label="Selected project details"
      >
        <div
          class="flex aspect-[3/1] max-h-56 w-full items-center justify-center bg-subtle"
          aria-label="Project cover placeholder"
        >
          <AppIcon
            name="layers"
            class="size-16 text-accent opacity-30"
          />
        </div>
        <div class="space-y-6 p-5 md:p-6">
          <header>
            <p class="eyebrow text-accent">
              Project workspace
            </p><h2 class="mt-2 text-2xl font-semibold [overflow-wrap:anywhere]">
              {{ selected.name }}
            </h2><p class="mt-2 break-all text-xs text-muted">
              Reference: {{ selected.id }}
            </p>
          </header>
          <dl
            class="grid grid-cols-3 gap-3"
            aria-label="Project metrics"
          >
            <div class="rounded-xl bg-subtle p-3">
              <dt class="text-xs text-muted">
                Part references
              </dt><dd class="mt-1 text-2xl font-semibold">
                {{ selected.partIds.length }}
              </dd>
            </div>
            <div class="rounded-xl bg-subtle p-3">
              <dt class="text-xs text-muted">
                Selected materials
              </dt><dd class="mt-1 text-2xl font-semibold">
                {{ selected.materialIds.length }}
              </dd>
            </div>
            <div class="rounded-xl bg-subtle p-3">
              <dt class="text-xs text-muted">
                Panel references
              </dt><dd class="mt-1 text-2xl font-semibold">
                {{ selected.supplierProductIds.length }}
              </dd>
            </div>
          </dl>
          <div
            class="flex flex-wrap items-start gap-2 border-t border-line pt-5"
            aria-label="Project actions"
          >
            <RouterLink
              :to="{ name: 'project-materials', params: { projectId: selected.id } }"
              class="button button-primary"
            >
              <AppIcon name="layers" />Open project
            </RouterLink>
            <button
              type="button"
              class="button"
              :disabled="busy"
              @click="openForm(selected)"
            >
              <AppIcon name="edit" />Rename project
            </button>
            <ProjectExport
              :key="selected.id"
              :project-id="selected.id"
            />
            <button
              type="button"
              class="button button-danger"
              :disabled="busy"
              @click="remove(selected)"
            >
              <AppIcon name="delete" />Delete project
            </button>
          </div>
          <p class="text-xs text-muted">
            Projects with parts or cutting results are protected from deletion.
          </p>
        </div>
      </article>
    </div>
    <ProjectCreationDialog
      v-if="formMode === 'create'"
      @close="closeForm"
    />
    <CatalogFormDialog
      v-if="formMode === 'rename'"
      title="Rename project"
      :busy="busy"
      @close="closeForm"
    >
      <form
        class="space-y-5"
        novalidate
        :aria-busy="busy"
        @submit.prevent="save"
      >
        <FormField
          id="project-name"
          v-slot="{ controlAttrs }"
          label="Project name"
          :error="nameError"
          required
        >
          <input
            v-bind="controlAttrs"
            ref="nameInput"
            v-model="name"
            class="field"
            maxlength="200"
            autocomplete="off"
            :disabled="busy"
          >
        </FormField>
        <p
          v-if="formError"
          role="alert"
          class="text-danger"
        >
          {{ formError }}
        </p>
        <div class="flex justify-end">
          <button
            type="submit"
            class="button button-primary"
            :disabled="busy"
          >
            {{ busy ? 'Saving…' : 'Save name' }}
          </button>
        </div>
      </form>
    </CatalogFormDialog>
  </section>
</template>
