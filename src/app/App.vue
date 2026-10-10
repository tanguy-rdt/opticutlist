<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <div class="flex min-h-screen flex-col bg-stone-50 text-stone-900">
    <header class="border-b border-stone-200 bg-white">
      <nav
        class="mx-auto flex max-w-6xl items-center justify-between px-4 py-3"
        aria-label="Main"
      >
        <RouterLink
          to="/"
          class="text-lg font-semibold tracking-tight text-amber-800"
        >
          OptiCutList
        </RouterLink>
      </nav>
    </header>

    <main class="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      <RouterView />
    </main>

    <footer class="border-t border-stone-200 py-4 text-center text-sm text-stone-500">
      Data stays in your browser. Open source under GPL-3.0.
    </footer>
  </div>
</template>
