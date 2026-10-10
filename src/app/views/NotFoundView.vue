<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <section class="space-y-3">
    <h1 class="text-2xl font-bold">
      Page not found
    </h1>
    <RouterLink
      to="/"
      class="text-amber-800 underline"
    >
      Back to home
    </RouterLink>
  </section>
</template>
