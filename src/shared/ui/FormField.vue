<script setup lang="ts">
withDefaults(defineProps<{
  id: string
  label: string
  error?: string
  required?: boolean
  hint?: string
}>(), { error: '', required: false, hint: '' })
</script>

<template>
  <div class="space-y-2">
    <label
      :for="id"
      class="block text-sm font-semibold"
    >
      {{ label }} <span
        v-if="required"
        class="font-normal text-muted"
      >(required)</span>
    </label>
    <slot
      :control-attrs="{
        id,
        required,
        'aria-invalid': Boolean(error),
        'aria-describedby': `${id}-error${hint ? ` ${id}-hint` : ''}`,
      }"
    />
    <p
      v-if="hint"
      :id="`${id}-hint`"
      class="text-sm text-muted"
    >
      {{ hint }}
    </p>
    <p
      :id="`${id}-error`"
      :role="error ? 'alert' : undefined"
      class="text-sm text-danger"
    >
      {{ error }}
    </p>
  </div>
</template>
