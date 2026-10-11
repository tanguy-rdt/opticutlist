<script setup lang="ts">
import { computed, ref } from 'vue'
import MaterialThumbnail from './MaterialThumbnail.vue'
import { materialPresets, materialPresetGroups, type MaterialPreset } from './material-library'
defineProps<{ selectedId: string | undefined }>()
const emit = defineEmits<{ select: [preset: MaterialPreset | undefined] }>()
const search = ref('')
function normalize(value: string): string { return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase() }
const groups = computed(() => materialPresetGroups.map(category => ({
  category, presets: materialPresets.filter(preset => preset.category === category && normalize(preset.name).includes(normalize(search.value.trim()))),
})).filter(group => group.presets.length > 0))
</script>
<template>
  <div class="space-y-3">
    <label class="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="radio"
        name="material-preset"
        :checked="!selectedId"
        @change="emit('select', undefined)"
      >
      Custom material (no image)
    </label>
    <label
      for="material-library-search"
      class="block text-sm font-medium"
    >Search material library</label>
    <input
      id="material-library-search"
      v-model="search"
      type="search"
      class="field"
      placeholder="Search by material name"
      @keydown.enter.prevent
    >
    <div class="max-h-64 space-y-3 overflow-y-auto rounded-lg border border-line p-3">
      <fieldset
        v-for="group in groups"
        :key="group.category"
      >
        <legend class="mb-2 text-sm font-semibold">
          {{ group.category }}
        </legend>
        <div class="grid gap-2 sm:grid-cols-2">
          <label
            v-for="preset in group.presets"
            :key="preset.id"
            class="flex cursor-pointer items-center gap-2 rounded-lg border border-line p-2 text-sm hover:bg-subtle"
            :class="{ 'bg-success-surface': selectedId === preset.id }"
          >
            <input
              type="radio"
              name="material-preset"
              :value="preset.id"
              :checked="selectedId === preset.id"
              @change="emit('select', preset)"
            >
            <MaterialThumbnail :preset-id="preset.id" />
            {{ preset.name }}
          </label>
        </div>
      </fieldset>
      <p
        v-if="groups.length === 0"
        role="status"
        class="text-sm text-muted"
      >
        No matching materials. You can create a custom material.
      </p>
    </div>
    <p class="text-xs text-muted">
      Presets only fill the fields below. Edit the name and category before saving.
    </p>
  </div>
</template>
