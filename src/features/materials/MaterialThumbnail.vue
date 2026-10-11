<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppIcon from '../../shared/ui/AppIcon.vue'
import { materialThumbnail, materialPreview } from './material-library'
const props = withDefaults(defineProps<{ presetId: string | undefined; variant?: 'thumbnail' | 'preview' }>(), { variant: 'thumbnail' })
const failed = ref(false)
const source = computed(() => props.variant === 'preview' ? materialPreview(props.presetId) : materialThumbnail(props.presetId))
watch(source, () => { failed.value = false })
function imageError(event: Event): void {
  if (event.currentTarget instanceof HTMLImageElement && event.currentTarget.getAttribute('src') === source.value) failed.value = true
}
</script>
<template>
  <span
    class="inline-flex shrink-0 flex-col items-center justify-center gap-2 overflow-hidden rounded-lg bg-subtle text-muted"
    :class="variant === 'preview' ? 'aspect-[3/2] w-full' : 'h-8 w-12 border border-line'"
  >
    <img
      v-if="source && !failed"
      :key="source"
      :src="source"
      alt=""
      :width="variant === 'preview' ? 768 : 96"
      :height="variant === 'preview' ? 512 : 64"
      decoding="async"
      loading="lazy"
      class="size-full object-cover"
      @error="imageError"
    >
    <template v-else>
      <AppIcon name="layers" />
      <span
        v-if="variant === 'preview'"
        class="text-xs"
      >No texture available</span>
    </template>
  </span>
</template>
