<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
import ThemeSelector from './theme/ThemeSelector.vue'

function focusContent(): void {
  document.getElementById('main-content')?.focus()
}
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <a
      href="#main-content"
      class="sr-only z-50 bg-surface p-3 focus:not-sr-only focus:absolute"
      @click.prevent="focusContent"
    >Skip to content</a>
    <header class="border-b border-line bg-surface">
      <div class="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-5 lg:px-8">
        <RouterLink
          to="/"
          class="flex items-center gap-3"
          aria-label="OptiCutList home"
        >
          <svg
            class="h-10 w-10 text-accent"
            viewBox="0 0 40 40"
            fill="currentColor"
            aria-hidden="true"
          >
            <rect
              x="1"
              y="1"
              width="23"
              height="23"
              rx="3"
            />
            <rect
              x="27"
              y="1"
              width="12"
              height="23"
              rx="3"
            />
            <rect
              x="1"
              y="27"
              width="38"
              height="12"
              rx="3"
            />
          </svg>
          <span><span class="block text-xl font-bold tracking-tight">OptiCutList</span><span class="block text-xs text-muted">A clearer plan for your workshop</span></span>
        </RouterLink>
        <ThemeSelector />
      </div>
    </header>
    <main
      id="main-content"
      tabindex="-1"
      class="mx-auto w-full flex-1 lg:px-8 lg:py-10"
      :class="$route.name === 'suppliers' ? 'max-w-[1800px] px-4 py-6 sm:px-6' : 'max-w-7xl px-6 py-8'"
    >
      <RouterView :key="String($route.params.projectId ?? '')" />
    </main>
    <footer class="mx-auto flex w-full max-w-7xl flex-wrap justify-between gap-2 px-6 py-6 text-xs text-muted lg:px-8">
      <span>Saved on this device. Browser storage can be cleared.</span>
      <span>OptiCutList · Open source · GPL-3.0</span>
    </footer>
  </div>
</template>
