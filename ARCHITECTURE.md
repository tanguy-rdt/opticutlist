# OptiCutList — Architecture

## Product and Release Goal

OptiCutList is an open-source, browser-based application for optimizing rectangular panel cutting plans, primarily for woodworking. The goal is one first stable **1.0** release, developed through small, tested tasks without intermediate public release milestones.

The intended 1.0 workflow includes projects, parts, materials, suppliers, owned inventory, guillotine optimization, interactive plan editing, cost and waste comparison, shopping lists, vector PDF exports, offcuts, stock consumption and versioned JSON backup/restore.

## Architecture and Stack

A **modular monolith**: one repository, one Vue/Vite application, one `package.json`, static GitHub Pages hosting. No backend, user accounts, cloud synchronization, monorepo or microservices.

- Vue 3 SFC / Composition API, strict TypeScript, Vite
- Vue Router with hash history; Pinia for UI state; Tailwind CSS
- Konva.js for interactive 2D cutting editor
- Dexie.js / IndexedDB for local persistence
- Zod for runtime validation and versioned JSON
- pdf-lib for vector PDF exports
- Vitest, Playwright, ESLint and GitHub Actions

Install packages only when their functionality is needed.

### Current Tooling Decisions

- Node.js 24 (`.nvmrc`) in CI; Node.js 22+ supported locally.
- Tailwind CSS v4 via `@tailwindcss/vite`; styles entry is `src/app/styles.css`.
- TypeScript project references: `tsconfig.app.json` (browser code), `tsconfig.vitest.json` (tests), `tsconfig.node.json` (config files). `vue-tsc --build` type checks all of them.
- ESLint flat config (`eslint.config.ts`) composes `typescript-eslint` and `eslint-plugin-vue` directly. `env.d.ts` declares `*.vue` modules only as a fallback for ESLint's TypeScript service; `vue-tsc` resolves real SFC types.
- Vitest runs in jsdom and reuses `vite.config.ts`.
- Vite `base` is `/opticutlist/` for `https://<owner>.github.io/opticutlist/`.

Currently implemented: `src/main.ts` bootstraps the app; `src/app/` holds the shell (`App.vue`), router factory (`router/`), Pinia factory (`pinia.ts`) and placeholder views (`views/`). `src/domain/` holds the initial domain models, compatibility checks and panel geometry/cutting constraints (see below). No UI, persistence, placement heuristics or optimizer exist yet.

### Suggested Directory Layout

```text
src/
  app/                  # Bootstrap, router, UI stores
  features/             # Projects, parts, materials, suppliers, inventory,
                        # optimization, cutting-editor
  domain/               # Models, geometry, constraints, guillotine engine,
                        # independent plan validator
  application/          # Use cases and ports
  infrastructure/       # Dexie, JSON import/export, PDF adapters
  workers/              # Optimization Web Worker
  shared/ui/            # Reusable presentation components
```

Create folders incrementally, not as empty placeholders.

### Dependency Direction

- Domain is pure TypeScript and imports no UI or infrastructure libraries.
- Application depends on domain and declares ports.
- Infrastructure implements application ports and may use domain types.
- Features call application use cases; UI components do not access IndexedDB directly.
- Konva is presentation-only; optimization and validation do not depend on canvas.
- Pinia is not the database; IndexedDB is the persistent source of truth.

## Domain Model

All physical rectangular items have mandatory dimensions in millimeters:

```ts
interface Dimensions3D {
  lengthMm: number;
  widthMm: number;
  thicknessMm: number;
}
```

Each dimension is finite and strictly positive. Layout geometry is 2D, but **thickness is mandatory** throughout models, validation, persistence, import/export, PDF and tests.

- **Material:** explicit material type/specification used for compatibility checks.
- **Part:** stable ID, `Dimensions3D`, material ID, quantity, grain direction, allowed rotation.
- **Supplier:** store/supplier identity and optional website.
- **SupplierProduct:** supplier ID, material ID, `Dimensions3D`, price, currency, optional URL and availability metadata.
- **StockItem:** physically owned full panel or offcut, material ID, `Dimensions3D`, quantity, grain and provenance.
- **CuttingProject:** requested parts, optimization settings and allowed supplier product IDs.
- **CuttingPlan:** selected panels, individual placements, rotations, cut trees, offcuts, waste, cost and validation results.
- **StockMovement:** auditable physical inventory change.

Supplier products are purchasable catalog entries; stock items are actually owned. They must never be conflated.

