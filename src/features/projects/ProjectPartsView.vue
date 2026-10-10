<script setup lang="ts">
import { ref } from 'vue'
import PartsView from '../parts/PartsView.vue'
import LegacyPartsPanel from './LegacyPartsPanel.vue'
const version = ref(0)
</script>
<template>
  <div class="space-y-6">
    <PartsView :key="version" />
    <LegacyPartsPanel @adopted="version++" />
  </div>
</template>
