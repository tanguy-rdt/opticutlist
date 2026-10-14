<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import type { StockItem } from '../../domain/model/stock-item'
import { fitPartPreview } from '../parts/part-preview'
import { materialPreview } from '../materials/material-library'
const props = defineProps<{ item: StockItem; presetId: string | undefined }>()
const clipId = useId()
const failed = ref(false)
const texture = computed(() => materialPreview(props.presetId))
watch(texture, () => { failed.value = false })
const rect = computed(() => {
  try { return fitPartPreview(props.item.lengthMm, props.item.widthMm) }
  catch (cause) { if (cause instanceof RangeError) return null; throw cause }
})
function imageError(event: Event): void {
  if (event.currentTarget instanceof SVGElement && event.currentTarget.getAttribute('href') === texture.value) failed.value = true
}
</script>
<template>
  <figure aria-label="Physical stock panel preview">
    <svg
      v-if="rect"
      viewBox="0 0 300 210"
      class="block h-40 w-full rounded-lg bg-quiet-surface text-muted"
      role="img"
      :aria-label="`${item.lengthMm} × ${item.widthMm} mm ${item.kind === 'offcut' ? 'offcut' : 'panel'}`"
    >
      <defs>
        <clipPath :id="clipId">
          <rect
            :x="rect.x"
            :y="rect.y"
            :width="rect.width"
            :height="rect.height"
          />
        </clipPath>
      </defs>
      <rect
        data-panel-outline
        :x="rect.x"
        :y="rect.y"
        :width="rect.width"
        :height="rect.height"
        fill="currentColor"
        fill-opacity="0.1"
      />
      <image
        v-if="texture && !failed"
        :key="texture"
        :href="texture"
        :x="rect.x"
        :y="rect.y"
        :width="rect.width"
        :height="rect.height"
        preserveAspectRatio="xMidYMid slice"
        :clip-path="`url(#${clipId})`"
        @error="imageError"
      />
      <rect
        :x="rect.x"
        :y="rect.y"
        :width="rect.width"
        :height="rect.height"
        fill="none"
        stroke="currentColor"
        stroke-width="0.75"
        vector-effect="non-scaling-stroke"
      />
      <text
        x="150"
        y="197"
        text-anchor="middle"
        fill="currentColor"
        font-size="13"
      >{{ item.lengthMm }} mm</text>
      <text
        x="16"
        y="105"
        transform="rotate(-90 16 105)"
        text-anchor="middle"
        fill="currentColor"
        font-size="13"
      >{{ item.widthMm }} mm</text>
    </svg>
    <p
      v-else
      class="py-5 text-center text-sm text-muted"
    >
      Preview unavailable at this dimension range.
    </p>
  </figure>
</template>
