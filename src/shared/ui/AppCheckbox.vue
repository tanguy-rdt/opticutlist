<script setup lang="ts">
defineProps<{ id: string; label: string; description?: string; disabled?: boolean; indeterminate?: boolean; hideLabel?: boolean }>()
const checked = defineModel<boolean>({ required: true })
</script>
<template>
  <div class="grid gap-1.5">
    <label
      :for="id"
      class="flex items-center gap-2 text-sm font-semibold"
      :class="disabled ? 'opacity-50' : 'cursor-pointer'"
    >
      <input
        :id="id"
        v-model="checked"
        type="checkbox"
        class="size-4 shrink-0 rounded accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        :disabled="disabled"
        :indeterminate.prop="indeterminate ?? false"
        :aria-checked="indeterminate ? 'mixed' : checked"
        :aria-describedby="description ? `${id}-description` : undefined"
      >
      <span :class="hideLabel ? 'sr-only' : undefined">{{ label }}</span>
    </label>
    <p
      v-if="description"
      :id="`${id}-description`"
      class="pl-6 text-xs text-muted"
    >
      {{ description }}
    </p>
  </div>
</template>
