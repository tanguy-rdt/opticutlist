<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import type { CuttingProjectId } from '../../domain/model/ids'
import { downloadProject, useProjectTransferService } from './project-transfer-service'
import { persistenceErrorMessage } from '../../shared/ui/persistence-error-message'
const props = defineProps<{ projectId: CuttingProjectId; menuItem?: boolean }>()
const service = useProjectTransferService()
const busy = ref(false)
const error = ref('')
const feedback = ref('')
let active = true
onBeforeUnmount(() => { active = false })
async function exportProject(): Promise<void> {
  if (!service || busy.value) return
  busy.value = true; error.value = ''; feedback.value = ''
  try {
    const result = await service.export(props.projectId)
    if (!active) return
    if (!result.ok) { error.value = persistenceErrorMessage(result.error, 'Project') + (result.error.kind === 'invalidRecord' ? ` ${result.error.issues.map(issue => issue.message).join('; ')}` : ''); return }
    downloadProject(result.value.text, result.value.name)
    feedback.value = 'Project JSON download started. Includes saved plans; inventory and unsaved edits are excluded.'
  } catch (cause) { if (active) error.value = cause instanceof Error ? cause.message : 'Could not export this project.' }
  finally { if (active) busy.value = false }
}
</script>
<template>
  <div class="space-y-2">
    <button
      :class="menuItem ? 'action-menu-item' : 'button'"
      :role="menuItem ? 'menuitem' : undefined"
      type="button"
      :disabled="!service || busy"
      :aria-busy="busy"
      @click="exportProject"
    >
      {{ busy ? 'Exporting…' : menuItem ? 'Export project' : 'Export Project' }}
    </button>
    <p
      v-if="error"
      role="alert"
      class="text-danger"
    >
      {{ error }}
    </p>
    <p
      v-if="feedback"
      role="status"
      class="text-sm text-muted"
    >
      {{ feedback }}
    </p>
  </div>
</template>
