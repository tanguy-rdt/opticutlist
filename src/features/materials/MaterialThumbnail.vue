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
    :class="variant === 'preview' ? 'aspect-[3/2] w-full' : 'h-10 w-12'"
  >
    <img
      v-if="source && !failed"
      :key="source"
      :src="source"
      alt=""
      :width="variant === 'preview' ? 768 : 320"
      :height="variant === 'preview' ? 512 : 280"
      decoding="async"
      loading="lazy"
      class="size-full"
      :class="variant === 'preview' ? 'object-cover' : 'object-contain'"
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
