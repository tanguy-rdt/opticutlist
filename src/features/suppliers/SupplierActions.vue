<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import AppButton from '../../shared/ui/AppButton.vue'
import AppIcon from '../../shared/ui/AppIcon.vue'
const props = defineProps<{ disabled: boolean }>()
const emit = defineEmits<{ edit: []; delete: [] }>()
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const trigger = ref<InstanceType<typeof AppButton> | null>(null)
const menu = ref<HTMLElement | null>(null)
const menuId = useId()
function close(restoreFocus = false): void { open.value = false; if (restoreFocus) trigger.value?.focus() }
async function show(last = false): Promise<void> {
  if (props.disabled) return
  open.value = true
  await nextTick()
  const items = menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
  items?.[last ? items.length - 1 : 0]?.focus()
}
async function toggle(): Promise<void> { if (open.value) close(); else await show() }
function keyboard(event: KeyboardEvent): void {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const items = [...(menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
  const index = items.findIndex(item => item === document.activeElement)
  const position = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
  items[position]?.focus()
}
function focusOut(event: FocusEvent): void { if (event.relatedTarget instanceof Node && !root.value?.contains(event.relatedTarget)) close() }
function outside(event: PointerEvent): void { if (event.target instanceof Node && !root.value?.contains(event.target)) close() }
watch(open, value => { if (value) document.addEventListener('pointerdown', outside); else document.removeEventListener('pointerdown', outside) })
watch(() => props.disabled, value => { if (value) close() })
onBeforeUnmount(() => { document.removeEventListener('pointerdown', outside) })
</script>
<template>
  <div
    ref="root"
    class="relative shrink-0"
    @focusout="focusOut"
  >
    <AppButton
      ref="trigger"
      size="small"
      icon-only
      label="Supplier actions"
      :disabled="disabled"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-controls="menuId"
      @click="toggle"
      @keydown.down.prevent="show()"
      @keydown.up.prevent="show(true)"
      @keydown.esc.prevent="close(true)"
    >
      <svg
        viewBox="0 0 24 24"
        class="size-4"
        fill="currentColor"
        aria-hidden="true"
      >
        <circle
          cx="5"
          cy="12"
          r="1.5"
        /><circle
          cx="12"
          cy="12"
          r="1.5"
        /><circle
          cx="19"
          cy="12"
          r="1.5"
        />
      </svg>
    </AppButton>
    <div
      v-if="open"
      :id="menuId"
      ref="menu"
      role="menu"
      aria-label="Supplier actions"
      class="action-menu absolute right-0 top-full z-20 mt-1 w-48 space-y-1"
      @keydown="keyboard"
    >
      <button
        type="button"
        role="menuitem"
        class="action-menu-item gap-2"
        @click="close(true); emit('edit')"
      >
        <AppIcon name="edit" />Edit supplier
      </button>
      <button
        type="button"
        role="menuitem"
        class="action-menu-item gap-2 text-danger hover:bg-danger-surface"
        @click="close(true); emit('delete')"
      >
        <AppIcon name="delete" />Delete supplier
      </button>
    </div>
  </div>
</template>
