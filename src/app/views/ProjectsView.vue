<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <section class="space-y-6">
    <div class="max-w-2xl space-y-3">
      <p class="eyebrow">
        Project workspace
      </p>
      <h1 class="text-3xl font-semibold tracking-tight">
        Projects
      </h1>
      <p class="leading-relaxed text-muted">
        Project creation is not available yet. Parts and material selections will belong to an
        opened project. Existing stored records are preserved.
      </p>
    </div>
    <RouterLink
      to="/"
      class="button"
    >
      <span aria-hidden="true">←</span> Return home
    </RouterLink>
  </section>
</template>
