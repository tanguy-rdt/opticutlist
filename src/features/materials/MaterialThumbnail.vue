<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppIcon from '../../shared/ui/AppIcon.vue'
import { materialThumbnail } from './material-library'
const props = defineProps<{ presetId: string | undefined }>()
const failed = ref(false)
const source = computed(() => materialThumbnail(props.presetId))
watch(source, () => { failed.value = false })
function imageError(event: Event): void {
  if (event.currentTarget instanceof HTMLImageElement && event.currentTarget.getAttribute('src') === source.value) failed.value = true
}
</script>
<template>
  <span
    class="inline-flex h-10 w-12 shrink-0 flex-col items-center justify-center gap-2 overflow-hidden rounded-lg bg-quiet-surface text-muted"
  >
    <img
      v-if="source && !failed"
      :key="source"
      :src="source"
      alt=""
      width="320"
      height="280"
      decoding="async"
      loading="lazy"
      class="size-full object-contain"
      @error="imageError"
    >
    <AppIcon
      v-else
      name="layers"
    />
  </span>
</template>
