<script setup lang="ts">
import { ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import ThemeSelector from './theme/ThemeSelector.vue'
const route = useRoute()
const expanded = ref(false)
const toggle = ref<HTMLButtonElement | null>(null)
const navigation = [
  { label: 'Home', to: '/', icon: 'M3 10 12 3l9 7v10h-6v-6H9v6H3Z' },
  { label: 'Projects', to: '/projects', icon: 'M3 5h7l2 3h9v12H3Z' },
  { label: 'Catalog', to: '/catalog', icon: 'M4 4h16v16H4ZM4 10h16M10 4v16' },
  { label: 'Stock', to: '/stock', icon: 'm3 7 9-4 9 4-9 4ZM3 7v10l9 4 9-4V7M12 11v10' },
]
function active(to: string): boolean {
  return to === '/' ? route.path === '/' : to === '/catalog' ? route.name === 'suppliers' : to === '/projects' ? route.path.startsWith('/projects') || route.path === '/import' : route.path === to
}
watch(() => route.fullPath, () => { expanded.value = false })
function closeNavigation(): void { if (expanded.value) { expanded.value = false; toggle.value?.focus() } }
function focusContent(): void { document.getElementById('main-content')?.focus() }
</script>
<template>
  <div class="min-h-screen lg:grid lg:grid-cols-[180px_minmax(0,1fr)]">
    <a
      href="#main-content"
      class="sr-only z-50 bg-surface p-3 focus:not-sr-only focus:absolute"
      @click.prevent="focusContent"
    >Skip to content</a>
    <aside
      class="border-b border-line bg-surface lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:border-r lg:border-b-0"
      aria-label="Application navigation"
      @keydown.esc="closeNavigation"
    >
      <header class="flex items-center justify-between gap-3 p-4 lg:py-4">
        <RouterLink
          to="/"
          class="flex items-center gap-3"
          aria-label="OptiCutList home"
        >
          <svg
            class="h-7 w-7 text-accent"
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
          <span class="text-sm font-bold tracking-tight">OptiCutList</span>
        </RouterLink>
        <button
          ref="toggle"
          type="button"
          class="button lg:hidden"
          :aria-expanded="expanded"
          aria-controls="app-sidebar-content"
          @click="expanded = !expanded"
        >
          {{ expanded ? 'Close menu' : 'Menu' }}
        </button>
      </header>
      <div
        id="app-sidebar-content"
        class="flex-col gap-6 px-2 pb-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
        :class="expanded ? 'flex' : 'hidden lg:flex'"
      >
        <nav
          aria-label="Main navigation"
          class="space-y-1"
        >
          <RouterLink
            v-for="item in navigation"
            :key="item.to"
            :to="item.to"
            class="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium"
            :class="active(item.to) ? 'bg-subtle text-accent' : 'text-muted hover:bg-subtle hover:text-ink'"
            :aria-current="active(item.to) ? 'page' : undefined"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              class="h-5 w-5 shrink-0"
              aria-hidden="true"
            ><path :d="item.icon" /></svg>{{ item.label }}
          </RouterLink>
        </nav>
        <div class="mt-auto space-y-4 border-t border-line px-1 pt-4">
          <ThemeSelector />
          <p class="text-xs leading-relaxed text-muted">
            Saved on this device.<br>Browser storage can be cleared.
          </p>
          <footer class="text-xs text-muted">
            OptiCutList · Open source · GPL-3.0
          </footer>
        </div>
      </div>
    </aside>
    <div class="flex min-w-0 flex-col">
      <main
        id="main-content"
        tabindex="-1"
        class="mx-auto w-full flex-1 px-4 pt-4 pb-5 sm:px-6 lg:px-4"
        :class="$route.name === 'suppliers' || $route.name === 'stock' || $route.name === 'project-parts' || $route.name === 'project-materials' || $route.name === 'project-optimization' ? 'max-w-none' : 'max-w-7xl'"
      >
        <RouterView :key="String($route.params.projectId ?? '')" />
      </main>
    </div>
  </div>
</template>
