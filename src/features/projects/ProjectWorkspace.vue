<script setup lang="ts">
import { onActivated, onMounted, provide, ref, shallowRef, watch } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { cuttingProjectIdSchema } from '../../domain/model/ids'
import type { CuttingProject } from '../../domain/model/cutting-project'
import AppIcon from '../../shared/ui/AppIcon.vue'
import { persistenceErrorMessage } from '../../shared/ui/persistence-error-message'
import { partRepositoryKey } from '../parts/part-repository'
import { projectIdKey, useProjectService } from './project-service'
import { useProjectNavigation } from './project-navigation'
import { cuttingWorkspaceStateKey } from './cutting-workspace-state'
import { useCurrentResultService } from '../optimization/current-result-service'

defineOptions({ name: 'ProjectWorkspace' })
const props = defineProps<{ projectId: string }>()
const service = useProjectService()
const navigation = useProjectNavigation()
const route = useRoute()
const workspaceRoute = shallowRef({ ...route })
const sections = [
  { label: 'Materials', route: 'project-materials' },
  { label: 'Parts', route: 'project-parts' },
  { label: 'Optimization', route: 'project-optimization' },
  { label: 'Cutting Plans', route: 'project-cutting-plans' },
  { label: 'Stock', route: 'project-stock' },
] as const
function remember(): void {
  if (route.params.projectId !== props.projectId || !project.value) return
  workspaceRoute.value = { ...route }
  if (navigation) {
    navigation.activeId = project.value.id;
    navigation.destination = 'workspace';
    navigation.tabs.set(project.value.id, route.fullPath)
  }
}
watch(() => route.fullPath, remember)
const parsedId = cuttingProjectIdSchema.safeParse(props.projectId)
const project = shallowRef<CuttingProject | null>(null)
const loading = ref(true)
const error = ref('')
const cuttingState = { available: ref(false), invalidated: ref(false) }
provide(cuttingWorkspaceStateKey, cuttingState)
const currentResults = useCurrentResultService()
if (parsedId.success) {
  provide(projectIdKey, parsedId.data)
  provide(partRepositoryKey, service.parts(parsedId.data))
}
async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  project.value = null
  if (!parsedId.success) error.value = 'Invalid project ID. Open an existing project from Home.'
  else {
    const result = await service.projects.get(parsedId.data)
    if (result.ok) {
      project.value = result.value
      remember()
      const current = await currentResults?.forProject(parsedId.data).load()
      cuttingState.available.value = current?.ok === true && current.value.result !== null
    }
    else error.value = persistenceErrorMessage(result.error, 'Project')
  }
  loading.value = false
}
let activated = false
onActivated(async () => {
  if (!activated) {
    activated = true;
    return
  }
  if (!parsedId.success) return
  const latest = await service.projects.get(parsedId.data)
  if (latest.ok) {
    project.value = latest.value;
    remember()
  }
  else {
    project.value = null;
    error.value = persistenceErrorMessage(latest.error, 'Project')
  }
})
onMounted(load)
</script>
<template>
  <section class="min-w-0 space-y-6">
    <p
      v-if="loading"
      role="status"
      class="text-muted"
    >
      Opening project…
    </p>
    <div
      v-else-if="error"
      class="panel space-y-4 p-6"
    >
      <h1 class="text-2xl font-semibold">
        Could not open project
      </h1>
      <p
        role="alert"
        class="text-danger"
      >
        {{ error }}
      </p>
      <button
        type="button"
        class="button"
        @click="load"
      >
        Retry opening
      </button>
    </div>
    <template v-else-if="project">
      <header class="project-header flex min-w-0 flex-wrap items-center justify-between gap-x-5 gap-y-2 border-b border-line pb-3">
        <nav
          aria-label="Project context"
          class="min-w-0 flex-1 basis-40"
        >
          <ol class="flex min-w-0 items-center gap-2 text-sm">
            <li class="shrink-0">
              <RouterLink
                to="/projects"
                class="rounded text-muted hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                All projects
              </RouterLink>
            </li>
            <li class="flex min-w-0 items-center gap-2">
              <AppIcon
                name="chevron"
                class="size-3 text-muted"
              />
              <span
                class="truncate font-semibold"
                :title="project.name"
              >{{ project.name }}</span>
            </li>
          </ol>
        </nav>
        <nav
          aria-label="Project"
          class="ml-auto min-w-0 max-w-full overflow-x-auto"
        >
          <ol class="flex w-max items-center gap-1">
            <li
              v-for="(section, index) in sections"
              :key="section.route"
              class="flex shrink-0 items-center gap-1"
            >
              <AppIcon
                v-if="index"
                name="chevron"
                class="size-3 text-muted"
              />
              <RouterLink
                v-slot="{ href, navigate, isExactActive }"
                :to="{ name: section.route, params: { projectId: project.id } }"
                custom
              >
                <a
                  :href="href"
                  :aria-label="section.label"
                  :aria-current="isExactActive ? 'page' : undefined"
                  class="grid shrink-0 items-center rounded-md px-2 py-1.5 text-sm whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
                  :class="isExactActive ? 'bg-subtle font-semibold text-accent' : 'font-normal text-muted hover:font-semibold hover:text-accent'"
                  @click="navigate"
                >
                  <!-- Reserve the semibold label width to keep hover from shifting adjacent links. -->
                  <span
                    aria-hidden="true"
                    class="invisible col-start-1 row-start-1 font-semibold"
                  >{{ section.label }}</span>
                  <span class="col-start-1 row-start-1">{{ section.label }}</span>
                </a>
              </RouterLink>
            </li>
          </ol>
        </nav>
      </header>
      <RouterView :route="workspaceRoute" />
    </template>
  </section>
</template>
