<script setup lang="ts">
defineProps<{ name: keyof typeof paths }>()
const paths = {
  supplier: 'M4 21V3h10v18M2 21h20M14 9h6v12M7 6h1M10 6h1M7 10h1M10 10h1M8 21v-6h3v6M17 12h1M17 16h1',
  layers: 'm3 7 9-5 9 5-9 5ZM3 12l9 5 9-5M3 17l9 5 9-5',
  products: 'm2 6 6-3 6 3-6 3ZM2 6v7l6 3V9M14 6v4M8 16v5l6-3M8 13l6-3 6 3-6 3ZM14 16v5l6-3v-5',
  stock: 'm3 7 9-5 9 5-9 5ZM3 7v10l9 5 9-5V7M12 12v10M7 5l10 5',
  edit: 'm4 16-1 5 5-1L21 7l-4-4ZM14 6l4 4',
  delete: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  close: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  search: 'M21 21l-6-6M17 9a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
  external: 'M14 3h7v7M21 3 11 13M10 5H4v15h15v-6',
  export: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  import: 'M12 15V3m-5 5 5-5 5 5M4 16v5h16v-5',
  chevron: 'm9 5 7 7-7 7',
  check: 'm5 12 4 4L19 6',
  info: 'M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
}
</script>
<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="app-icon shrink-0"
  >
    <path :d="paths[name]" />
  </svg>
</template>
