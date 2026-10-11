<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { cuttingProjectSchema } from '../../domain/model/cutting-project'
import FormField from '../../shared/ui/FormField.vue'
import CatalogFormDialog from '../suppliers/CatalogFormDialog.vue'
import { persistenceErrorMessage } from '../../shared/ui/persistence-error-message'
import { useProjectService } from './project-service'

const emit = defineEmits<{ close: [] }>()
const service = useProjectService()
const router = useRouter()
const name = ref('')
const nameError = ref('')
const error = ref('')
const busy = ref(false)
const nameInput = ref<HTMLInputElement | null>(null)
let active = true
onMounted(() => { nameInput.value?.focus() })
onBeforeUnmount(() => { active = false })
function close(): void { if (!busy.value) emit('close') }
async function create(): Promise<void> {
  if (busy.value) return
  nameError.value = ''; error.value = ''
  const parsed = cuttingProjectSchema.safeParse({ id: crypto.randomUUID(), name: name.value, partIds: [], materialIds: [], supplierProductIds: [] })
  if (!parsed.success) { nameError.value = parsed.error.issues.find(issue => issue.path[0] === 'name')?.message ?? 'Invalid project name'; nameInput.value?.focus(); return }
  busy.value = true
  const result = await service.projects.create(parsed.data)
  if (!active) return
  if (result.ok) await router.push({ name: 'project-parts', params: { projectId: result.value.id } })
  else { busy.value = false; error.value = persistenceErrorMessage(result.error, 'Project') }
}
</script>
<template>
  <CatalogFormDialog
    title="New Project"
    :busy="busy"
    @close="close"
  >
    <form
      class="space-y-5"
      novalidate
      :aria-busy="busy"
      @submit.prevent="create"
    >
      <FormField
        id="project-name"
        v-slot="{ controlAttrs }"
        label="Project name"
        :error="nameError"
        required
      >
        <input
          v-bind="controlAttrs"
          ref="nameInput"
          v-model="name"
          class="field"
          maxlength="200"
          autocomplete="off"
          :disabled="busy"
        >
      </FormField>
      <p
        v-if="error"
        role="alert"
        class="text-danger"
      >
        {{ error }}
      </p>
      <div class="flex justify-end">
        <button
          type="submit"
          class="button button-primary"
          :disabled="busy"
        >
          {{ busy ? 'Saving…' : 'Create project' }}
        </button>
      </div>
    </form>
  </CatalogFormDialog>
</template>
