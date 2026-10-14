<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import AppButton from './AppButton.vue'
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
const props = withDefaults(defineProps<{ title: string; busy: boolean; closeLabel?: string; drawer?: boolean; open?: boolean; titleId?: string; size?: 'small' | 'default' | 'large' }>(), { titleId: '', size: 'default', open: true, closeLabel: 'Close form', drawer: false })
const emit = defineEmits<{ close: [] }>()
const generatedId = `dialog-${useId()}`
const headingId = computed(() => props.titleId || generatedId)
const dialog = ref<HTMLDialogElement | null>(null)
let previousFocus: HTMLElement | null = null
function close(): void { if (!props.busy) emit('close') }
function syncOpen(): void {
  if (!dialog.value) return
  if (props.open) {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!dialog.value.open) {
      if (typeof dialog.value.showModal === 'function') dialog.value.showModal()
      else dialog.value.open = true
    }
  } else {
    if (typeof dialog.value.close === 'function') dialog.value.close()
    else dialog.value.open = false
    previousFocus?.focus()
  }
}
onMounted(syncOpen)
watch(() => props.open, syncOpen)
onBeforeUnmount(() => { if (typeof dialog.value?.close === 'function') dialog.value.close(); previousFocus?.focus() })
</script>
<template>
  <dialog
    ref="dialog"
    :aria-labelledby="headingId"
    class="app-dialog panel overflow-y-auto p-4 text-ink sm:p-6"
    :class="drawer ? 'm-0 ml-auto h-dvh max-h-dvh w-full max-w-xl rounded-none sm:rounded-l-xl' : `m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] ${size === 'small' ? 'max-w-lg' : size === 'large' ? 'max-w-5xl' : 'max-w-3xl'}`"
    @cancel.prevent="close"
  >
    <div class="dialog-header mb-4 flex items-start justify-between gap-3">
      <h2
        :id="headingId"
        class="min-w-0 pt-1 text-lg font-semibold leading-snug [overflow-wrap:anywhere]"
      >
        {{ title }}
      </h2>
      <AppButton
        size="small"
        variant="ghost"
        icon-only
        class="shrink-0 text-muted"
        :label="closeLabel"
        :disabled="busy"
        @click="close"
      >
        <AppIcon name="close" />
      </AppButton>
    </div>
    <slot />
  </dialog>
</template>
