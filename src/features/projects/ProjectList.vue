<script setup lang="ts">
import type { CuttingProject } from '../../domain/model/cutting-project'
defineProps<{ projects: readonly CuttingProject[]; selectedId: string; disabled: boolean }>()
const emit = defineEmits<{ select: [project: CuttingProject] }>()
</script>
<template>
  <ul
    aria-label="Projects"
    class="space-y-1"
  >
    <li
      v-for="project in projects"
      :key="project.id"
    >
      <button
        type="button"
        class="w-full rounded-xl border px-4 py-3 text-left transition-colors hover:bg-subtle"
        :class="selectedId === project.id ? 'border-selection-line bg-success-surface text-accent' : 'border-transparent'"
        :aria-pressed="selectedId === project.id"
        :aria-label="`Select project ${project.name}`"
        :disabled="disabled"
        @click="emit('select', project)"
      >
        <span class="block font-semibold [overflow-wrap:anywhere]">{{ project.name }}</span>
        <span class="mt-1 block text-xs text-muted">{{ project.partIds.length }} part references · {{ project.materialIds.length }} selected materials</span>
      </button>
    </li>
  </ul>
</template>
