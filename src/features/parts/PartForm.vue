<script setup lang="ts">
import AppButton from '../../shared/ui/AppButton.vue'
import { computed, nextTick, ref, shallowRef } from 'vue'

import type { Material } from '../../domain/model/material'
import { grainDirectionSchema, rotationPolicySchema } from '../../domain/model/orientation'
import { partSchema, type Part } from '../../domain/model/part'
import MaterialSelector from '../materials/MaterialSelector.vue'
import FormField from '../../shared/ui/FormField.vue'

const props = defineProps<{
  part: Part | null
  materials: readonly Material[]
  disabled: boolean
  busy: boolean
}>()
const emit = defineEmits<{ save: [part: Part]; cancel: [] }>()
const form = ref<HTMLFormElement | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)
const name = ref(props.part?.name ?? '')
const materialId = ref<string>(props.part?.materialId ?? '')
const lengthMm = ref<number | string>(props.part?.lengthMm ?? '')
const widthMm = ref<number | string>(props.part?.widthMm ?? '')
const thicknessMm = ref<number | string>(props.part?.thicknessMm ?? '')
const quantity = ref<number | string>(props.part?.quantity ?? 1)
const grainDirection = ref(props.part?.grainDirection ?? 'none')
const rotation = ref(props.part?.rotation ?? 'allowed')
const errors = shallowRef<ReadonlyMap<string, string>>(new Map())
const materialOptions = computed(() => props.materials.map(material => ({ value: material.id, name: material.name, group: material.category, presetId: material.libraryPresetId })))

function numberInput(value: number | string): number | undefined {
  return typeof value === 'string' && value.trim() === '' ? undefined : Number(value)
}
function focusName(): void { nameInput.value?.focus() }
defineExpose({ focusName })

async function submit(): Promise<void> {
  if (props.disabled || props.busy || props.materials.length === 0) return
  const result = partSchema.safeParse({
    id: props.part?.id ?? crypto.randomUUID(),
    name: name.value,
    materialId: materialId.value,
    lengthMm: numberInput(lengthMm.value),
    widthMm: numberInput(widthMm.value),
    thicknessMm: numberInput(thicknessMm.value),
    quantity: numberInput(quantity.value),
    grainDirection: grainDirection.value,
    rotation: rotation.value,
  })
  const issues = new Map<string, string>()
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = issue.path[0]
      if (typeof field === 'string') issues.set(field, issue.message)
    }
  }
  if (!props.materials.some((material) => material.id === materialId.value)) {
    issues.set('materialId', 'Choose an existing material.')
  }
  errors.value = issues
  if (issues.size > 0) {
    await nextTick()
    form.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    return
  }
  if (result.success) emit('save', result.data)
}
</script>

