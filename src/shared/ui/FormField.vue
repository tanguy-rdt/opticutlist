<script setup lang="ts">
withDefaults(defineProps<{
  id: string
  label: string
  error?: string
  required?: boolean
  hint?: string
  requiredIndicator?: 'text' | 'asterisk'
}>(), { error: '', required: false, hint: '', requiredIndicator: 'text' })
</script>

<template>
  <div :class="requiredIndicator === 'asterisk' ? 'grid content-start gap-2' : 'space-y-2'">
    <label
      :for="id"
      class="block text-sm font-semibold"
    >
      {{ label }} <span
        v-if="required"
        class="font-normal text-muted"
        :aria-hidden="requiredIndicator === 'asterisk' ? true : undefined"
      >{{ requiredIndicator === 'asterisk' ? '*' : '(required)' }}</span>
      <span
        v-if="required && requiredIndicator === 'asterisk'"
        class="sr-only"
      > (required)</span>
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
      :class="{ hidden: !error && requiredIndicator === 'asterisk' }"
    >
      {{ error }}
    </p>
  </div>
</template>
