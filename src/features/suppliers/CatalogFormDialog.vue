<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
const props = defineProps<{ title: string; busy: boolean }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
let previousFocus: HTMLElement | null = null
function close(): void { if (!props.busy) emit('close') }
onMounted(() => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  if (typeof dialog.value?.showModal === 'function') dialog.value.showModal()
  else if (dialog.value) dialog.value.open = true
})
onBeforeUnmount(() => { if (typeof dialog.value?.close === 'function') dialog.value.close(); previousFocus?.focus() })
</script>
<template>
  <dialog
    ref="dialog"
    aria-labelledby="catalog-dialog-title"
    class="panel m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-3xl overflow-y-auto p-4 text-ink backdrop:bg-canvas/80 sm:p-6"
    @cancel.prevent="close"
  >
    <div class="mb-4 flex items-center justify-between gap-3">
      <h2
        id="catalog-dialog-title"
        class="text-lg font-semibold"
      >
        {{ title }}
      </h2>
      <button
        type="button"
        class="button"
        :disabled="busy"
        @click="close"
      >
        Close form
      </button>
    </div>
    <slot />
  </dialog>
</template>
