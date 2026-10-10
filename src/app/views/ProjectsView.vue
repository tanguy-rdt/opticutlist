<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { cuttingProjectSchema } from '../../domain/model/cutting-project'
import FormField from '../../shared/ui/FormField.vue'
import { persistenceErrorMessage } from '../../shared/ui/persistence-error-message'
import ProjectList from '../../features/projects/ProjectList.vue'
import { useProjectService } from '../../features/projects/project-service'

const service = useProjectService()
const router = useRouter()
const name = ref('')
const nameError = ref('')
const error = ref('')
const busy = ref(false)
const nameInput = ref<HTMLInputElement | null>(null)
async function create(): Promise<void> {
  if (busy.value) return
  nameError.value = ''
  error.value = ''
  const parsed = cuttingProjectSchema.safeParse({ id: crypto.randomUUID(), name: name.value, partIds: [], materialIds: [], supplierProductIds: [] })
  if (!parsed.success) {
    nameError.value = parsed.error.issues.find(issue => issue.path[0] === 'name')?.message ?? 'Invalid project name'
    nameInput.value?.focus()
    return
  }
  busy.value = true
  const result = await service.projects.create(parsed.data)
  if (result.ok) await router.push({ name: 'project-parts', params: { projectId: result.value.id } })
  else error.value = persistenceErrorMessage(result.error, 'Project')
  busy.value = false
}
</script>
<template>
  <section class="space-y-6">
    <RouterLink
      to="/"
      class="button"
    >
      <span aria-hidden="true">←</span> Back to Home
    </RouterLink>
    <div class="space-y-2">
      <p class="eyebrow">
        Project workspace
      </p>
      <h1 class="text-3xl font-semibold tracking-tight">
        New Project
      </h1>
      <p class="text-muted">
        Give your build a name. Parts and catalog choices stay with this project.
      </p>
    </div>
    <form
      class="panel max-w-2xl space-y-5 p-6"
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
      <button
        type="submit"
        class="button button-primary"
        :disabled="busy"
      >
        {{ busy ? 'Creating…' : 'Create project' }}
      </button>
    </form>
    <ProjectList />
  </section>
</template>
