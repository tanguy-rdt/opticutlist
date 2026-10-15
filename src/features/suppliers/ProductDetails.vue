<script setup lang="ts">
import AppButton from '../../shared/ui/AppButton.vue'
import { computed } from 'vue'
import type { Material } from '../../domain/model/material'
import type { Supplier } from '../../domain/model/supplier'
import type { SupplierProduct } from '../../domain/model/supplier-product'
import type { StockItem } from '../../domain/model/stock-item'
import PanelDimensionPreview from '../../shared/ui/PanelDimensionPreview.vue'
import AppIcon from '../../shared/ui/AppIcon.vue'
const props = defineProps<{ product: SupplierProduct | undefined; materials: readonly Material[]; suppliers: readonly Supplier[]; stock: readonly StockItem[]; stockAvailable: boolean; stockError: string; disabled: boolean }>()
const emit = defineEmits<{ edit: [product: SupplierProduct]; delete: [product: SupplierProduct] }>()
const material = computed(() => props.materials.find(item => item.id === props.product?.materialId))
const materialName = computed(() => material.value?.name ?? 'Missing material')
const ownedQuantity = computed(() => props.stock.reduce((quantity, item) => quantity + item.quantity, 0))
function grain(product: SupplierProduct): string { return product.grainDirection === 'none' ? 'None' : product.grainDirection === 'length' ? 'Along length' : 'Along width' }
function availability(product: SupplierProduct): string { return product.availability === 'available' ? 'Available' : product.availability === 'unavailable' ? 'Unavailable' : 'Unknown' }
</script>
<template>
  <aside
    id="product-details"
    class="panel catalog-details min-w-0 p-5 md:col-start-2 xl:sticky xl:top-5 xl:col-start-3 xl:row-start-1"
    aria-labelledby="product-details-title"
  >
    <h2
      id="product-details-title"
      tabindex="-1"
      class="sr-only"
    >
      Product details
    </h2>
    <template v-if="product">
      <PanelDimensionPreview
        class="mb-4"
        :length-mm="product.lengthMm"
        :width-mm="product.widthMm"
        :grain-direction="product.grainDirection"
        size="small"
        label="Catalog panel preview"
      />
      <header class="catalog-product-header">
        <h3 class="text-lg font-semibold leading-snug [overflow-wrap:anywhere]">
          {{ product.name }}
        </h3>
        <p class="mt-1 text-sm text-muted">
          {{ materialName }}
        </p>
      </header>
      <dl
        class="catalog-product-overview mt-4 space-y-3 rounded-lg bg-quiet-surface p-3 text-sm"
        aria-label="Panel dimensions and price"
      >
        <div>
          <dt class="text-xs text-muted">
            Dimensions
          </dt>
          <dd class="mt-1 font-semibold tabular-nums">
            {{ product.lengthMm }} × {{ product.widthMm }} × {{ product.thicknessMm }} mm
          </dd>
        </div>
        <div class="flex items-baseline justify-between gap-3">
          <dt class="text-muted">
            Price per panel
          </dt>
          <dd class="text-lg font-semibold tabular-nums text-accent">
            {{ product.price }} <span class="text-sm">{{ product.currency }}</span>
          </dd>
        </div>
      </dl>
      <section
        aria-label="Product specifications"
        class="mt-5"
      >
        <h3 class="mb-3 font-semibold">
          Specifications
        </h3>
        <dl class="catalog-specifications text-sm">
          <div><dt>Supplier</dt><dd>{{ suppliers.find(item => item.id === product?.supplierId)?.name ?? 'Missing supplier' }}</dd></div>
          <div><dt>Thickness</dt><dd>{{ product.thicknessMm }} mm</dd></div>
          <div><dt>Grain direction</dt><dd>{{ grain(product) }}</dd></div>
          <div>
            <dt>Availability</dt><dd>
              <span
                class="inline-flex rounded-md px-2 py-1 text-xs font-medium"
                :class="product.availability === 'available' ? 'bg-success-surface text-success' : 'bg-quiet-surface text-muted'"
              >{{ availability(product) }}</span>
            </dd>
          </div>
          <div v-if="product.productUrl">
            <dt>Product URL</dt>
            <dd>
              <a
                :href="product.productUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-start gap-1 text-accent hover:underline [overflow-wrap:anywhere]"
              >
                <AppIcon name="external" /><span>{{ product.productUrl }}</span><span class="sr-only"> (opens in new tab)</span>
              </a>
            </dd>
          </div>
        </dl>
      </section>
      <section
        class="mt-5 border-t border-line pt-5"
        aria-label="Owned inventory"
      >
        <h3 class="mb-3 font-semibold">
          Stock information
        </h3>
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
        <template v-else>
          <p class="text-base font-semibold tabular-nums">
            {{ ownedQuantity }} owned units
          </p>
          <p class="mt-1 text-xs text-muted">
            Purchase-linked inventory
          </p>
          <p
            v-if="!stock.length"
            class="sr-only"
          >
            No owned stock linked to this product.
          </p>
          <ul
            v-else
            class="mt-3 space-y-2 text-sm text-muted"
          >
            <li
              v-for="item in stock"
              :key="item.id"
            >
              {{ item.quantity }} {{ item.kind === 'offcut' ? 'offcut(s)' : 'panel(s)' }} · {{ item.lengthMm }} × {{ item.widthMm }} × {{ item.thicknessMm }} mm · Grain {{ item.grainDirection }}
            </li>
          </ul>
        </template>
        <p class="mt-3 text-xs leading-relaxed text-muted">
          Actual owned stock only. Catalog references are not owned panels.
        </p>
      </section>
      <section
        class="mt-5 border-t border-line pt-5"
        aria-label="Product actions"
      >
        <h3 class="sr-only">
          Actions
        </h3>
        <div class="grid gap-2">
          <AppButton
            type="button"
            class="button w-full"
            :disabled="disabled"
            :aria-label="`Edit product ${product.name}`"
            @click="emit('edit', product)"
          >
            <AppIcon name="edit" />Edit product
          </AppButton>
          <AppButton
            type="button"
            class="button button-danger w-full"
            :disabled="disabled"
            :aria-label="`Delete product ${product.name}`"
            @click="emit('delete', product)"
          >
            <AppIcon name="delete" />Delete product
          </AppButton>
        </div>
      </section>
    </template>
    <p
      v-else
      class="py-5 text-sm text-muted"
    >
      No visible products to display.
    </p>
  </aside>
</template>
