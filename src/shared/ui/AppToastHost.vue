<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import AppToast from './AppToast.vue'
import { useToastStore } from './toast-store'
const toasts = useToastStore()
onBeforeUnmount(() => { for (const item of toasts.notifications) toasts.dismiss(item.id) })
</script>
<template>
  <TransitionGroup
    name="toast"
    tag="div"
    class="app-toast-host"
    aria-label="Notifications"
  >
    <AppToast
      v-for="item in toasts.notifications"
      :key="item.id"
      :notification="item"
      @dismiss="toasts.dismiss(item.id)"
    />
  </TransitionGroup>
</template>
