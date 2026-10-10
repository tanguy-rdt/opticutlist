<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <section class="space-y-8">
    <div class="space-y-3">
      <p class="eyebrow">
        Your workshop
      </p>
      <h1 class="text-3xl font-semibold tracking-tight md:text-4xl">
        Welcome to OptiCutList
      </h1>
      <p class="max-w-2xl leading-relaxed text-muted">
        Good cuts start with an organized workshop. Build your material and part libraries, ready for planning rectangular panel cuts.
      </p>
    </div>
    <div class="grid gap-6 md:grid-cols-2">
      <article class="panel flex flex-col items-start gap-4 p-6 md:p-8">
        <span class="eyebrow">Start here</span>
        <h2 class="text-xl font-semibold">
          Your material library
        </h2>
        <p class="max-w-prose text-muted">
          Keep material names and categories consistent across your work. Add plywood, MDF, solid wood, and other materials you use.
        </p>
        <RouterLink
          to="/materials"
          class="button button-primary mt-auto"
        >
          Manage materials <span aria-hidden="true">→</span>
        </RouterLink>
      </article>
      <article class="panel flex flex-col items-start gap-4 p-6 md:p-8">
        <span class="eyebrow">Next step</span>
        <h2 class="text-xl font-semibold">
          Your part library
        </h2>
        <p class="max-w-prose text-muted">
          Define finished dimensions, quantities, materials, grain direction, and rotation restrictions for the parts you need.
        </p>
        <RouterLink
          to="/parts"
          class="button mt-auto"
        >
          Manage parts <span aria-hidden="true">→</span>
        </RouterLink>
      </article>
    </div>
    <p class="text-sm text-muted">
      Your material and part libraries stay in this browser. No account required.
    </p>
  </section>
</template>
