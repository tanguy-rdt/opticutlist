<script setup lang="ts">
import AppButton from '../../shared/ui/AppButton.vue'
import { computed, nextTick, reactive, ref, shallowRef } from 'vue'
import { stockItemSchema, type StockItem } from '../../domain/model/stock-item'
import type { Material } from '../../domain/model/material'
import { grainDirectionSchema } from '../../domain/model/orientation'
import FormField from '../../shared/ui/FormField.vue'
import MaterialSelector from '../materials/MaterialSelector.vue'
import { materialPresets } from '../materials/material-library'

const props = defineProps<{ item: StockItem | null; materials: readonly Material[]; disabled: boolean }>()
const emit = defineEmits<{ save: [item: StockItem, presetId?: string] }>()
const form = ref<HTMLFormElement | null>(null)
const materialId = ref<string>(props.item?.materialId ?? '')
const kind = ref(props.item?.kind ?? 'fullPanel')
const grain = ref(props.item?.grainDirection ?? 'none')
const numbers = reactive<{ lengthMm: number | string; widthMm: number | string; thicknessMm: number | string; quantity: number | string }>({
  lengthMm: props.item?.lengthMm ?? '',
  widthMm: props.item?.widthMm ?? '',
  thicknessMm: props.item?.thicknessMm ?? '',
  quantity: props.item?.quantity ?? 1
})
const dimensions = [{ key: 'lengthMm', label: 'Length (mm)' }, { key: 'widthMm', label: 'Width (mm)' }, { key: 'thicknessMm', label: 'Thickness (mm)' }] as const
const errors = shallowRef<ReadonlyMap<string, string>>(new Map())

function presetValue(id: string): string {
  let value = `preset:${id}`
  while (props.materials.some(material => material.id === value)) {
    value += ':'
  }
  return value
}

const preset = computed(() => materialPresets.find(item => presetValue(item.id) === materialId.value))
const options = computed(() => [
  ...materialPresets.map(item => ({ value: presetValue(item.id), name: item.name, group: item.category, presetId: item.id })),
  ...props.materials.map(item => ({ value: item.id, name: item.name, group: 'Existing catalog materials', presetId: item.libraryPresetId })),
])

function numeric(value: number | string): number | undefined {
  return typeof value === 'string' && value.trim() === '' ? undefined : Number(value)
}

async function submit(): Promise<void> {
  if (props.disabled) {
    return
  }
  const parsed = stockItemSchema.safeParse({
    id: props.item?.id ?? crypto.randomUUID(),
    materialId: preset.value ? crypto.randomUUID() : materialId.value,
    kind: kind.value,
    lengthMm: numeric(numbers.lengthMm),
    widthMm: numeric(numbers.widthMm),
    thicknessMm: numeric(numbers.thicknessMm),
    quantity: numeric(numbers.quantity),
    grainDirection: grain.value,
    provenance: props.item?.provenance ?? { source: 'manual' }
  })
  const issues = new Map(parsed.success ? [] : parsed.error.issues.map(issue => [String(issue.path[0]), issue.message]))
  if (!preset.value && !props.materials.some(item => item.id === materialId.value)) {
    issues.set('materialId', 'Choose a material or built-in preset.')
  }
  errors.value = issues
  if (issues.size) {
    await nextTick();
    form.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  } else if (parsed.success) {
    emit('save', parsed.data, preset.value?.id)
  }
}
</script>
<template>
  <form
    ref="form"
    aria-label="Stock editor"
    novalidate
    class="space-y-5"
    @submit.prevent="submit"
  >
    <p class="text-sm text-muted">
      Record panels or offcuts you physically own. <span aria-hidden="true">*</span> Required fields.
    </p>
    <FormField
      id="stock-material"
      label="Material"
      required
      required-indicator="asterisk"
      :error="errors.get('materialId') ?? ''"
    >
      <template #default="{ controlAttrs }">
        <MaterialSelector
          v-model="materialId"
          v-bind="controlAttrs"
          :options="options"
          :disabled="disabled"
          :allow-custom-creation="false"
        />
      </template>
    </FormField>
    <section
      class="space-y-3 border-t border-line pt-4"
      aria-labelledby="stock-dimensions-heading"
    >
      <h3
        id="stock-dimensions-heading"
        class="text-sm font-semibold"
      >
        Panel dimensions
      </h3>
      <div class="grid gap-4 sm:grid-cols-3">
        <FormField
          v-for="field in dimensions"
          :id="`stock-${field.key}`"
          :key="field.key"
          :label="field.label"
          required
          required-indicator="asterisk"
          :error="errors.get(field.key) ?? ''"
        >
          <template #default="{ controlAttrs }">
            <input
              v-model.number="numbers[field.key]"
              v-bind="controlAttrs"
              class="field"
              type="number"
              inputmode="decimal"
              min="0"
              step="any"
              :disabled="disabled"
            >
          </template>
        </FormField>
      </div>
    </section>
    <div class="grid gap-4 sm:grid-cols-2">
      <FormField
        id="stock-kind"
        label="Item type"
        required
        required-indicator="asterisk"
        :error="errors.get('kind') ?? ''"
      >
        <template #default="{ controlAttrs }">
          <select
            v-model="kind"
            v-bind="controlAttrs"
            class="field"
            :disabled="disabled"
          >
            <option value="fullPanel">
              Full panel
            </option><option value="offcut">
              Offcut
            </option>
          </select>
        </template>
      </FormField>
      <FormField
        id="stock-quantity"
        label="Owned quantity"
        required
        required-indicator="asterisk"
        :error="errors.get('quantity') ?? ''"
      >
        <template #default="{ controlAttrs }">
          <input
            v-model.number="numbers.quantity"
            v-bind="controlAttrs"
            class="field"
            type="number"
            inputmode="numeric"
            min="1"
            step="1"
            :disabled="disabled"
          >
        </template>
      </FormField>
      <FormField
        id="stock-grain"
        label="Grain direction"
        required
        required-indicator="asterisk"
        :error="errors.get('grainDirection') ?? ''"
      >
        <template #default="{ controlAttrs }">
          <select
            v-model="grain"
            v-bind="controlAttrs"
            class="field"
            :disabled="disabled"
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
    <p
      v-if="item"
      class="text-xs text-muted"
    >
      Original source: {{ item.provenance.source }}. Past cutting records and provenance stay unchanged.
    </p>
    <div class="dialog-actions">
      <AppButton
        type="submit"
        variant="primary"
        :disabled="disabled"
      >
        {{ disabled ? 'Saving stock…' : (item ? 'Save stock changes' : 'Add stock item') }}
      </AppButton>
    </div>
  </form>
</template>