### Implemented Domain Models

`src/domain/model/` defines each model as a Zod schema; the TypeScript type is inferred from it (`z.infer`), so validation and types cannot drift apart. Zod is the only runtime dependency allowed in the domain.

- **IDs** (`ids.ts`): stable, opaque strings (1–128 chars, no whitespace, e.g. UUIDs). Each entity has a branded type (`MaterialId`, `PartId`, `SupplierId`, `SupplierProductId`, `StockItemId`), so IDs cannot be mixed up or used unvalidated.
- **Dimensions3D** (`dimensions.ts`): `lengthMm`, `widthMm`, `thicknessMm`, each finite and strictly positive. Entities spread these as **flat, mandatory fields**. `widthMm` is not required to be the smaller side.
- **GrainDirection** (`orientation.ts`): `none | length | width`, relative to the item's own length/width axes.
- **RotationPolicy** (`orientation.ts`): `allowed | forbidden`, for 90° in-plane rotation of parts. Grain constraints still apply on top of this permission.
- **Material**: `id`, `name`, `category`. No thickness: thickness belongs to each physical item.
- **Part**: `id`, `name`, `materialId`, dimensions, `quantity` (positive safe integer), `grainDirection`, `rotation`.
- **Supplier**: `id`, `name`, optional http(s) `websiteUrl`.
- **SupplierProduct**: `id`, `supplierId`, `materialId`, `name`, dimensions, `grainDirection`, `price` (finite, ≥ 0, per panel), `currency` (ISO 4217 code), optional `productUrl`, `availability` (`available | unavailable | unknown`). It has no quantity or provenance.
- **StockItem**: `id`, `kind` (`fullPanel | offcut`), `materialId`, dimensions, `quantity`, `grainDirection`, `provenance` (`{ source: 'manual' }` or `{ source: 'purchase', supplierProductId }`). It has no price or supplier. Plan-produced offcut provenance will be added with cutting plans.

All object schemas are strict: unknown keys are rejected, never silently stripped. Names are trimmed and must be non-empty (≤ 200 chars).

`src/domain/compatibility.ts` provides reusable placement prerequisites for anything with `{ materialId, thicknessMm }`: `hasSameMaterial`, `hasSameThickness` (exact `===`, no tolerance), `getCompatibilityIssues` (lists every mismatch, for validator reporting) and `isCompatible`. Geometry, grain and rotation checks are out of scope there.

- **CuttingSettings** (`model/cutting-settings.ts`): `kerfMm` and `edgeMarginMm`, both finite and ≥ 0. A single uniform margin applies to all four panel edges.

### Implemented Geometry and Cutting Constraints

`src/domain/geometry/` is pure, deterministic TypeScript used by both the future optimizer and the independent validator. It has no knowledge of placement heuristics, plans, UI or persistence.

- **Resolution** (`units.ts`): millimeter values are rounded to integer micrometres (0.001 mm) before arithmetic, so sums, differences and comparisons are exact. For example, `100.1 − 3.2` gives exactly `96.9` instead of `96.89999999999999`. Values that are not finite, exceed the safe-integer range, or round to zero where a positive extent is required throw a `RangeError`; they are never silently clamped.
- **Coordinates** (`rect.ts`): `Rect` is `{ xMm, yMm, lengthMm, widthMm }` on a panel face; x runs along the panel length, y along its width. The panel thickness applies to every region on it.
- **Boundary rules:**
  - The usable area is the panel minus `edgeMarginMm` on each edge. It must be strictly positive on both axes, otherwise it is `null`. The margin includes the trim cut, so no kerf is added at panel edges.
  - Fit is inclusive: a size exactly equal to the area fits.
  - `splitRect` performs one guillotine cut at `offsetMm`, where 0 < offset < extent. `first` is `[start, offset)`, the kerf is `[offset, offset + kerf)` and `second` is the rest. `second` is `null` when the kerf consumes everything beyond the cut. Kerf only applies between pieces.
- **Orientation** (`part-orientation.ts`): `normal` puts the part length along the panel length; `rotated` turns the part 90°. Candidates are always ordered `normal`, then `rotated`. `rotation: 'forbidden'` allows only `normal`. Grain constrains orientation only when **both** the part and the panel have grain; the part grain must then run parallel to the panel grain. Rotated dimensions swap length and width and preserve thickness.
- **Part fit** (`part-fit.ts`): `checkPartFit(part, panel, settings)` checks one copy of a part on an empty supplier product or stock item. It returns the usable area and the fitting orientations, or every issue in a fixed order: `materialMismatch`, `thicknessMismatch`, `noUsableArea`, `grainRequiresRotation` (grain needs a forbidden rotation), `exceedsUsableArea` (lists the orientations tried).

