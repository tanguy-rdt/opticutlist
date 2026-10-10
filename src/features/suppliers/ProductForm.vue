<script setup lang="ts">
import { nextTick, reactive, ref, shallowRef } from 'vue'
import type { Material } from '../../domain/model/material'
import type { Supplier } from '../../domain/model/supplier'
import { grainDirectionSchema } from '../../domain/model/orientation'
import { supplierProductSchema, productAvailabilitySchema, type SupplierProduct } from '../../domain/model/supplier-product'
import FormField from '../../shared/ui/FormField.vue'

const props = defineProps<{ product: SupplierProduct | null; suppliers: readonly Supplier[]; materials: readonly Material[]; initialSupplierId: string; disabled: boolean }>()
const emit = defineEmits<{ save: [product: SupplierProduct]; cancel: [] }>()
const form = ref<HTMLFormElement | null>(null)
const name = ref(props.product?.name ?? '')
const supplierId = ref<string>(props.product?.supplierId ?? props.initialSupplierId)
const materialId = ref<string>(props.product?.materialId ?? '')
const numbers = reactive<{ lengthMm: number | string; widthMm: number | string; thicknessMm: number | string; price: number | string }>({ lengthMm: props.product?.lengthMm ?? '', widthMm: props.product?.widthMm ?? '', thicknessMm: props.product?.thicknessMm ?? '', price: props.product?.price ?? '' })
const currency = ref(props.product?.currency ?? 'EUR')
const productUrl = ref(props.product?.productUrl ?? '')
const grainDirection = ref(props.product?.grainDirection ?? 'none')
const availability = ref(props.product?.availability ?? 'unknown')
const errors = shallowRef<ReadonlyMap<string, string>>(new Map())
const numericFields = [
  { key: 'lengthMm', label: 'Length (mm)' }, { key: 'widthMm', label: 'Width (mm)' },
  { key: 'thicknessMm', label: 'Thickness (mm)' }, { key: 'price', label: 'Price per panel' },
] as const
function numberInput(value: number | string): number | undefined { return typeof value === 'string' && value.trim() === '' ? undefined : Number(value) }
function focusName(): void { form.value?.querySelector<HTMLInputElement>('input')?.focus() }
defineExpose({ focusName })
async function submit(): Promise<void> {
  if (props.disabled || props.suppliers.length === 0 || props.materials.length === 0) return
  const result = supplierProductSchema.safeParse({
    id: props.product?.id ?? crypto.randomUUID(), name: name.value, supplierId: supplierId.value, materialId: materialId.value,
    lengthMm: numberInput(numbers.lengthMm), widthMm: numberInput(numbers.widthMm), thicknessMm: numberInput(numbers.thicknessMm), price: numberInput(numbers.price),
    currency: currency.value.trim(), grainDirection: grainDirection.value, availability: availability.value,
    ...(productUrl.value.trim() ? { productUrl: productUrl.value.trim() } : {}),
  })
  const issues = new Map(result.success ? [] : result.error.issues.map((issue) => [String(issue.path[0]), issue.message]))
  if (!props.suppliers.some((supplier) => supplier.id === supplierId.value)) issues.set('supplierId', 'Choose an existing supplier.')
  if (!props.materials.some((material) => material.id === materialId.value)) issues.set('materialId', 'Choose an existing material.')
  errors.value = issues
  if (issues.size > 0) {
    await nextTick()
    form.value?.querySelector<HTMLInputElement | HTMLSelectElement>('[aria-invalid="true"]')?.focus()
  } else if (result.success) emit('save', result.data)
}
</script>
<template>
  <section
    class="panel p-6"
    aria-labelledby="product-form-title"
  >
    <h2
      id="product-form-title"
      class="mb-2 text-xl font-semibold"
    >
      {{ product ? 'Edit product' : 'New catalog product' }}
    </h2>
    <p class="mb-5 text-sm text-muted">
      A purchasable panel, not owned stock. Enter all three dimensions in millimeters.
    </p>
    <form
      ref="form"
      novalidate
      class="space-y-5"
      @submit.prevent="submit"
    >
      <FormField
        id="product-name"
        label="Product name"
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
      <div class="grid gap-5 md:grid-cols-2">
        <FormField
          id="product-supplier"
          label="Supplier"
          required
          :error="errors.get('supplierId') ?? ''"
        >
          <template #default="{ controlAttrs }">
            <select
              v-model="supplierId"
              v-bind="controlAttrs"
              class="field"
              :disabled="disabled || suppliers.length === 0"
            >
              <option
                value=""
                disabled
              >
                Select a supplier
              </option>
              <option
                v-if="supplierId && !suppliers.some((supplier) => supplier.id === supplierId)"
                :value="supplierId"
                disabled
              >
                Missing supplier — choose another
              </option>
              <option
                v-for="supplier in suppliers"
                :key="supplier.id"
                :value="supplier.id"
              >
                {{ supplier.name }}
              </option>
            </select>
          </template>
        </FormField>
        <FormField
          id="product-material"
          label="Material"
          required
          :error="errors.get('materialId') ?? ''"
        >
          <template #default="{ controlAttrs }">
            <select
              v-model="materialId"
              v-bind="controlAttrs"
              class="field"
              :disabled="disabled || materials.length === 0"
            >
              <option
                value=""
                disabled
              >
                Select a material
              </option>
              <option
                v-if="materialId && !materials.some((material) => material.id === materialId)"
                :value="materialId"
                disabled
              >
                Missing material — choose another
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
          v-for="field in numericFields"
          :id="`product-${field.key}`"
          :key="field.key"
          :label="field.label"
          required
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
      <div class="grid gap-5 md:grid-cols-3">
        <FormField
          id="product-currency"
          label="Currency"
          required
          hint="Three uppercase letters, e.g. EUR or USD."
          :error="errors.get('currency') ?? ''"
        >
          <template #default="{ controlAttrs }">
            <input
              v-model="currency"
              v-bind="controlAttrs"
              class="field"
              maxlength="3"
              :disabled="disabled"
            >
          </template>
        </FormField>
        <FormField
          id="product-grain"
          label="Grain direction"
          required
          :error="errors.get('grainDirection') ?? ''"
        >
          <template #default="{ controlAttrs }">
            <select
              v-model="grainDirection"
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
        <FormField
          id="product-availability"
          label="Availability"
          required
          :error="errors.get('availability') ?? ''"
        >
          <template #default="{ controlAttrs }">
            <select
              v-model="availability"
              v-bind="controlAttrs"
              class="field"
              :disabled="disabled"
            >
              <option
                v-for="value in productAvailabilitySchema.options"
                :key="value"
                :value="value"
              >
                {{ value === 'available' ? 'Available' : (value === 'unavailable' ? 'Unavailable' : 'Unknown') }}
              </option>
            </select>
          </template>
        </FormField>
      </div>
      <FormField
        id="product-url"
        label="Product URL (optional)"
        :error="errors.get('productUrl') ?? ''"
      >
        <template #default="{ controlAttrs }">
          <input
            v-model="productUrl"
            v-bind="controlAttrs"
            class="field"
            type="url"
            placeholder="https://supplier.example/panel"
            :disabled="disabled"
          >
        </template>
      </FormField>
      <div class="flex flex-wrap gap-2">
        <button
          type="submit"
          class="button button-primary"
          :disabled="disabled || suppliers.length === 0 || materials.length === 0"
        >
          {{ product ? 'Save product' : 'Create product' }}
        </button>
        <button
          v-if="product"
          type="button"
          class="button"
          :disabled="disabled"
          @click="emit('cancel')"
        >
          Cancel
        </button>
      </div>
    </form>
  </section>
</template>
