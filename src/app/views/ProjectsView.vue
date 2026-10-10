<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <section class="space-y-6">
    <div class="max-w-2xl space-y-3">
      <p class="eyebrow">
        Existing workshop data
      </p>
      <h1 class="text-3xl font-semibold tracking-tight">
        Saved parts and materials
      </h1>
      <p class="leading-relaxed text-muted">
        Your existing libraries are still accessible here. Project creation is not available yet;
        these records are not attached to a project.
      </p>
    </div>
    <div class="grid gap-5 md:grid-cols-2">
      <article class="panel flex flex-col items-start gap-4 p-6">
        <h2 class="text-xl font-semibold">
          Parts library
        </h2>
        <p class="text-muted">
          View and edit your saved dimensions, quantities and cutting constraints.
        </p>
        <RouterLink
          to="/parts"
          class="button mt-auto"
        >
          Open saved parts <span aria-hidden="true">→</span>
        </RouterLink>
      </article>
      <article class="panel flex flex-col items-start gap-4 p-6">
        <h2 class="text-xl font-semibold">
          Material selection
        </h2>
        <p class="text-muted">
          Choose from existing catalog materials. Selections remain temporary.
        </p>
        <RouterLink
          to="/materials"
          class="button mt-auto"
        >
          Select existing materials <span aria-hidden="true">→</span>
        </RouterLink>
      </article>
    </div>
    <RouterLink
      to="/"
      class="button"
    >
      <span aria-hidden="true">←</span> Return home
    </RouterLink>
  </section>
</template>
