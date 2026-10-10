<script setup lang="ts">
import { computed, nextTick, ref, shallowRef } from 'vue'

import type { Material } from '../../domain/model/material'
import { grainDirectionSchema, rotationPolicySchema } from '../../domain/model/orientation'
import { partSchema, type Part } from '../../domain/model/part'
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
const missingMaterial = computed(() => materialId.value !== '' && !props.materials.some((material) => material.id === materialId.value))

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
    form.value?.querySelector<HTMLInputElement | HTMLSelectElement>('[aria-invalid="true"]')?.focus()
    return
  }
  if (result.success) emit('save', result.data)
}
</script>

<template>
  <section
    class="panel p-6"
    aria-labelledby="part-form-title"
  >
    <div class="mb-6 space-y-2">
      <p class="eyebrow">
        {{ part ? 'Update your library' : 'Add to your library' }}
      </p>
      <h2
        id="part-form-title"
        class="text-xl font-semibold"
      >
        {{ part ? 'Edit part' : 'New part' }}
      </h2>
      <p class="text-sm text-muted">
        Enter finished dimensions in millimeters. Length and width define the face; thickness is required for material compatibility.
      </p>
    </div>
    <form
      ref="form"
      novalidate
      class="space-y-5"
      :aria-busy="busy"
      @submit.prevent="submit"
    >
      <div class="grid gap-5 md:grid-cols-2">
        <FormField
          id="part-name"
          label="Name"
          required
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
          :error="errors.get('materialId') ?? ''"
        >
          <template #default="{ controlAttrs }">
            <select
              v-model="materialId"
              v-bind="controlAttrs"
              class="field"
              name="materialId"
              :disabled="disabled || busy || materials.length === 0"
            >
              <option
                value=""
                disabled
              >
                Select a material
              </option>
              <option
                v-if="missingMaterial"
                :value="materialId"
                disabled
              >
                Unavailable material — choose another
              </option>
              <option
                v-for="material in materials"
                :key="material.id"
                :value="material.id"
              >
                {{ material.name }} · {{ material.category }}
              </option>
            </select>
          </template>
        </FormField>
      </div>
      <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <FormField
          id="part-length"
          label="Length (mm)"
          required
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
          id="part-quantity"
          label="Quantity"
          required
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
      <div class="grid gap-5 md:grid-cols-2">
        <FormField
          id="part-grain"
          label="Grain direction"
          required
          :error="errors.get('grainDirection') ?? ''"
          hint="Direction relative to this part's length and width."
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
        <FormField
          id="part-rotation"
          label="90° rotation"
          required
          :error="errors.get('rotation') ?? ''"
          hint="Grain direction still applies when rotation is allowed."
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
                {{ policy === 'allowed' ? 'Allowed' : 'Forbidden' }}
              </option>
            </select>
          </template>
        </FormField>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          type="submit"
          class="button button-primary"
          :disabled="disabled || busy || materials.length === 0"
        >
          {{ busy ? 'Please wait…' : (part ? 'Save changes' : 'Create part') }}
        </button>
        <button
          v-if="part"
          type="button"
          class="button"
          :disabled="disabled || busy"
          @click="emit('cancel')"
        >
          Cancel
        </button>
      </div>
    </form>
  </section>
</template>
