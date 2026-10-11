<script setup lang="ts">
import type { Material } from '../../domain/model/material'
import type { Supplier } from '../../domain/model/supplier'
import type { SupplierProduct } from '../../domain/model/supplier-product'
import type { StockItem } from '../../domain/model/stock-item'
defineProps<{ product: SupplierProduct | undefined; materials: readonly Material[]; suppliers: readonly Supplier[]; stock: readonly StockItem[]; stockAvailable: boolean; stockError: string; disabled: boolean }>()
const emit = defineEmits<{ edit: [product: SupplierProduct]; delete: [product: SupplierProduct] }>()
function grain(product: SupplierProduct): string { return product.grainDirection === 'none' ? 'None' : product.grainDirection === 'length' ? 'Along length' : 'Along width' }
function availability(product: SupplierProduct): string { return product.availability === 'available' ? 'Available' : product.availability === 'unavailable' ? 'Unavailable' : 'Unknown' }
</script>
<template>
  <aside
    id="product-details"
    class="panel min-w-0 space-y-4 p-4 md:col-start-2 xl:sticky xl:top-5 xl:col-start-3 xl:row-start-1"
    aria-labelledby="product-details-title"
  >
    <div class="flex items-start justify-between gap-2">
      <h2
        id="product-details-title"
        tabindex="-1"
        class="font-semibold"
      >
        Product details
      </h2>
    </div>
    <template v-if="product">
      <div>
        <p class="eyebrow">
          {{ materials.find(item => item.id === product?.materialId)?.category ?? 'Missing material' }}
        </p><h3 class="mt-2 text-lg font-semibold [overflow-wrap:anywhere]">
          {{ product.name }}
        </h3>
      </div>
      <dl class="space-y-3 border-y border-line py-4 text-sm">
        <div>
          <dt class="text-muted">
            Material
          </dt><dd class="font-medium">
            {{ materials.find(item => item.id === product?.materialId)?.name ?? 'Missing material' }}
          </dd>
        </div>
        <div>
          <dt class="text-muted">
            Dimensions (length × width × thickness)
          </dt><dd class="font-medium">
            {{ product.lengthMm }} × {{ product.widthMm }} × {{ product.thicknessMm }} mm
          </dd>
        </div>
        <div>
          <dt class="text-muted">
            Grain direction
          </dt><dd>{{ grain(product) }}</dd>
        </div>
        <div>
          <dt class="text-muted">
            Price per panel
          </dt><dd class="text-lg font-semibold text-accent">
            {{ product.price }} {{ product.currency }}
          </dd>
        </div>
        <div>
          <dt class="text-muted">
            Supplier availability
          </dt><dd>{{ availability(product) }}</dd>
        </div>
        <div>
          <dt class="text-muted">
            Supplier
          </dt><dd>{{ suppliers.find(item => item.id === product?.supplierId)?.name ?? 'Missing supplier' }}</dd>
        </div>
      </dl>
      <a
        v-if="product.productUrl"
        :href="product.productUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="block text-sm text-accent underline"
      >Product page<span class="sr-only"> (opens in new tab)</span></a>
      <section
        class="space-y-2 border-t border-line pt-4"
        aria-label="Owned inventory"
      >
        <h3 class="text-sm font-semibold">
          Owned inventory
        </h3>
        <p class="text-xs text-muted">
          Purchase-linked stock only. Catalog references are not owned panels.
        </p>
        <p
          v-if="!stockAvailable"
          class="text-sm text-muted"
        >
          Inventory information is not available.
        </p>
        <p
          v-else-if="stockError"
          role="alert"
          class="text-sm text-danger"
        >
          {{ stockError }}
        </p>
        <p
          v-else-if="!stock.length"
          class="text-sm text-muted"
        >
          No owned stock linked to this product.
        </p>
        <ul
          v-else
          class="space-y-2 text-sm"
        >
          <li
            v-for="item in stock"
            :key="item.id"
          >
            {{ item.quantity }} {{ item.kind === 'offcut' ? 'offcut(s)' : 'panel(s)' }} · {{ item.lengthMm }} × {{ item.widthMm }} × {{ item.thicknessMm }} mm · Grain {{ item.grainDirection }}
          </li>
        </ul>
      </section>
      <div class="flex flex-wrap gap-2 border-t border-line pt-4">
        <button
          type="button"
          class="button button-compact"
          :disabled="disabled"
          :aria-label="`Edit product ${product.name}`"
          @click="emit('edit', product)"
        >
          Edit product
        </button>
        <button
          type="button"
          class="button button-compact button-danger"
          :disabled="disabled"
          :aria-label="`Delete product ${product.name}`"
          @click="emit('delete', product)"
        >
          Delete product
        </button>
      </div>
    </template>
    <p
      v-else
      class="py-3 text-sm text-muted"
    >
      No visible products to display.
    </p>
  </aside>
</template>
