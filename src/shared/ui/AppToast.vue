<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ToastNotification } from './toast-store'
import AppButton from './AppButton.vue'
import AppIcon from './AppIcon.vue'

const props = defineProps<{ notification: ToastNotification }>()
const emit = defineEmits<{ dismiss: [] }>()

const hovered = ref(false)
const focused = ref(false)
const paused = computed(() => hovered.value || focused.value)
let remaining = props.notification.duration
let startedAt = 0
let timer: ReturnType<typeof setTimeout> | undefined

function stop(): void {
  if (timer === undefined) return
  clearTimeout(timer)
  timer = undefined
  remaining = Math.max(0, remaining - (Date.now() - startedAt))
}

function resume(): void {
  if (props.notification.duration <= 0 || paused.value || timer !== undefined) return
  startedAt = Date.now()
  timer = setTimeout(() => {
    timer = undefined
    emit('dismiss')
  }, remaining)
}

function hover(isHovered: boolean): void {
  hovered.value = isHovered
  if (isHovered) stop()
  else resume()
}

function focus(event: FocusEvent): void {
  focused.value = event.type === 'focusin' || (
    event.relatedTarget instanceof Node
    && event.currentTarget instanceof Node
    && event.currentTarget.contains(event.relatedTarget)
  )
  if (focused.value) stop()
  else resume()
}

onMounted(resume)
onBeforeUnmount(stop)
</script>
<template>
  <article
    class="app-toast"
    @mouseenter="hover(true)"
    @mouseleave="hover(false)"
    @focusin="focus"
    @focusout="focus"
  >
    <AppIcon
      :name="notification.kind === 'error' ? 'info' : 'check'"
      class="app-toast-status"
      :class="notification.kind === 'error' ? 'text-danger' : 'text-success'"
    />
    <div
      :role="notification.kind === 'error' ? 'alert' : 'status'"
      aria-atomic="true"
      class="min-w-0 flex-1"
    >
      <p class="text-sm font-semibold">
        {{ notification.title }}
      </p>
      <p
        v-if="notification.description"
        class="mt-1 text-sm text-muted"
      >
        {{ notification.description }}
      </p>
    </div>
    <AppButton
      variant="ghost"
      size="small"
      icon-only
      :label="`Dismiss ${notification.title}`"
      @click="emit('dismiss')"
    >
      <AppIcon name="close" />
    </AppButton>
    <span
      v-if="notification.duration > 0"
      class="app-toast-progress"
      aria-hidden="true"
      :style="{ animationDuration: `${notification.duration}ms`, animationPlayState: paused ? 'paused' : 'running' }"
    />
  </article>
</template>
