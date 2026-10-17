<script setup lang="ts">
import { ref } from 'vue'
import type { SupplierProduct } from '../../domain/model/supplier-product'
import type { StockItem } from '../../domain/model/stock-item'
import { quantitySchema } from '../../domain/model/common'
import { useStockRepository } from '../inventory/stock-repository'
import AppDialog from '../../shared/ui/AppDialog.vue'
import AppButton from '../../shared/ui/AppButton.vue'
import FormField from '../../shared/ui/FormField.vue'
import { persistenceErrorMessage } from '../../shared/ui/persistence-error-message'

const props = defineProps<{ product: SupplierProduct; supplierName: string; materialName: string }>()
const emit = defineEmits<{ close: []; added: [panels: readonly StockItem[]] }>()
const repository = useStockRepository()
const quantity = ref<number | string>(1)
const quantityError = ref('')
const error = ref('')
const busy = ref(false)
async function submit(): Promise<void> {
  if (busy.value) return
  quantityError.value = '';
  error.value = ''
  const parsed = quantitySchema.safeParse(quantity.value)
  if (!parsed.success) {
    quantityError.value = 'Enter a positive whole number.';
    return
  }
  if (!repository) {
    error.value = 'Stock is unavailable. Reopen the application and try again.';
    return
  }
  busy.value = true
  try {
    const result = await repository.addFromProduct(props.product, parsed.data)
    if (!result.ok) {
      error.value = persistenceErrorMessage(result.error, 'Stock item');
      return
    }
    emit('added', result.value)
  } catch {
    error.value = 'Could not add panels to stock. Nothing was added. Try again.'
  }
  finally { busy.value = false }
}
</script>
<template>
  <AppDialog
    title="Add to stock"
    size="small"
    :busy="busy"
    @close="emit('close')"
  >
    <form
      id="add-product-stock"
      class="space-y-4"
      novalidate
      @submit.prevent="submit"
    >
      <div>
        <p class="font-semibold [overflow-wrap:anywhere]">
          {{ product.name }}
        </p>
        <p class="mt-1 text-sm text-muted">
          {{ supplierName }}
        </p>
      </div>
      <dl class="grid grid-cols-3 gap-x-3 gap-y-3 text-sm">
        <div class="col-span-3">
          <dt class="text-xs text-muted">
            Material
          </dt><dd>{{ materialName }}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted">
            Length
          </dt><dd class="tabular-nums">
            {{ product.lengthMm }} mm
          </dd>
        </div>
        <div>
          <dt class="text-xs text-muted">
            Width
          </dt><dd class="tabular-nums">
            {{ product.widthMm }} mm
          </dd>
        </div>
        <div>
          <dt class="text-xs text-muted">
            Thickness
          </dt><dd class="tabular-nums">
            {{ product.thicknessMm }} mm
          </dd>
        </div>
        <div
          v-if="product.grainDirection !== 'none'"
          class="col-span-3"
        >
          <dt class="text-xs text-muted">
            Grain direction
          </dt><dd>{{ product.grainDirection === 'length' ? 'Along length' : 'Along width' }}</dd>
        </div>
      </dl>
      <FormField
        id="add-stock-quantity"
        label="Quantity"
        :error="quantityError"
        required
      >
        <template #default="{ controlAttrs }">
          <input
            v-bind="controlAttrs"
            v-model.number="quantity"
            type="number"
            min="1"
            step="1"
            class="field"
            :disabled="busy"
          >
        </template>
      </FormField>
      <p
        v-if="error"
        role="alert"
        class="text-sm text-danger"
      >
        {{ error }}
      </p>
      <div class="dialog-actions">
        <AppButton
          :disabled="busy"
          @click="emit('close')"
        >
          Cancel
        </AppButton>
        <AppButton
          type="submit"
          variant="primary"
          :disabled="busy"
        >
          {{ busy ? 'Adding…' : 'Add to stock' }}
        </AppButton>
      </div>
    </form>
  </AppDialog>
</template>
