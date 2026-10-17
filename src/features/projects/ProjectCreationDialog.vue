<script setup lang="ts">
import AppButton from '../../shared/ui/AppButton.vue'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { cuttingProjectSchema } from '../../domain/model/cutting-project'
import FormField from '../../shared/ui/FormField.vue'
import AppDialog from '../../shared/ui/AppDialog.vue'
import { persistenceErrorMessage } from '../../shared/ui/persistence-error-message'
import { useProjectService } from './project-service'

const emit = defineEmits<{ close: [] }>()

const service = useProjectService()
const router = useRouter()

const name = ref('')
const description = ref('')
const descriptionError = ref('')
const descriptionInput = ref<HTMLTextAreaElement | null>(null)
const nameError = ref('')
const error = ref('')
const busy = ref(false)
const nameInput = ref<HTMLInputElement | null>(null)
let active = true

onMounted(() => {
  nameInput.value?.focus()
})
onBeforeUnmount(() => {
  active = false
})

function close(): void {
  if (!busy.value) {
    emit('close')
  }
}

async function create(): Promise<void> {
  if (busy.value) {
    return
  }
  nameError.value = ''
  descriptionError.value = ''
  error.value = ''
  const parsed = cuttingProjectSchema.safeParse({
    id: crypto.randomUUID(),
    name: name.value,
    ...(description.value.trim() ? { description: description.value } : {}),
    partIds: [],
    materialIds: [],
    supplierProductIds: [],
  })
  if (!parsed.success) {
    nameError.value = parsed.error.issues.find(issue => issue.path[0] === 'name')?.message ?? ''
    descriptionError.value = parsed.error.issues.find(issue => issue.path[0] === 'description')?.message ?? ''
    if (nameError.value) {
      nameInput.value?.focus()
    } else {
      descriptionInput.value?.focus()
    }
    return
  }
  busy.value = true
  const result = await service.projects.create(parsed.data)
  if (!active) {
    return
  }
  if (result.ok) {
    await router.push({ name: 'project-materials', params: { projectId: result.value.id } })
  } else {
    busy.value = false
    error.value = persistenceErrorMessage(result.error, 'Project')
  }
}
</script>
<template>
  <AppDialog
    title="New Project"
    size="small"
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
      <FormField
        id="project-description"
        v-slot="{ controlAttrs }"
        label="Description"
        :error="descriptionError"
      >
        <textarea
          v-bind="controlAttrs"
          ref="descriptionInput"
          v-model="description"
          class="field"
          rows="3"
          maxlength="2000"
          :disabled="busy"
        />
      </FormField>
      <p
        v-if="error"
        role="alert"
        class="text-danger"
      >
        {{ error }}
      </p>
      <div class="dialog-actions">
        <AppButton
          type="submit"
          variant="primary"
          :loading="busy"
          :disabled="busy"
        >
          {{ busy ? 'Saving…' : 'Create project' }}
        </AppButton>
      </div>
    </form>
  </AppDialog>
</template>
