<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppIcon from '../../shared/ui/AppIcon.vue'
import { supplierFaviconUrl } from './supplier-favicon'
const props = withDefaults(defineProps<{ websiteUrl: string | undefined; size?: 'small' | 'large' }>(), { size: 'small' })
const source = computed(() => supplierFaviconUrl(props.websiteUrl))
const loaded = ref(false)
const failed = ref(false)
watch(source, () => {
  loaded.value = false;
  failed.value = false
}, { flush: 'sync' })
function imageState(event: Event, successful: boolean): void {
  if (!(event.currentTarget instanceof HTMLImageElement) || event.currentTarget.getAttribute('src') !== source.value) return
  loaded.value = successful
  failed.value = !successful
}
</script>
<template>
  <span
    class="relative inline-flex shrink-0 items-center justify-center rounded-lg text-accent"
    :class="[size === 'large' ? 'size-12' : 'size-8', { 'bg-subtle': !loaded }]"
    aria-hidden="true"
  >
    <AppIcon
      v-if="!loaded"
      name="supplier"
    />
    <img
      v-if="source && !failed"
      :key="source"
      :src="source"
      alt=""
      width="32"
      height="32"
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      class="absolute object-contain"
      :class="[size === 'large' ? 'size-10' : 'size-7', loaded ? 'visible' : 'invisible']"
      @load="imageState($event, true)"
      @error="imageState($event, false)"
    >
  </span>
</template>
