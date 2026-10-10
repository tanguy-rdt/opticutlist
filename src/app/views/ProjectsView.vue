<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <section class="space-y-6">
    <div class="space-y-2">
      <p class="eyebrow">
        Coming later
      </p>
      <h1 class="text-3xl font-semibold tracking-tight">
        Projects
      </h1>
      <p class="text-muted">
        A place to organize parts and plan your next build.
      </p>
    </div>
    <div class="panel max-w-2xl space-y-4 p-8">
      <h2 class="text-xl font-semibold">
        Prepare your material library
      </h2>
      <p class="text-muted">
        Project management is not available yet. You can already add the materials you work with.
      </p>
      <RouterLink
        to="/materials"
        class="button button-primary"
      >
        Manage materials
      </RouterLink>
    </div>
  </section>
</template>
