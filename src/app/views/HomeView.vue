<script setup lang="ts">
import { RouterLink } from 'vue-router'
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
      <article
        class="home-card relative flex flex-col items-start gap-4 overflow-hidden p-6 md:p-8"
        aria-labelledby="new-project-title"
        aria-describedby="new-project-unavailable"
        role="button"
        aria-disabled="true"
        tabindex="0"
      >
        <svg
          class="pointer-events-none absolute -right-8 -top-8 h-48 w-48 text-accent opacity-[0.08]"
          viewBox="0 0 160 160"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M25 25h110v110H25z M25 85h110 M85 25v60 M55 85v50" />
          <path d="M15 25v110 M10 25h10 M10 135h10 M25 145h110 M25 140v10 M135 140v10" />
        </svg>
        <span class="home-icon">
          <svg
            viewBox="0 0 24 24"
            class="h-6 w-6"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            aria-hidden="true"
            focusable="false"
          ><path d="M4 4h10v10H4z M17 4h3v10h-3 M4 17h16v3H4z M9 7v4 M7 9h4" /></svg>
        </span>
        <div class="relative space-y-2">
          <h2
            id="new-project-title"
            class="text-2xl font-semibold tracking-tight"
          >
            New Project
          </h2>
          <p class="max-w-sm leading-relaxed text-muted">
            Give your next idea a place to grow, from the first dimensions to the final cut.
          </p>
        </div>
        <div class="mt-auto space-y-2 pt-2">
          <p
            id="new-project-unavailable"
            class="text-sm text-muted"
          >
            Project creation is not available yet.
          </p>
        </div>
      </article>

      <article
        class="home-card flex flex-col items-start gap-4 p-6 md:col-start-1 md:row-start-2 md:p-8"
        aria-labelledby="import-project-title"
        aria-describedby="import-project-unavailable"
        role="button"
        aria-disabled="true"
        tabindex="0"
      >
        <span class="home-icon">
          <svg
            viewBox="0 0 24 24"
            class="h-6 w-6"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            aria-hidden="true"
            focusable="false"
          ><path d="M12 3v12 M8 11l4 4 4-4 M4 15v5h16v-5" /></svg>
        </span>
        <div class="space-y-2">
          <h2
            id="import-project-title"
            class="text-2xl font-semibold tracking-tight"
          >
            Import Project
          </h2>
          <p class="max-w-sm leading-relaxed text-muted">
            Pick up where you left off with a project from a previous workshop session.
          </p>
        </div>
        <div class="mt-auto space-y-2 pt-2">
          <p
            id="import-project-unavailable"
            class="text-sm text-muted"
          >
            Project import is not available yet.
          </p>
        </div>
      </article>

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

    <div class="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-sm text-muted">
      <p>Made for the workshop. Stored on your device.</p>
    </div>
  </section>
</template>
