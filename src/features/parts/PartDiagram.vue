<script setup lang="ts">
import { computed } from 'vue'
import type { Part } from '../../domain/model/part'
import { fitPartPreview } from './part-preview'
const props = defineProps<{ part: Part }>()
const rect = computed(() => {
  try { return fitPartPreview(props.part.lengthMm, props.part.widthMm) }
  catch (error) { if (error instanceof RangeError) return null; throw error }
})
</script>
<template>
  <figure
    class="rounded-xl bg-subtle p-2"
    aria-label="Part dimension preview"
  >
    <svg
      v-if="rect"
      viewBox="0 0 300 210"
      class="h-[180px] w-full text-accent"
      role="img"
      :aria-label="`${part.lengthMm} × ${part.widthMm} mm, grain ${part.grainDirection}`"
    >
      <rect
        :x="rect.x"
        :y="rect.y"
        :width="rect.width"
        :height="rect.height"
        fill="currentColor"
        fill-opacity="0.12"
        stroke="currentColor"
        vector-effect="non-scaling-stroke"
      />
      <path
        v-if="part.grainDirection === 'length'"
        data-grain="length"
        :d="`M ${rect.x + rect.width * 0.2} 105 H ${rect.x + rect.width * 0.8}`"
        stroke="currentColor"
        stroke-dasharray="4 3"
      />
      <path
        v-else-if="part.grainDirection === 'width'"
        data-grain="width"
        :d="`M 150 ${rect.y + rect.height * 0.2} V ${rect.y + rect.height * 0.8}`"
        stroke="currentColor"
        stroke-dasharray="4 3"
      />
      <text
        x="150"
        y="197"
        text-anchor="middle"
        fill="currentColor"
        font-size="12"
      >{{ part.lengthMm }} mm</text>
      <text
        x="16"
        y="105"
        text-anchor="middle"
        transform="rotate(-90 16 105)"
        fill="currentColor"
        font-size="12"
      >{{ part.widthMm }} mm</text>
    </svg>
    <p
      v-else
      class="p-4 text-sm text-muted"
    >
      Preview unavailable at this dimension range.
    </p>
    <figcaption class="pb-2 text-center text-xs text-muted">
      Part proportions · not a cutting layout
    </figcaption>
  </figure>
</template>
