<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import type { CuttingProject } from '../../domain/model/cutting-project'
import { useProjectNavigation } from './project-navigation'
import ProjectExport from './ProjectExport.vue'
const props = defineProps<{ project: CuttingProject; disabled: boolean }>()
const emit = defineEmits<{ rename: [project: CuttingProject]; delete: [project: CuttingProject] }>()
const navigation = useProjectNavigation()
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const menu = ref<HTMLElement | null>(null)
function close(restoreFocus = false): void { open.value = false; if (restoreFocus) trigger.value?.focus() }
async function show(): Promise<void> { if (props.disabled) return; open.value = true; await nextTick(); menu.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus() }
async function toggle(): Promise<void> { if (open.value) close(); else await show() }
function keyboard(event: KeyboardEvent): void {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return }
  const items = [...(menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
  const index = items.findIndex(item => item === document.activeElement)
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    const position = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[position]?.focus()
  }
}
function focusOut(event: FocusEvent): void { if (event.relatedTarget instanceof Node && !root.value?.contains(event.relatedTarget)) close() }
function outside(event: PointerEvent): void { if (event.target instanceof Node && !root.value?.contains(event.target)) close() }
watch(open, value => { if (value) document.addEventListener('pointerdown', outside); else document.removeEventListener('pointerdown', outside) })
watch(() => props.disabled, value => { if (value) close() })
onBeforeUnmount(() => { document.removeEventListener('pointerdown', outside) })
</script>
<template>
  <li class="relative flex items-center gap-3 rounded-lg px-4 py-5 transition-colors hover:bg-subtle sm:gap-5 sm:px-5 motion-reduce:transition-none">
    <RouterLink
      :to="navigation?.tabs.get(project.id) ?? { name: 'project-materials', params: { projectId: project.id } }"
      :aria-label="`Open project ${project.name}`"
      class="min-w-0 flex-1 after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-accent"
    >
      <h2 class="text-lg font-semibold leading-snug [overflow-wrap:anywhere]">
        {{ project.name }}
      </h2>
      <p class="mt-1 text-sm text-muted">
        {{ project.partIds.length }} part references · {{ project.materialIds.length }} selected materials
      </p>
    </RouterLink>
    <div
      ref="root"
      class="relative z-10 shrink-0"
      @focusout="focusOut"
    >
      <button
        ref="trigger"
        type="button"
        class="button size-9 justify-center border-transparent p-2 text-muted"
        :aria-label="`Actions for ${project.name}`"
        aria-haspopup="menu"
        :aria-expanded="open"
        :aria-controls="`project-actions-${project.id}`"
        :disabled="disabled"
        @click="toggle"
        @keydown.down.prevent="show"
        @keydown.up.prevent="show"
      >
        <svg
          viewBox="0 0 24 24"
          class="size-5"
          fill="currentColor"
          aria-hidden="true"
        ><circle
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
        /></svg>
      </button>
      <div
        v-if="open"
        :id="`project-actions-${project.id}`"
        ref="menu"
        role="menu"
        :aria-label="`Actions for ${project.name}`"
        class="panel absolute right-0 top-full z-20 mt-1 w-56 space-y-1 p-1.5 shadow-lg"
        @keydown="keyboard"
      >
        <button
          type="button"
          role="menuitem"
          class="flex min-h-10 w-full items-center rounded-md px-3 py-2 text-left text-sm hover:bg-subtle"
          @click="close(true); emit('rename', project)"
        >
          Rename project
        </button>
        <ProjectExport
          :project-id="project.id"
          menu-item
        />
        <button
          type="button"
          role="menuitem"
          class="flex min-h-10 w-full items-center rounded-md px-3 py-2 text-left text-sm text-danger hover:bg-danger-surface"
          @click="close(true); emit('delete', project)"
        >
          Delete project
        </button>
      </div>
    </div>
  </li>
</template>
