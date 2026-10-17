<script setup lang="ts">
import AppButton from '../../shared/ui/AppButton.vue'
import { nextTick, ref, shallowRef } from 'vue'
import { supplierSchema, type Supplier } from '../../domain/model/supplier'
import FormField from '../../shared/ui/FormField.vue'
import { supplierWebsiteInputSchema } from './supplier-website'

const supplierInputSchema = supplierSchema.extend({ websiteUrl: supplierWebsiteInputSchema })
  .transform(({ websiteUrl, ...record }): Supplier => ({ ...record, ...(websiteUrl ? { websiteUrl } : {}) }))

const props = defineProps<{ supplier: Supplier | null; disabled: boolean }>()
const emit = defineEmits<{ save: [supplier: Supplier]; cancel: [] }>()

const name = ref(props.supplier?.name ?? '')
const websiteUrl = ref(props.supplier?.websiteUrl ?? '')
const errors = shallowRef<ReadonlyMap<string, string>>(new Map())
const form = ref<HTMLFormElement | null>(null)

function focusName(): void {
  form.value?.querySelector<HTMLInputElement>('input')?.focus()
}

defineExpose({ focusName })

async function submit(): Promise<void> {
  if (props.disabled) {
    return
  }
  const result = supplierInputSchema.safeParse({
    id: props.supplier?.id ?? crypto.randomUUID(),
    name: name.value,
    websiteUrl: websiteUrl.value,
  })
  errors.value = new Map(
    result.success ? [] : result.error.issues.map(issue => [String(issue.path[0]), issue.message]),
  )
  if (result.success) {
    emit('save', result.data)
  } else {
    await nextTick()
    form.value?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus()
  }
}
</script>
<template>
  <section
    class="panel p-6"
    aria-labelledby="supplier-form-title"
  >
    <h2
      id="supplier-form-title"
      class="mb-5 text-xl font-semibold"
    >
      {{ supplier ? 'Edit supplier' : 'New supplier' }}
    </h2>
    <form
      ref="form"
      novalidate
      class="space-y-5"
      @submit.prevent="submit"
    >
      <FormField
        id="supplier-name"
        label="Name"
        required
        :error="errors.get('name') ?? ''"
      >
        <template #default="{ controlAttrs }">
          <input
            v-model="name"
            v-bind="controlAttrs"
            class="field"
            maxlength="200"
            autocomplete="off"
            :disabled="disabled"
          >
        </template>
      </FormField>
      <FormField
        id="supplier-website"
        label="Website URL"
        :error="errors.get('websiteUrl') ?? ''"
      >
        <template #default="{ controlAttrs }">
          <input
            v-model="websiteUrl"
            v-bind="controlAttrs"
            class="field"
            type="text"
            inputmode="url"
            autocomplete="url"
            autocapitalize="none"
            :spellcheck="false"
            placeholder="supplier.example"
            :disabled="disabled"
          >
        </template>
      </FormField>
      <div class="dialog-actions">
        <AppButton
          v-if="supplier"
          type="button"

          :disabled="disabled"
          @click="emit('cancel')"
        >
          Cancel
        </AppButton>
        <AppButton
          type="submit"
          variant="primary"
          :disabled="disabled"
        >
          {{ supplier ? 'Save supplier' : 'Create supplier' }}
        </AppButton>
      </div>
    </form>
  </section>
</template>
