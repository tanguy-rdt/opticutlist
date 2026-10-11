<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppIcon from '../../shared/ui/AppIcon.vue'
import { materialThumbnail } from './material-library'
const props = defineProps<{ presetId: string | undefined }>()
const failed = ref(false)
const source = computed(() => materialThumbnail(props.presetId))
watch(source, () => { failed.value = false })
</script>
<template>
  <span class="inline-flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-subtle text-muted">
    <img
      v-if="source && !failed"
      :src="source"
      alt=""
      width="40"
      height="40"
      loading="lazy"
      class="size-full object-cover"
      @error="failed = true"
    >
    <AppIcon
      v-else
      name="layers"
    />
  </span>
</template>
