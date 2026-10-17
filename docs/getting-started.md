# Getting started

[Documentation home](README.md) / Start here

Read [AGENTS.md](../AGENTS.md) and [ARCHITECTURE.md](../ARCHITECTURE.md) before editing. The application is a browser-only Vue/TypeScript modular monolith, targeting a first stable 1.0 release. There is no backend, account service or cloud database to start.

**On this page:** [Environment](#environment) · [Commands](#commands) · [Repository map](#repository-map) · [Contribution workflow](#contribution-workflow)

## Environment

Use Node.js 24 from [.nvmrc](../.nvmrc); [package.json](../package.json) permits Node 22 or newer. The root [README](../README.md) recommends npm 11+. Use the committed [package-lock.json](../package-lock.json) for reproducible dependencies. IndexedDB and Web Workers are browser requirements; PDF preview additionally uses a locally bundled PDF.js worker.

```sh
nvm use
npm ci
npm run dev
```

Open the URL printed by Vite. The configured application base is `/opticutlist/`, including development/preview asset URLs. Vue Router uses hash history so static hosting can serve deep links without server rewrites. Data belongs to the browser origin: switching development port/origin or browser profile changes which IndexedDB data is visible.

Do not install system software, browsers or browser binaries without explicit permission. No special external services or credentials are required for local development.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite development server |
| `npm run lint` | ESLint with zero warnings allowed |
| `npm run typecheck` | `vue-tsc --build --force` across project references |
| `npm run test:unit` | Full Vitest run, including persistence and component tests |
| `npm test` | Vitest watch mode |
| `npm run build` | Production output in `dist/` |
| `npm run preview` | Serve the built application locally |

For one regression suite:

```sh
npm run test:unit -- src/application/inventory/__tests__/project-stock-service.spec.ts
```

Run all four validation commands before committing; see [testing](testing.md). A build alone does not replace TypeScript checking or tests.

## Repository map

| Directory/file | Responsibility |
| --- | --- |
| [src/app/main.ts](../src/app/main.ts) | Composition root: factories, dependency injection and app mount |
| [src/app](../src/app/) | Entry point, router, configuration and dependency composition |
| [src/domain](../src/domain/) | Pure validated models, geometry, cutting trees and optimization |
| [src/application](../src/application/) | Use cases, repository/worker/PDF ports and business coordination |
| [src/infrastructure](../src/infrastructure/) | Dexie, JSON adapter and pdf-lib rendering |
| [src/ui](../src/ui/) | Project and global Vue workflows; presentation adapters |
| [src/ui/components/common](../src/ui/components/common/) | Shared controls and technical previews |
| [src/infrastructure/optimization](../src/infrastructure/optimization/) | Thin optimization worker adapters |
| [public/materials](../public/materials/) | Local material preview assets and manifest |
| [docs](./) | Developer and portable-format references |

New tests live beside their implementation under `__tests__/*.spec.ts`. Existing UI and worker tests retain their historical locations after this structural move; their module/mock paths follow the new layers.

## Contribution workflow

1. Trace the feature from Vue injection key to application service, domain rules and persistence adapter. Identify the owning layer before editing.
2. Inspect existing tests and neighboring shared controls. Preserve IDs, audit snapshots, compatibility fields and typed failure handling.
3. Make the smallest scoped change and add meaningful regression coverage. Do not put persistence in a component or algorithms in a worker.
4. Update documentation when contracts or responsibilities change. Database versions are append-only; never repair a migration by deleting a database.
5. Run lint, typecheck, tests and build. Inspect `git diff` for unrelated changes and secrets.
6. Create a local Conventional Commit. Follow the repository's no-push and history rules in AGENTS.md.

Use schema-inferred types, branded IDs and complete-record validation. Empty numeric form fields stay empty until validation; do not substitute zero for missing physical dimensions or prices.

## Build and hosting

[Vite configuration](../vite.config.ts) sets the Pages base and emits module workers as ES chunks. [CI](../.github/workflows/ci.yml) currently runs Node setup, `npm ci`, lint, typecheck, tests and build. CI validates master pushes and PRs targeting master without publishing. [CD](../.github/workflows/cd.yml) deploys Pages only after revalidating a stable version tag reachable from master; Wiki publication is independent. See [CI/CD and releases](ci-cd.md). Repository Pages settings and deployed runtime behavior were not verified in this audit. See the [discrepancy register](architecture.md#guidance-and-implementation-discrepancies).

Local business data is not a backup. Before testing destructive workflows against useful data, use the supported transfers and understand their [backup limitations](persistence-and-json.md#backup-boundaries).

---

**Continue exploring:** [Explore the application](features.md) · [Understand the architecture](architecture.md) · [Documentation home](README.md)

## Optional self-hosted development

The default commands above remain browser-only. With Node.js 24+, `npm run build:self-hosted` builds the matching frontend/service and `npm run start:self-hosted` runs both at `http://127.0.0.1:3000/opticutlist/`. See [Self-hosting](storage.md#self-hosted-storage) for the persistent database path, configuration, API and trusted-environment security limits.
