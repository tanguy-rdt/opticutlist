<script setup lang="ts">
import { computed } from 'vue'
import type { Material } from '../../domain/model/material'
import type { Supplier } from '../../domain/model/supplier'
import type { SupplierProduct } from '../../domain/model/supplier-product'
import type { StockItem } from '../../domain/model/stock-item'
import MaterialThumbnail from '../materials/MaterialThumbnail.vue'
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
    class="panel catalog-details min-w-0 p-4 md:col-start-2 xl:sticky xl:top-5 xl:col-start-3 xl:row-start-1"
    aria-labelledby="product-details-title"
  >
    <h2
      id="product-details-title"
      tabindex="-1"
      class="border-b border-line pb-3 font-semibold"
    >
      Product details
    </h2>
    <template v-if="product">
      <header class="catalog-product-header my-3 rounded-lg bg-quiet-surface px-4 py-2">
        <h3 class="text-base font-semibold [overflow-wrap:anywhere]">
          {{ product.name }}
        </h3>
        <p class="mt-1 text-xs text-muted">
          {{ materialName }}
        </p>
        <span class="mt-2 inline-flex rounded-md border border-selection-line bg-icon-surface px-2.5 py-0.5 text-xs font-medium text-accent">Supplier product</span>
      </header>
      <figure
        class="my-4"
        aria-label="Material preview"
      >
        <MaterialThumbnail
          :preset-id="material?.libraryPresetId"
          variant="preview"
        />
        <figcaption class="mt-2 text-xs text-muted">
          {{ materialName }} · Material preview
        </figcaption>
      </figure>
      <section
        aria-label="Product specifications"
        class="mt-4"
      >
        <h3 class="mb-3 font-semibold">
          Specifications
        </h3>
        <dl class="catalog-specifications text-xs">
          <div><dt>Supplier</dt><dd>{{ suppliers.find(item => item.id === product?.supplierId)?.name ?? 'Missing supplier' }}</dd></div>
          <div><dt>Material</dt><dd>{{ materialName }}</dd></div>
          <div><dt>Dimensions</dt><dd>{{ product.lengthMm }} × {{ product.widthMm }} mm</dd></div>
          <div><dt>Thickness</dt><dd>{{ product.thicknessMm }} mm</dd></div>
          <div><dt>Price per panel</dt><dd>{{ product.price }} {{ product.currency }}</dd></div>
          <div><dt>Grain direction</dt><dd>{{ grain(product) }}</dd></div>
          <div>
            <dt>Availability</dt><dd>
              <span
                class="catalog-badge py-1"
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
        class="mt-4"
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
          <div class="flex items-center gap-3">
            <span class="catalog-icon"><AppIcon name="stock" /></span>
            <div>
              <p class="text-sm font-semibold">
                {{ ownedQuantity }} owned units
              </p><p class="mt-1 text-xs text-muted">
                Purchase-linked inventory
              </p>
            </div>
          </div>
          <p
            v-if="!stock.length"
            class="sr-only"
          >
            No owned stock linked to this product.
          </p>
          <ul
            v-else
            class="mt-3 space-y-2 text-xs text-muted"
          >
            <li
              v-for="item in stock"
              :key="item.id"
            >
              {{ item.quantity }} {{ item.kind === 'offcut' ? 'offcut(s)' : 'panel(s)' }} · {{ item.lengthMm }} × {{ item.widthMm }} × {{ item.thicknessMm }} mm · Grain {{ item.grainDirection }}
            </li>
          </ul>
        </template>
        <p class="mt-3 flex items-start gap-2 rounded-md border border-selection-line bg-icon-surface p-2.5 text-xs leading-snug text-accent">
          <AppIcon name="info" /><span>Actual owned stock only. Catalog references are not owned panels.</span>
        </p>
      </section>
      <section
        class="mt-4 border-t border-line pt-4"
        aria-label="Product actions"
      >
        <h3 class="mb-3 font-semibold">
          Actions
        </h3>
        <div class="grid gap-2">
          <button
            type="button"
            class="button catalog-action w-full"
            :disabled="disabled"
            :aria-label="`Edit product ${product.name}`"
            @click="emit('edit', product)"
          >
            <AppIcon name="edit" />Edit product
          </button>
          <button
            type="button"
            class="button catalog-action button-danger w-full border-danger"
            :disabled="disabled"
            :aria-label="`Delete product ${product.name}`"
            @click="emit('delete', product)"
          >
            <AppIcon name="delete" />Delete product
          </button>
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
