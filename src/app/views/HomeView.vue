<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import ProjectCreationDialog from '../../features/projects/ProjectCreationDialog.vue'
import ProjectStartTiles from '../../features/projects/ProjectStartTiles.vue'
const route = useRoute()
const router = useRouter()
const creating = computed(() => route.query.create === '1')
async function closeCreation(): Promise<void> {
  const query = { ...route.query }
  delete query.create
  await router.replace({ name: 'home', query, hash: route.hash })
}
</script>

<template>
  <section class="space-y-8 md:space-y-10">
    <div class="max-w-3xl space-y-4">
      <p class="eyebrow text-accent">
        From board to build
      </p>
      <h1 class="text-4xl font-semibold tracking-tight md:text-5xl">
        Your next build starts here.
      </h1>
      <p class="max-w-2xl text-lg leading-relaxed text-muted">
        A little planning. A lot of possibility. Keep your panel catalogue ready for whatever takes shape in your workshop.
      </p>
    </div>

    <div class="grid gap-5 md:grid-cols-2 md:grid-rows-2 lg:gap-6">
      <ProjectStartTiles />

      <RouterLink
        to="/catalog"
        class="home-card relative flex flex-col overflow-hidden md:col-start-2 md:row-span-2 md:row-start-1"
        aria-labelledby="catalog-title"
      >
        <div class="relative flex min-h-56 flex-1 items-center justify-center overflow-hidden bg-subtle p-6 md:min-h-72">
          <div class="pointer-events-none absolute inset-0 bg-linear-to-t from-surface/40 to-transparent" />
          <svg
            class="relative h-auto w-full max-w-md text-accent"
            viewBox="0 0 480 310"
            fill="none"
            aria-hidden="true"
            focusable="false"
          >
            <!-- Locally drawn panels, wood grain and a carpenter's square. -->
            <ellipse
              cx="244"
              cy="254"
              rx="176"
              ry="22"
              fill="currentColor"
              opacity="0.08"
            />
            <g
              stroke="currentColor"
              stroke-width="2"
              stroke-linejoin="round"
            >
              <path
                d="m66 203 216-78 132 55-217 81z"
                fill="var(--surface)"
              />
              <path
                d="m66 203 131 58 217-81v14l-217 81-131-58z"
                fill="var(--subtle)"
              />
              <path
                d="m66 171 216-78 132 55-217 81z"
                fill="var(--surface)"
              />
              <path
                d="m66 171 131 58 217-81v14l-217 81-131-58z"
                fill="var(--subtle)"
              />
              <path
                d="m66 139 216-78 132 55-217 81z"
                fill="var(--surface)"
              />
              <path
                d="m66 139 131 58 217-81v14l-217 81-131-58z"
                fill="var(--subtle)"
              />
              <g opacity="0.4">
                <path d="m87 139 185-66 M109 148c44-8 75-36 115-40s39-8 65-26 M129 157c40-7 52-22 88-28s60-26 89-39 M151 166l174-64 M175 177c24-7 36-21 61-22s71-23 112-43 M201 184l174-64" />
                <path d="M189 143c8-9 28-16 35-12s-11 13-21 15-17 0-14-3z" />
              </g>
              <path
                d="m125 69 90-33 49 20-20 8-28-11-70 25 23 10-20 8z"
                fill="var(--subtle)"
              />
              <path d="m155 66 4 5 M169 61l4 5 M183 56l4 5 M197 51l4 5" />
              <path
                d="m328 211 66-24 10 4-66 25z"
                fill="var(--surface)"
              />
              <path d="m328 211-14 10 24-5 M314 221l6-7" />
            </g>
            <g
              stroke="currentColor"
              opacity="0.3"
            ><path d="M43 102h16 M51 94v16 M412 70h16 M420 62v16 M279 274h12 M285 268v12" /></g>
          </svg>
        </div>
        <div class="relative flex flex-col items-start gap-4 p-6 md:p-8">
          <h2
            id="catalog-title"
            class="text-3xl font-semibold tracking-tight"
          >
            Catalogue
          </h2>
          <p class="max-w-md leading-relaxed text-muted">
            Suppliers, materials and purchasable panels, organized for your next build.
          </p>
        </div>
      </RouterLink>
    </div>

    <ProjectCreationDialog
      v-if="creating"
      @close="closeCreation"
    />

    <div class="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-sm text-muted">
      <p>Made for the workshop. Stored on your device.</p>
    </div>
  </section>
</template>
