<script setup lang="ts">
import { onMounted, provide, ref, shallowRef } from 'vue'
import { RouterLink, RouterView } from 'vue-router'
import { cuttingProjectIdSchema } from '../../domain/model/ids'
import type { CuttingProject } from '../../domain/model/cutting-project'
import { persistenceErrorMessage } from '../../shared/ui/persistence-error-message'
import { partRepositoryKey } from '../parts/part-repository'
import { projectIdKey, useProjectService } from './project-service'
import ProjectExport from './ProjectExport.vue'
import { cuttingWorkspaceStateKey } from './cutting-workspace-state'
import { useCurrentResultService } from '../optimization/current-result-service'

const props = defineProps<{ projectId: string }>()
const service = useProjectService()
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
      const current = await currentResults?.forProject(parsedId.data).load()
      cuttingState.available.value = current?.ok === true && current.value.result !== null
    }
    else error.value = persistenceErrorMessage(result.error, 'Project')
  }
  loading.value = false
}
onMounted(load)
</script>
<template>
  <section class="space-y-6">
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
      <div class="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <p class="eyebrow">
            Open project
          </p>
          <p class="text-xl font-semibold [overflow-wrap:anywhere]">
            {{ project.name }}
          </p>
        </div>
        <nav
          aria-label="Project"
          class="flex flex-wrap gap-2"
        >
          <RouterLink
            :to="{ name: 'project-materials', params: { projectId: project.id } }"
            class="nav-link"
          >
            Materials
          </RouterLink>
          <RouterLink
            :to="{ name: 'project-parts', params: { projectId: project.id } }"
            class="nav-link"
          >
            Parts
          </RouterLink>
          <RouterLink
            :to="{ name: 'project-optimization', params: { projectId: project.id } }"
            class="nav-link"
          >
            Optimization
          </RouterLink>
          <RouterLink
            v-if="cuttingState.available.value"
            :to="{ name: 'project-cutting-plans', params: { projectId: project.id } }"
            class="nav-link"
          >
            Cutting Plans
          </RouterLink>
          <span
            v-else
            class="nav-link cursor-not-allowed opacity-60"
            aria-disabled="true"
            title="Optimize a valid cutting plan first"
          >Cutting Plans</span>
          <RouterLink
            :to="{ name: 'project-stock', params: { projectId: project.id } }"
            class="nav-link"
          >
            Stock
          </RouterLink>
        </nav>
        <ProjectExport :project-id="project.id" />
      </div>
      <RouterView />
    </template>
  </section>
</template>
