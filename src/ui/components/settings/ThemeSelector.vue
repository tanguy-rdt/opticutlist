<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue'

type ThemePreference = 'light' | 'dark' | 'system'

const storageKey = 'opticutlist.theme'

function isTheme(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

function readPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(storageKey)
    return isTheme(saved) ? saved : 'system'
  } catch {
    return 'system'
  }
}

const preference = ref(readPreference())
const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null
const systemDark = ref(media?.matches ?? false)
const storageWarning = ref('')
const resolved = computed(() => {
  if (preference.value !== 'system') {
    return preference.value
  }
  return systemDark.value ? 'dark' : 'light'
})

watchEffect(() => {
  document.documentElement.dataset.theme = resolved.value
  document.documentElement.style.colorScheme = resolved.value
})
watch(preference, (value) => {
  try {
    localStorage.setItem(storageKey, value)
    storageWarning.value = ''
  } catch {
    storageWarning.value = 'Theme applies for this visit. Your browser could not save the preference.'
  }
})

function systemChanged(event: MediaQueryListEvent): void {
  systemDark.value = event.matches
}

onMounted(() => {
  media?.addEventListener('change', systemChanged)
})
onUnmounted(() => {
  media?.removeEventListener('change', systemChanged)
})
</script>

<template>
  <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 text-sm">
    <label
      for="theme-preference"
      class="text-muted"
    >Theme</label>
    <select
      id="theme-preference"
      v-model="preference"
      class="field field-small w-auto py-1.5 text-sm"
      aria-describedby="theme-warning"
    >
      <option value="light">
        Light
      </option>
      <option value="dark">
        Dark
      </option>
      <option value="system">
        System
      </option>
    </select>
    <span
      v-show="storageWarning"
      id="theme-warning"
      role="status"
      class="col-span-2 text-xs text-muted"
    >{{ storageWarning }}</span>
  </div>
</template>