<template>
  <form
    ref="form"
    novalidate
    class="space-y-6"
    :aria-busy="busy"
    @submit.prevent="submit"
  >
    <p class="text-xs text-muted">
      * Required fields. Dimensions in millimeters.
    </p>
    <section class="space-y-4">
      <h3 class="text-sm font-semibold">
        General information
      </h3>
      <div class="grid gap-4">
        <FormField
          id="part-name"
          label="Name"
          required
          required-indicator="asterisk"
          :error="errors.get('name') ?? ''"
        >
          <template #default="{ controlAttrs }">
            <input
              ref="nameInput"
              v-model="name"
              v-bind="controlAttrs"
              class="field"
              name="name"
              maxlength="200"
              autocomplete="off"
              :disabled="disabled || busy"
              placeholder="e.g. Side panel"
            >
          </template>
        </FormField>
        <FormField
          id="part-material"
          label="Material"
          required
          required-indicator="asterisk"
          :error="errors.get('materialId') ?? ''"
        >
          <template #default="{ controlAttrs }">
            <MaterialSelector
              v-bind="controlAttrs"
              id="part-material"
              v-model="materialId"
              :options="materialOptions"
              :allow-custom-creation="false"
              :disabled="disabled || busy || materials.length === 0"
            />
          </template>
        </FormField>
      </div>
    </section>
    <section class="space-y-4 border-t border-line pt-5">
      <h3 class="text-sm font-semibold">
        Dimensions
      </h3>
      <div class="grid gap-4 sm:grid-cols-2">
        <FormField
          id="part-length"
          label="Length (mm)"
          required
          required-indicator="asterisk"
          :error="errors.get('lengthMm') ?? ''"
        >
          <template #default="{ controlAttrs }">
            <input
              v-model.number="lengthMm"
              v-bind="controlAttrs"
              class="field"
              name="lengthMm"
              type="number"
              inputmode="decimal"
              min="0"
              step="any"
              :disabled="disabled || busy"
            >
          </template>
        </FormField>
        <FormField
          id="part-width"
          label="Width (mm)"
          required
          required-indicator="asterisk"
          :error="errors.get('widthMm') ?? ''"
        >
          <template #default="{ controlAttrs }">
            <input
              v-model.number="widthMm"
              v-bind="controlAttrs"
              class="field"
              name="widthMm"
              type="number"
              inputmode="decimal"
              min="0"
              step="any"
              :disabled="disabled || busy"
            >
          </template>
        </FormField>
        <FormField
          id="part-thickness"
          label="Thickness (mm)"
          required
          required-indicator="asterisk"
          :error="errors.get('thicknessMm') ?? ''"
        >
          <template #default="{ controlAttrs }">
            <input
              v-model.number="thicknessMm"
              v-bind="controlAttrs"
              class="field"
              name="thicknessMm"
              type="number"
              inputmode="decimal"
              min="0"
              step="any"
              :disabled="disabled || busy"
            >
          </template>
        </FormField>
        <FormField
          id="part-grain"
          label="Grain direction"
          required
          required-indicator="asterisk"
          :error="errors.get('grainDirection') ?? ''"
        >
          <template #default="{ controlAttrs }">
            <select
              v-model="grainDirection"
              v-bind="controlAttrs"
              class="field"
              name="grainDirection"
              :disabled="disabled || busy"
            >
              <option
                v-for="direction in grainDirectionSchema.options"
                :key="direction"
                :value="direction"
              >
                {{ direction === 'none' ? 'No grain constraint' : (direction === 'length' ? 'Along length' : 'Along width') }}
              </option>
            </select>
          </template>
        </FormField>
      </div>
    </section>
    <section class="space-y-4 border-t border-line pt-5">
      <h3 class="text-sm font-semibold">
        Production
      </h3>
      <div class="max-w-48">
        <FormField
          id="part-quantity"
          label="Quantity"
          required
          required-indicator="asterisk"
          :error="errors.get('quantity') ?? ''"
        >
          <template #default="{ controlAttrs }">
            <input
              v-model.number="quantity"
              v-bind="controlAttrs"
              class="field"
              name="quantity"
              type="number"
              inputmode="numeric"
              min="1"
              step="1"
              :disabled="disabled || busy"
            >
          </template>
        </FormField>
      </div>
    </section>
    <section
      v-if="grainDirection === 'none'"
      class="space-y-4 border-t border-line pt-5"
    >
      <h3 class="text-sm font-semibold">
        Cutting constraints
      </h3>
      <div class="grid gap-4 sm:grid-cols-2">
        <FormField
          id="part-rotation"
          label="90° rotation"
          required
          required-indicator="asterisk"
          :error="errors.get('rotation') ?? ''"
        >
          <template #default="{ controlAttrs }">
            <select
              v-model="rotation"
              v-bind="controlAttrs"
              class="field"
              name="rotation"
              :disabled="disabled || busy"
            >
              <option
                v-for="policy in rotationPolicySchema.options"
                :key="policy"
                :value="policy"
              >
                {{ policy === 'allowed' ? 'Allowed' : 'Not allowed' }}
              </option>
            </select>
          </template>
        </FormField>
      </div>
    </section>
    <div class="dialog-actions">
      <AppButton
        type="button"

        :disabled="disabled || busy"
        @click="emit('cancel')"
      >
        Cancel
      </AppButton>
      <AppButton
        type="submit"
        variant="primary"
        :loading="busy"
        :disabled="disabled || busy || materials.length === 0"
      >
        {{ busy ? 'Please wait…' : (part ? 'Save changes' : 'Create part') }}
      </AppButton>
    </div>
  </form>
</template>
