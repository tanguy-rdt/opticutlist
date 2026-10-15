<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import AppButton from './AppButton.vue'
const props = defineProps<{
  label: string
  menuLabel: string
  actions: readonly { value: string; label: string }[]
  primaryDisabled?: boolean
}>()
const emit = defineEmits<{ primary: []; select: [value: string] }>()
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const trigger = ref<InstanceType<typeof AppButton> | null>(null)
const menu = ref<HTMLElement | null>(null)
const menuId = useId()
function close(restoreFocus = false): void { open.value = false; if (restoreFocus) trigger.value?.focus() }
async function show(last = false): Promise<void> {
  if (!props.actions.length) return
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
watch(() => props.actions.length, count => { if (!count) close() })
onBeforeUnmount(() => { document.removeEventListener('pointerdown', outside) })
</script>
<template>
  <div
    ref="root"
    class="relative inline-flex shrink-0"
    @focusout="focusOut"
  >
    <AppButton
      variant="primary"
      class="split-primary"
      :disabled="primaryDisabled"
      @click="close(); emit('primary')"
    >
      <slot>{{ label }}</slot>
    </AppButton>
    <AppButton
      ref="trigger"
      variant="primary"
      icon-only
      :label="menuLabel"
      class="split-toggle"
      :disabled="!actions.length"
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
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </AppButton>
    <div
      v-if="open"
      :id="menuId"
      ref="menu"
      role="menu"
      :aria-label="menuLabel"
      class="action-menu absolute right-0 top-full z-20 mt-1 w-48 max-w-[calc(100vw-2rem)] space-y-1"
      @keydown="keyboard"
    >
      <button
        v-for="action in actions"
        :key="action.value"
        type="button"
        role="menuitem"
        class="action-menu-item"
        @click="close(true); emit('select', action.value)"
      >
        {{ action.label }}
      </button>
    </div>
  </div>
</template>
<style scoped>
.split-primary {
  border-start-end-radius: 0;
  border-end-end-radius: 0;
}
.split-toggle {
  width: var(--control-height-small);
  border-start-start-radius: 0;
  border-end-start-radius: 0;
  border-inline-start-color: color-mix(in srgb, var(--on-accent) 30%, transparent);
}
.split-primary:focus-visible,
.split-toggle:focus-visible {
  position: relative;
  z-index: 1;
}
</style>
