<script setup lang="ts">
import { computed } from 'vue'
import type { GrainDirection } from '../../domain/model/orientation'
import { fitPanelDimensionPreview, previewGrainPath, type PanelPreviewSize } from './panel-dimension-preview'
const props = withDefaults(defineProps<{ lengthMm: number; widthMm: number; grainDirection?: GrainDirection; size?: PanelPreviewSize; label?: string }>(), { grainDirection: 'none', size: 'default', label: 'Panel dimension preview' })
const drawing = computed(() => {
  try { return fitPanelDimensionPreview(props.lengthMm, props.widthMm, props.size) }
  catch (cause) { if (cause instanceof RangeError) return null; throw cause }
})
const grainPath = computed(() => drawing.value ? previewGrainPath(drawing.value.panel, props.grainDirection) : null)
</script>
<template>
  <figure :aria-label="label">
    <svg
      v-if="drawing"
      :viewBox="`0 0 ${drawing.width} ${drawing.height}`"
      class="block w-full text-muted"
      :style="{ maxHeight: size === 'small' ? '180px' : '210px' }"
      role="img"
      :aria-label="`${label}: ${lengthMm} × ${widthMm} mm${grainDirection === 'none' ? '' : `, grain along ${grainDirection}`}`"
    >
      <g :transform="`translate(${drawing.translation.x} ${drawing.translation.y})`">
        <rect
          v-bind="drawing.panel"
          data-panel-outline
          fill="var(--quiet-surface)"
        />
        <rect
          v-bind="drawing.panel"
          fill="none"
          stroke="currentColor"
          stroke-width="0.8"
          vector-effect="non-scaling-stroke"
        />
        <g
          stroke="currentColor"
          stroke-width="0.7"
          fill="none"
          stroke-opacity="0.8"
        >
          <line
            v-for="(line, index) in drawing.extensions"
            :key="index"
            data-dimension-extension
            :x1="line.start.x"
            :y1="line.start.y"
            :x2="line.end.x"
            :y2="line.end.y"
          />
          <line
            data-dimension-axis="length"
            :x1="drawing.horizontal.start.x"
            :y1="drawing.horizontal.start.y"
            :x2="drawing.horizontal.end.x"
            :y2="drawing.horizontal.end.y"
          />
          <line
            data-dimension-axis="width"
            :x1="drawing.vertical.start.x"
            :y1="drawing.vertical.start.y"
            :x2="drawing.vertical.end.x"
            :y2="drawing.vertical.end.y"
          />
        </g>
        <path
          v-for="(arrow, index) in drawing.horizontalArrows"
          :key="`horizontal-${index}`"
          data-dimension-arrow="length"
          :d="arrow"
          fill="currentColor"
        />
        <path
          v-for="(arrow, index) in drawing.verticalArrows"
          :key="`vertical-${index}`"
          data-dimension-arrow="width"
          :d="arrow"
          fill="currentColor"
        />
        <path
          v-if="grainPath"
          :data-grain="grainDirection"
          :d="grainPath"
          stroke="currentColor"
          stroke-width="0.8"
          fill="none"
        />
        <text
          :x="drawing.horizontalLabel.x"
          :y="drawing.horizontalLabel.y"
          text-anchor="middle"
          dominant-baseline="middle"
          :font-size="drawing.fontSize"
          fill="currentColor"
          class="text-ink tabular-nums"
        >{{ drawing.lengthLabel }}</text>
        <text
          :transform="`translate(${drawing.verticalLabel.x} ${drawing.verticalLabel.y}) rotate(-90)`"
          text-anchor="middle"
          dominant-baseline="middle"
          :font-size="drawing.fontSize"
          fill="currentColor"
          class="text-ink tabular-nums"
        >{{ drawing.widthLabel }}</text>
      </g>
    </svg>
    <p
      v-else
      class="py-5 text-center text-sm text-muted"
    >
      Preview unavailable at this dimension range.
    </p>
  </figure>
</template>
