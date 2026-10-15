import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface ToastNotification {
  id: number
  title: string
  description?: string
  duration: number
}

/** Transient UI state scoped to the application's Pinia instance. */
export const useToastStore = defineStore('toasts', () => {
  const notifications = ref<ToastNotification[]>([])
  let nextId = 0
  function success(title: string, description?: string, duration = 4000): number {
    const existing = notifications.value.find(item => item.title === title && item.description === description)
    if (existing) return existing.id
    const id = ++nextId
    notifications.value.push({ id, title, ...(description ? { description } : {}), duration })
    return id
  }
  function dismiss(id: number): void { notifications.value = notifications.value.filter(item => item.id !== id) }
  return { notifications, success, dismiss }
})
