<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { RouterLink } from 'vue-router'
import type { ProjectStockHandling } from '../../application/projects/project-deletion'
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
const deleting = shallowRef<CuttingProject | null>(null)
const stockHandling = ref<ProjectStockHandling>('keep')
const restorationIssues = ref<readonly string[]>([])
const deletionLoading = ref(false)
const deletionError = ref('')
const formMode = ref<'create' | 'rename' | null>(null)
const editing = shallowRef<CuttingProject | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)
let deletionGeneration = 0
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
  if (busy.value) return
  deleting.value = project; stockHandling.value = 'keep'; deletionError.value = ''; restorationIssues.value = []; deletionLoading.value = true
  const current = ++deletionGeneration
  const preview = await service.deletionPreview(project.id)
  if (current !== deletionGeneration) return
  deletionLoading.value = false
  if (preview.ok) restorationIssues.value = preview.value.restorationIssues
  else restorationIssues.value = [persistenceErrorMessage(preview.error, 'Project')]
}
function closeDeletion(): void { if (!busy.value) { deletionGeneration++; deleting.value = null; deletionLoading.value = false } }
async function confirmDeletion(): Promise<void> {
  const project = deleting.value
  if (!project || busy.value || deletionLoading.value) return
  busy.value = true; deletionError.value = ''; notice.value = ''
  const current = generation
  const result = await service.deleteProject(project.id, stockHandling.value)
  if (current !== generation) return
  busy.value = false
  if (!result.ok) deletionError.value = persistenceErrorMessage(result.error, 'Project')
  else { closeDeletion(); notice.value = 'Project deleted.'; await load() }
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
        </div>
      </article>
    </div>
    <CatalogFormDialog
      v-if="deleting"
      class="project-delete-dialog"
      :title="`Delete &quot;${deleting.name}&quot;?`"
      close-label="Close deletion dialog"
      aria-describedby="project-delete-description"
      :busy="busy"
      @close="closeDeletion"
    >
      <form
        class="space-y-3"
        @submit.prevent="confirmDeletion"
      >
        <p
          id="project-delete-description"
          class="text-sm leading-relaxed text-muted"
        >
          This will permanently delete the project and its cutting plans.
        </p>
        <fieldset
          class="space-y-1"
          :disabled="busy || deletionLoading"
        >
          <legend class="mb-2 text-sm font-medium">
            What should happen to physical stock?
          </legend>
          <label
            class="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 focus-within:ring-2 focus-within:ring-accent"
            :class="stockHandling === 'keep' ? 'bg-subtle' : 'hover:bg-quiet-surface'"
          >
            <input
              v-model="stockHandling"
              class="mt-1 shrink-0 accent-accent"
              type="radio"
              name="stock-handling"
              value="keep"
              aria-describedby="keep-stock-description"
            >
            <span class="min-w-0 text-sm">
              <span class="flex flex-wrap items-baseline gap-x-2"><strong class="font-medium">Keep current stock</strong><span class="text-xs text-accent">Recommended</span></span>
              <span
                id="keep-stock-description"
                class="mt-0.5 block leading-relaxed text-muted"
              >Keep consumed panels and saved offcuts as they are.</span>
            </span>
          </label>
          <label
            class="flex items-start gap-3 rounded-lg px-3 py-2.5 focus-within:ring-2 focus-within:ring-accent"
            :class="[stockHandling === 'restore' ? 'bg-subtle' : 'hover:bg-quiet-surface', restorationIssues.length ? 'cursor-not-allowed opacity-60' : 'cursor-pointer']"
          >
            <input
              v-model="stockHandling"
              class="mt-1 shrink-0 accent-accent"
              type="radio"
              name="stock-handling"
              value="restore"
              :aria-describedby="restorationIssues.length ? 'restore-stock-description stock-restoration-conflicts' : 'restore-stock-description'"
              :disabled="restorationIssues.length > 0"
            >
            <span class="min-w-0 text-sm">
              <strong class="font-medium">Restore initial stock</strong>
              <span
                id="restore-stock-description"
                class="mt-0.5 block leading-relaxed text-muted"
              >Undo this project's stock changes, if possible.</span>
            </span>
          </label>
        </fieldset>
        <p
          v-if="deletionLoading"
          role="status"
          class="text-sm text-muted"
        >
          Checking stock dependencies…
        </p>
        <div
          v-if="restorationIssues.length"
          id="stock-restoration-conflicts"
          class="text-sm text-danger"
          role="status"
        >
          <p>Restoration is unavailable. You can keep current stock.</p>
          <ul class="mt-1 list-disc pl-5">
            <li
              v-for="issue in restorationIssues"
              :key="issue"
            >
              {{ issue }}
            </li>
          </ul>
        </div>
        <p
          v-if="deletionError"
          role="alert"
          class="text-sm text-danger"
        >
          {{ deletionError }}
        </p>
        <div class="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
          <p class="mr-auto text-xs text-muted">
            This cannot be undone.
          </p>
          <button
            type="button"
            class="button min-h-9 px-3 py-1.5 text-sm"
            :disabled="busy"
            @click="closeDeletion"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="button button-danger min-h-9 px-3 py-1.5 text-sm"
            :disabled="busy || deletionLoading"
          >
            {{ busy ? 'Deleting…' : 'Delete project' }}
          </button>
        </div>
      </form>
    </CatalogFormDialog>
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

<style scoped>
.project-delete-dialog {
  width: min(520px, calc(100vw - 2rem));
  padding: 1.25rem;
}
.project-delete-dialog :deep(> div:first-child) {
  align-items: flex-start;
  margin-bottom: 0.5rem;
}
.project-delete-dialog :deep(#catalog-dialog-title) {
  padding-top: 0.25rem;
  overflow-wrap: anywhere;
}
.project-delete-dialog :deep(button[aria-label='Close deletion dialog']) {
  min-height: 2rem;
  width: 2rem;
  height: 2rem;
  padding: 0.375rem;
  border-color: transparent;
  background: transparent;
  color: var(--color-muted);
}
.project-delete-dialog :deep(button[aria-label='Close deletion dialog']:hover) {
  background: var(--color-subtle);
  color: var(--color-ink);
}
</style>
