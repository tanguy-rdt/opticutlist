<script setup lang="ts">
import { RouterLink } from 'vue-router'
defineProps<{ interactive?: boolean }>()
const emit = defineEmits<{ create: [] }>()
</script>
<template>
  <component
    :is="interactive ? 'button' : RouterLink"
    :to="interactive ? undefined : { name: 'home', query: { create: '1' } }"
    :type="interactive ? 'button' : undefined"
    class="home-card relative flex flex-col items-start gap-4 overflow-hidden p-6 text-left md:p-8"
    aria-labelledby="new-project-title"
    @click="interactive && emit('create')"
  >
    <svg
      class="pointer-events-none absolute -right-8 -top-8 h-48 w-48 text-accent opacity-[0.08]"
      viewBox="0 0 160 160"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M25 25h110v110H25z M25 85h110 M85 25v60 M55 85v50" />
      <path d="M15 25v110 M10 25h10 M10 135h10 M25 145h110 M25 140v10 M135 140v10" />
    </svg>
    <span class="home-icon">
      <svg
        viewBox="0 0 24 24"
        class="h-6 w-6"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        aria-hidden="true"
        focusable="false"
      ><path d="M4 4h10v10H4z M17 4h3v10h-3 M4 17h16v3H4z M9 7v4 M7 9h4" /></svg>
    </span>
    <div class="relative space-y-2">
      <h2
        id="new-project-title"
        class="text-2xl font-semibold tracking-tight"
      >
        New Project
      </h2>
      <p class="max-w-sm leading-relaxed text-muted">
        Give your next idea a place to grow, from the first dimensions to the final cut.
      </p>
    </div>
  </component>

  <RouterLink
    :to="interactive ? '/import?from=projects' : '/import'"
    class="home-card flex flex-col items-start gap-4 p-6 md:p-8"
    :class="{ 'md:col-start-1 md:row-start-2': !interactive }"
    aria-labelledby="import-project-title"
  >
    <span class="home-icon">
      <svg
        viewBox="0 0 24 24"
        class="h-6 w-6"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        aria-hidden="true"
        focusable="false"
      ><path d="M12 3v12 M8 11l4 4 4-4 M4 15v5h16v-5" /></svg>
    </span>
    <div class="space-y-2">
      <h2
        id="import-project-title"
        class="text-2xl font-semibold tracking-tight"
      >
        Import Project
      </h2>
      <p class="max-w-sm leading-relaxed text-muted">
        Pick up where you left off with a project from a previous workshop session.
      </p>
    </div>
  </RouterLink>
</template>
