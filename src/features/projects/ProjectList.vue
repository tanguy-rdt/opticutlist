<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue'
import { RouterLink } from 'vue-router'
import type { CuttingProject } from '../../domain/model/cutting-project'
import { persistenceErrorMessage } from '../../shared/ui/persistence-error-message'
import { useProjectService } from './project-service'

const service = useProjectService()
const projects = shallowRef<readonly CuttingProject[]>([])
const loading = ref(true)
const error = ref('')
async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  const result = await service.projects.list()
  if (result.ok) projects.value = result.value
  else { projects.value = []; error.value = persistenceErrorMessage(result.error, 'Project') }
  loading.value = false
}
onMounted(load)
</script>
<template>
  <section
    class="panel space-y-4 p-6"
    aria-labelledby="saved-projects-title"
    :aria-busy="loading"
  >
    <div class="flex items-center justify-between gap-3">
      <h2
        id="saved-projects-title"
        class="text-xl font-semibold"
      >
        Your projects
      </h2>
      <button
        type="button"
        class="button"
        :disabled="loading"
        @click="load"
      >
        Refresh projects
      </button>
    </div>
    <p
      v-if="loading"
      role="status"
      class="text-muted"
    >
      Loading projects…
    </p>
    <div
      v-else-if="error"
      class="space-y-3"
    >
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
        Retry projects
      </button>
    </div>
    <p
      v-else-if="projects.length === 0"
      class="text-muted"
    >
      No projects yet. Start with New Project.
    </p>
    <ul
      v-else
      class="grid gap-3 sm:grid-cols-2"
    >
      <li
        v-for="project in projects"
        :key="project.id"
      >
        <RouterLink
          :to="{ name: 'project-parts', params: { projectId: project.id } }"
          class="button w-full justify-between [overflow-wrap:anywhere]"
        >
          {{ project.name }} <span aria-hidden="true">→</span>
        </RouterLink>
      </li>
    </ul>
  </section>
</template>
