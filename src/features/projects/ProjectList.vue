<script setup lang="ts">
import type { CuttingProject } from '../../domain/model/cutting-project'
import ProjectRow from './ProjectRow.vue'
defineProps<{ projects: readonly CuttingProject[]; disabled: boolean }>()
const emit = defineEmits<{ edit: [project: CuttingProject]; delete: [project: CuttingProject] }>()
</script>
<template>
  <ul
    aria-label="Projects"
    class="divide-y divide-line rounded-xl bg-surface"
  >
    <ProjectRow
      v-for="project in projects"
      :key="project.id"
      :project="project"
      :disabled="disabled"
      @edit="emit('edit', $event)"
      @delete="emit('delete', $event)"
    />
  </ul>
</template>
