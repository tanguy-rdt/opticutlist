import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface ToastNotification {
  id: number
  title: string
  description?: string
  duration: number
  kind?: 'error'
}

/** Transient UI state scoped to the application's Pinia instance. */
export const useToastStore = defineStore('toasts', () => {
  const notifications = ref<ToastNotification[]>([])
  let nextId = 0

  function success(title: string, description?: string, duration = 4000): number {
    const existing = notifications.value.find(notification =>
      notification.kind !== 'error' && notification.title === title && notification.description === description,
    )
    if (existing) {
      return existing.id
    }
    const id = ++nextId
    notifications.value.push({ id, title, ...(description ? { description } : {}), duration })
    return id
  }

  function error(title: string, description?: string): number {
    const existing = notifications.value.find(notification =>
      notification.kind === 'error' && notification.title === title && notification.description === description,
    )
    if (existing) {
      return existing.id
    }
    const id = ++nextId
    notifications.value.push({ id, title, ...(description ? { description } : {}), duration: 0, kind: 'error' })
    return id
  }

  function dismiss(id: number): void {
    notifications.value = notifications.value.filter(notification => notification.id !== id)
  }

  return { notifications, success, error, dismiss }
})