Computed geometry values (`Rect`, `Orientation`, results) are plain TypeScript types. They become Zod schemas once they cross a persistence or import boundary.

## Guillotine Optimization

The initial stable release supports **guillotine cutting**, not unrestricted free-form nesting.

- Match material and thickness exactly.
- Respect quantities, grain, rotation restrictions, saw kerf, margins and panel bounds.
- Support multiple placement and split heuristics.
- Simple mode evaluates strategies automatically; advanced mode may expose controls.
- Evaluate waste, new purchase cost and a configurable compromise. Distinguish owned stock from cash purchases.
- Store actual guillotine cut trees and reusable offcut geometry.
- Run optimization in a Web Worker.

A **separate validator** checks quantities, placements, bounds, margins, kerf, material, thickness, grain, rotation, overlap and feasibility of the cut tree. A non-overlapping layout alone is not sufficient. Manually edited plans must be revalidated.

## Interactive Editor

Use Konva.js for zoom/pan, dragging, rotation, snapping, moving parts between panels, undo/redo, locks and eventually partial reoptimization. UI interactions must never silently turn an invalid plan into an executable one.

## Suppliers and Inventory

Supplier selection hierarchy:

```text
Supplier
  Material category
    Supplier product
```

Support tri-state selection at supplier/category/product levels. Keep the global catalog separate from per-project allowed product IDs. Start with manual catalog maintenance; live supplier APIs are deferred.

Physical stock consumption requires explicit confirmation and one atomic, idempotent transaction: verify quantities, decrement consumed stock, register confirmed reusable offcuts, record movement history and prevent double application.

## Persistence, Import/Export and PDF

Use Dexie/IndexedDB for projects, materials, suppliers, products, stock, movements and settings. JSON imports and exports include an explicit schema version, Zod validation and tested migrations. Provide complete backup/restore; never silently discard incompatible data. Remind users that browser storage can be cleared.

Use pdf-lib to generate vector PDFs from validated plan data, including dimensions (with thickness), identifiers, material, layouts, available cutting sequence and waste/cost summaries. Do not use canvas screenshots as the final PDF.

## CI/CD and Hosting

GitHub Actions must validate **every push and pull request** using `npm ci`, ESLint, TypeScript type checking, Vitest and production build. On pushes to the default branch (currently `master`), deploy to GitHub Pages **only after validation passes**; this is implemented in `.github/workflows/ci.yml` as a `deploy` job that `needs` the `validate` job. Use maintained official actions and least-privilege permissions. Configure the correct Vite base path for the actual GitHub repository and Vue Router hash history. Document required GitHub Pages settings in `README.md`.

## Implementation Order (Not Public Versions)

1. App shell, tooling, tests and CI/CD.
2. Domain models, invariants and runtime validation.
3. Local persistence, versioned JSON and first usable project/part/material workflow.
4. Suppliers, product catalog and owned inventory.
5. Guillotine optimizer, cut trees and independent validator.
6. Interactive editor, solution comparison and shopping lists.
7. Vector PDF, stock consumption, offcuts and history.
8. Backup/restore, performance, E2E tests and stabilization for 1.0.

## Deferred Scope

Backend, accounts, cloud sync, live supplier APIs, unrestricted nesting, 1D cutting, DXF export and generic plugin frameworks are outside the first stable release unless explicitly approved.

## Documentation Evolution

This file describes intended architecture and is maintained alongside implementation. Agents must update it when technical decisions or domain models change, without silently weakening non-negotiable invariants. Major architectural changes require approval.

## UI Design and Theming

OptiCutList must have a modern, clean and consistent interface.

- Support light and dark themes from the beginning.
- Default to the operating system's color scheme.
- Provide a theme selector: Light, Dark and System.
- Persist the user's theme preference locally.
- Use Tailwind CSS with reusable design tokens.
- Ensure accessible contrast, keyboard navigation and focus states.
- Build responsive layouts for desktop and tablet.
- Prefer restrained colors, clear typography and consistent spacing.
- Avoid hardcoded colors that only work in one theme.
- Keep the interface practical for data-heavy woodworking workflows.