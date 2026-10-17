<script setup lang="ts">
import { ref } from 'vue'
type ButtonProps = {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive'
  size?: 'small' | 'default'
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  loading?: boolean
} & ({ iconOnly: true; label: string } | { iconOnly?: false; label?: string })
const props = defineProps<ButtonProps>()
const element = ref<HTMLButtonElement | null>(null)

function focus(): void {
  element.value?.focus()
}

defineExpose({ focus })
const variants = { primary: 'button-primary', secondary: '', ghost: 'button-ghost', destructive: 'button-danger' } as const
</script>
<template>
  <button
    ref="element"
    :type="type ?? 'button'"
    class="button"
    :class="[variants[props.variant ?? 'secondary'], { 'button-compact': size === 'small', 'button-icon': iconOnly }]"
    :aria-label="label"
    :aria-busy="loading || undefined"
    :disabled="disabled || loading"
  >
    <span
      v-if="loading"
      class="button-spinner"
      aria-hidden="true"
    />
    <slot />
  </button>
</template>
