<script setup lang="ts">
import AppButton from '../../shared/ui/AppButton.vue'
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
import AppDialog from '../../shared/ui/AppDialog.vue'
import { useProjectNavigation } from '../../features/projects/project-navigation'
import { useProjectService } from '../../features/projects/project-service'

const service = useProjectService()
const navigation = useProjectNavigation()
const projects = shallowRef<readonly CuttingProject[]>([])
const loading = ref(true)
const search = ref('')
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
  closeForm()
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
  else { if (navigation?.activeId === project.id) navigation.activeId = null; if (navigation) navigation.tabs.delete(project.id); closeDeletion(); notice.value = 'Project deleted.'; await load() }
}

onMounted(load)
</script>
<template>
  <section class="mx-auto max-w-5xl space-y-5">
    <header class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 class="text-[28px] font-semibold tracking-tight">
          Projects
        </h1><p class="mt-1 text-sm text-muted">
          Your builds, ready for the next workshop session.
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <AppButton
          type="button"
          variant="primary"
          :disabled="loading || busy || !!error"
          @click="openForm()"
        >
          <AppIcon name="plus" />New project
        </AppButton>
        <RouterLink
          to="/import?from=projects"
          class="button"
        >
          <AppIcon name="import" />Import project
        </RouterLink>
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
      </p><AppButton
        type="button"
        variant="secondary"
        :disabled="busy"
        @click="load"
      >
        Retry projects
      </AppButton>
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
    <section
      v-else-if="!loading && !error && projects.length"
      class="space-y-4"
      aria-label="Project manager"
    >
      <div class="flex flex-wrap items-center justify-between gap-3">
        <label
          for="project-search"
          class="sr-only"
        >Search projects</label>
        <input
          id="project-search"
          v-model="search"
          type="search"
          class="field w-full sm:max-w-sm"
          placeholder="Search projects…"
          :disabled="busy"
        >
        <span class="text-sm text-muted">{{ visible.length }} of {{ projects.length }} projects</span>
      </div>
      <ProjectList
        v-if="visible.length"
        :projects="visible"
        :disabled="busy || !!formMode || !!deleting"
        @rename="openForm"
        @delete="remove"
      />
      <div
        v-else
        role="status"
        class="py-10 text-center"
      >
        <h2 class="font-semibold">
          No matching projects
        </h2>
        <p class="mt-1 text-sm text-muted">
          Try another name or clear your search.
        </p>
        <AppButton
          type="button"
          variant="secondary"
          class="mt-3"
          @click="search = ''"
        >
          Clear search
        </AppButton>
      </div>
    </section>
    <AppDialog
      v-if="deleting"
      size="small"
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
        <div class="dialog-actions">
          <p class="mr-auto text-xs text-muted">
            This cannot be undone.
          </p>
          <AppButton
            type="button"
            variant="secondary"
            size="small"
            :disabled="busy"
            @click="closeDeletion"
          >
            Cancel
          </AppButton>
          <AppButton
            type="submit"
            variant="destructive"
            size="small"
            :disabled="busy || deletionLoading"
          >
            {{ busy ? 'Deleting…' : 'Delete project' }}
          </AppButton>
        </div>
      </form>
    </AppDialog>
    <ProjectCreationDialog
      v-if="formMode === 'create'"
      @close="closeForm"
    />
    <AppDialog
      v-if="formMode === 'rename'"
      title="Rename project"
      size="small"
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
        <div class="dialog-actions">
          <AppButton
            type="submit"
            variant="primary"
            :disabled="busy"
          >
            {{ busy ? 'Saving…' : 'Save name' }}
          </AppButton>
        </div>
      </form>
    </AppDialog>
  </section>
</template>
