<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '../../shared/ui/AppIcon.vue'
import MaterialThumbnail from './MaterialThumbnail.vue'

export type MaterialOption = { value: string; name: string; group: string; presetId: string | undefined }
const props = withDefaults(defineProps<{ id: string; modelValue: string; options: readonly MaterialOption[]; disabled: boolean; allowCustomCreation?: boolean }>(), { allowCustomCreation: true })
const emit = defineEmits<{ 'update:modelValue': [value: string]; create: [] }>()
defineOptions({ inheritAttrs: false })
const root = ref<HTMLElement | null>(null)
const popup = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const search = ref<HTMLInputElement | null>(null)
const open = ref(false)
const query = ref('')
const active = ref(0)
const selected = computed(() => props.options.find(option => option.value === props.modelValue))
const visible = computed(() => props.options.filter(option => option.name.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())))
const activeOptionId = computed(() => { const option = visible.value[active.value]; return option ? optionId(option) : undefined })
const groups = computed(() => [...new Set(visible.value.map(option => option.group))])
const listId = computed(() => `${props.id}-list`)
function optionId(option: MaterialOption): string { return `${props.id}-option-${String(props.options.indexOf(option))}` }
function close(restoreFocus = false): void {
  open.value = false
  if (restoreFocus) trigger.value?.focus()
}
async function show(): Promise<void> {
  if (props.disabled) return
  query.value = ''
  active.value = Math.max(0, props.options.findIndex(option => option.value === props.modelValue))
  open.value = true
  await nextTick()
  search.value?.focus({ preventScroll: true })
  scrollActive()
  if (popup.value && typeof popup.value.scrollIntoView === 'function') popup.value.scrollIntoView({ block: 'nearest' })
}
function scrollActive(): void {
  const option = visible.value[active.value]
  const element = option ? document.getElementById(optionId(option)) : null
  if (element && typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'nearest' })
}
function choose(option: MaterialOption): void {
  emit('update:modelValue', option.value)
  close(true)
}
function keyboard(event: KeyboardEvent): void {
  if (!open.value) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); void show() }
    return
  }
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true) }
  else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    const last = Math.max(0, visible.value.length - 1)
    active.value = event.key === 'Home' ? 0 : event.key === 'End' ? last : Math.min(last, Math.max(0, active.value + (event.key === 'ArrowDown' ? 1 : -1)))
    scrollActive()
  } else if (event.key === 'Enter' && event.target === search.value) {
    event.preventDefault()
    const option = visible.value[active.value]
    if (option) choose(option)
  }
}
function outside(event: PointerEvent): void { if (event.target instanceof Node && !root.value?.contains(event.target)) close() }
function focusOut(event: FocusEvent): void { if (event.relatedTarget instanceof Node && !root.value?.contains(event.relatedTarget)) close() }
function create(): void { close(); emit('create') }
watch(query, () => { active.value = 0 })
watch(() => props.disabled, disabled => { if (disabled) close() })
onMounted(() => { document.addEventListener('pointerdown', outside); })
onBeforeUnmount(() => { document.removeEventListener('pointerdown', outside); })
</script>
<template>
  <div
    ref="root"
    class="relative"
    @keydown="keyboard"
    @focusout="focusOut"
  >
    <button
      :id="id"
      ref="trigger"
      v-bind="$attrs"
      type="button"
      class="field flex items-center gap-3 text-left"
      :value="modelValue"
      :disabled="disabled"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="listId"
      @click="open ? close(true) : show()"
    >
      <MaterialThumbnail
        v-if="selected"
        class="max-h-7 max-w-8"
        :preset-id="selected.presetId"
      />
      <span class="min-w-0 flex-1 truncate">{{ selected?.name ?? (modelValue ? 'Missing material — choose another' : 'Select a material') }}</span>
      <AppIcon
        name="chevron"
        class="size-4 rotate-90 text-muted"
      />
    </button>
    <div
      v-if="open"
      ref="popup"
      class="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-line bg-surface shadow-xl"
    >
      <div class="border-b border-line px-2 py-1.5">
        <div class="flex h-9 items-center gap-2 rounded-lg bg-quiet-surface px-2 focus-within:ring-2 focus-within:ring-accent">
          <AppIcon
            name="search"
            class="size-3.5 shrink-0 text-muted"
          />
          <input
            ref="search"
            v-model="query"
            class="min-w-0 flex-1 bg-transparent py-1 text-sm text-ink outline-none placeholder:text-muted"
            role="combobox"
            aria-label="Search materials"
            autocomplete="off"
            aria-expanded="true"
            aria-autocomplete="list"
            :aria-controls="listId"
            :aria-activedescendant="activeOptionId"
            placeholder="Search materials…"
          >
        </div>
      </div>
      <div
        :id="listId"
        role="listbox"
        aria-label="Materials"
        class="max-h-[min(16rem,35dvh)] overflow-y-auto overscroll-contain p-1"
      >
        <div
          v-for="group in groups"
          :key="group"
          role="group"
          :aria-label="group"
        >
          <p class="px-3 py-2 text-xs font-semibold text-muted">
            {{ group }}
          </p>
          <button
            v-for="option in visible.filter(item => item.group === group)"
            :id="optionId(option)"
            :key="option.value"
            type="button"
            role="option"
            tabindex="-1"
            :aria-selected="option.value === modelValue"
            :data-value="option.value"
            class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-subtle"
            :class="{ 'bg-success-surface text-accent': option === visible[active] || option.value === modelValue }"
            @pointerdown.prevent
            @click="choose(option)"
          >
            <MaterialThumbnail :preset-id="option.presetId" /><span class="min-w-0 flex-1 truncate">{{ option.name }}</span>
            <AppIcon
              v-if="option.value === modelValue"
              name="check"
              class="size-4"
            />
          </button>
        </div>
        <p
          v-if="!visible.length"
          role="status"
          class="px-3 py-4 text-sm text-muted"
        >
          No matching materials.
        </p>
      </div>
      <div
        v-if="allowCustomCreation !== false"
        class="border-t border-line p-2"
      >
        <button
          type="button"
          class="button w-full justify-start text-accent"
          @click="create"
        >
          + Create custom material
        </button>
      </div>
    </div>
  </div>
</template>
