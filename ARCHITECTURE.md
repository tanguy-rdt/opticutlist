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

Currently implemented: `src/main.ts` bootstraps the app; `src/app/` holds the shell (`App.vue`), router factory (`router/`), Pinia factory (`pinia.ts`) and Home, project-creation and not-found views (`views/`). `src/features/materials/`, `src/features/parts/` and `src/features/suppliers/` implement entity-management pages. `src/domain/` holds the initial domain models, compatibility checks, panel geometry/cutting constraints, the guillotine cutting tree with its independent validator, a single-panel optimizer comparing several deterministic strategies, and Web Worker execution through an application service (see below). Local persistence for the five initial entities and CuttingProject is implemented through application repository ports and a Dexie adapter. Projects own Parts and persist their catalog selections. Materials has a project-scoped existing-catalog selection interface; new materials are created inline in supplier product forms. Parts, suppliers and supplier products have CRUD interfaces; theme selection is available. Inventory and optimization interfaces, multi-panel and cost optimization are not implemented.

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

- **IDs** (`ids.ts`): stable, opaque strings (1–128 chars, no whitespace, e.g. UUIDs). Each entity has a branded type (`MaterialId`, `PartId`, `SupplierId`, `SupplierProductId`, `StockItemId`, `CuttingProjectId`), so IDs cannot be mixed up or used unvalidated.
- **Dimensions3D** (`dimensions.ts`): `lengthMm`, `widthMm`, `thicknessMm`, each finite and strictly positive. Entities spread these as **flat, mandatory fields**. `widthMm` is not required to be the smaller side.
- **GrainDirection** (`orientation.ts`): `none | length | width`, relative to the item's own length/width axes.
- **RotationPolicy** (`orientation.ts`): `allowed | forbidden`, for 90° in-plane rotation of parts. Grain constraints still apply on top of this permission.
- **Material**: `id`, `name`, `category`. No thickness: thickness belongs to each physical item.
- **CuttingProject** (`cutting-project.ts`): stable branded `id`, `name`, `partIds`, `materialIds` and `supplierProductIds`. All three ID lists reject duplicates. Part ownership belongs to this record, keeping the existing physical Part schema and optimizer inputs unchanged; settings and plans are deferred.
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

`tryToMicrometres` is the non-throwing variant of the conversion. Validators use it so malformed numbers in untrusted structures become reported issues.

### Implemented Cutting Tree and Validator

`src/domain/cutting-tree/` models and validates the guillotine cutting tree of **one panel**. It does not know how the tree was produced (optimizer, manual edit or import).

- **Model** (`cutting-tree.ts`): `CuttingTreeNode = CutNode | PartLeaf | WasteLeaf`. Every node stores its `region` (`Rect`) explicitly.
  - A `CutNode` has one `GuillotineCut` (`axis: length | width`, `offsetMm`) and exactly two children, `first` and `second`, separated by the kerf. Axis `length` is a cut line across the panel length (x); `width` is a cut line across the width (y).
  - A `PartLeaf` places one copy of a part: `partId`, `copyIndex` (0 ≤ index < quantity) and `orientation`.
  - A `WasteLeaf` is an area with no part. Reusable offcut flags are deferred.
  - A `TreePath` (`first`/`second` steps from the root) locates a node.
- **Validator** (`validate-cutting-tree.ts`): `validateCuttingTree(root, { panel, parts, settings })` returns `{ valid: true }` or every issue with its path, in depth-first order. It recomputes each expected region from the usable area and the cuts (via `splitRect`) and compares declared regions exactly at micrometre resolution. Rules:
  - **Margins:** the root region equals the usable area exactly (`noUsableArea`, `regionOutOfBounds`, `missingRegion`).
  - **Region dimensions:** finite coordinates ≥ 0 and extents ≥ 0.001 mm (`invalidRegion`).
  - **Cut position:** 0 < offset < extent (`cutOutOfBounds`, `invalidCutOffset` for non-finite values). The cut must leave a strictly positive second region after the kerf (`cutLeavesNoRemainder`).
  - **Child regions:** each child equals its derived slot. Reaching outside the parent is `regionOutOfBounds`, reaching into the kerf or the sibling is `regionOverlap`, and an uncovered part of the slot is `missingRegion`.
  - **Part leaves:** the part must be known (`unknownPart`), with a copy index in range (`invalidCopyIndex`), placed at most once per tree (`duplicatePlacement`). Material and thickness must match exactly (`materialMismatch`, `thicknessMismatch`). Grain and rotation must permit the orientation (`orientationNotAllowed`). The region must equal the oriented part size exactly (`partSizeMismatch`); extra space must be cut off into waste.
  - **Structure:** a node object referenced twice (DAG or cycle) is `reusedNode` and is not revisited.

Exact region equality makes the leaves tile the usable area minus kerfs, so no global overlap pass is needed. Tree contents are untrusted and never throw; `context` must hold schema-validated values (duplicate part IDs throw). Quantity completeness across several panels belongs to the future plan-level validator.

### Implemented Single-Panel Optimizer

`src/domain/optimizer/` optimizes **one panel** with a few deterministic guillotine strategies and selects the best validated plan. It is pure TypeScript: no worker, UI or persistence. The application service executes it through the Web Worker described below.

- **Entry point** (`optimize-panel.ts`): `optimizePanel({ panel, parts, settings })` runs every strategy and returns `{ ok: true, strategy, plan, comparison }`. It takes a supplier product or stock item, schema-validated parts with unique IDs (duplicates throw) and `CuttingSettings`.
  - Otherwise it returns `{ ok: false, error }` with `noUsableArea`, or `noValidCandidate` when every candidate was rejected (the comparison is included).
- **Single strategy** (`plan-with-strategy.ts`): `planWithStrategy(input, strategy)` builds and validates one candidate.
- **Pre-check:** each part goes through `checkPartFit` against the empty panel. That covers material, exact thickness, margins, grain, rotation and size. Each orientation must also be producible by a cut, i.e. size = extent or size + kerf < extent.
  - Parts that fail are reported as `cannotFitPanel` (with the fit issues), or as `remainderNarrowerThanKerf` when the only leftover strip would be ≤ kerf.
- **Quantities:** copies are expanded lazily per part and taken in increasing `copyIndex` order, keeping the original `partId`. Very large quantities therefore cost nothing up front.
- **Strategies** (`PLACEMENT_STRATEGIES`, listed in tie-break priority order). Stable sorting keeps input order among equal parts. Orientations are always tried `normal` before `rotated`.
  1. `largestAreaFirst` (baseline, unchanged): region-driven. Free regions are filled depth-first, the strip beside a part before the larger remainder. Each region takes the first part that can be cut from it, with parts ordered by area descending, then longest side descending.
  2. `longestSideFirst`: the same region-driven fill, with parts ordered by longest side descending, then area descending.
  3. `bestShortSideFit`: part-driven. Each copy, in `largestAreaFirst` order, goes to the free region and orientation with the smallest short-side leftover. Ties go to the smaller long-side leftover, then the oldest region, then `normal`. Copies that fit no region are left unplaced.
- **Splitting** is shared by all strategies. The part goes to the region's start corner and is freed with up to two guillotine cuts. The cut order keeps the largest leftover rectangle; ties cut along the length first. Regions that take no part become waste leaves.
- **Validation:** every candidate tree is checked by `validateCuttingTree`. A rejected candidate becomes `{ status: 'rejected', error: { kind: 'invalidTree' } }` in the comparison and is never selected or returned as a plan.
- **Selection:** candidates are ranked best first, comparing integer µ-units:
  1. fewer unplaced copies
  2. more used area (less waste on the same panel)
  3. larger single waste region (a more reusable offcut)
  4. `PLACEMENT_STRATEGIES` order
- **Comparison:** one `StrategyCandidate` per strategy, in strategy order. Valid candidates carry `CandidateMetrics`: the area metrics plus `placedCount`, `unplacedCount` and `largestWasteRegionMm2`.
- **Plan:** `PanelCuttingPlan` contains:
  - `tree`.
  - `placements`, read from the validated tree, with region, orientation and oriented `Dimensions3D` including thickness.
  - `unplaced`, as ranges `{ partId, firstCopyIndex, count, reason }`. The reason `noSpaceLeft` covers parts that would fit an empty panel but found no region.
  - `metrics`.
- **Metrics** (`computeAreaMetrics`): areas are computed in integer µm² and reported in mm². They are relative to the whole panel, so waste includes margins, kerf and waste leaves. `utilizationPercent = used / panel × 100`.

Because a cut must leave a strictly positive second region, a part that would leave a sliver narrower than or equal to the kerf is not placed. This follows the current cut-tree rule.

### Implemented Optimization Worker

Optimization runs off the main thread. The domain optimizer stays pure; the worker only adapts messages.

- **Protocol** (`src/application/optimization/optimization-protocol.ts`): plain, structured-cloneable messages.
  - Request: `OptimizeRequest { type: 'optimize', requestId, input }`.
  - Responses: `{ type: 'result', requestId, selection }` when the optimizer ran (`selection` may be a domain failure such as `noUsableArea`), or `{ type: 'error', requestId | null, error }` with `optimizerError` (the optimizer threw) or `invalidRequest`.
  - Boundary type guards (`isOptimizeRequest`, `isOptimizationResponse`) replace unsafe casts. Requests check the required panel/part fields with the existing domain schemas and validate settings before optimization; catalog and stock metadata remain intact. Responses check result envelopes and tree structure before geometric validation, so missing nodes and unknown node kinds become structured failures.
- **Worker** (`src/workers/optimization/`):
  - `optimization.worker.ts` is the entry point.
  - `handleOptimizationRequest` delegates to `optimizePanel` and turns exceptions into error responses; it never throws.
  - `createOptimizationWorker()` uses Vite's native `new Worker(new URL('./optimization.worker.ts', import.meta.url), { type: 'module' })`. `vite.config.ts` sets `worker.format: 'es'`, and the chunk respects the GitHub Pages base path.
- **Application service** (`src/application/optimization/optimization-service.ts`): `createOptimizationService(createWorker)` depends only on the minimal `OptimizationWorkerPort` (a real `Worker` satisfies it; tests inject a fake).
  - `optimize(input)` assigns a unique, increasing `requestId` and resolves (never rejects for expected outcomes) to `completed`, `cancelled` (`cancelled | superseded | disposed`) or `failed` (`optimizerError | invalidRequest | workerError | invalidResponse | invalidPlan`).
  - At most one request is in flight. A new request supersedes the previous one. Cancellation, supersession, worker crashes, unreadable messages and disposal **terminate** the worker, because a running computation cannot be interrupted. The worker is recreated lazily for the next request; an idle worker is reused.
  - Stale results are never applied: responses whose `requestId` is not in flight, and messages or errors from a replaced worker, are ignored. Handlers are detached on termination.
  - The service snapshots input before posting it and validates against that snapshot, so caller mutations cannot change the in-flight validation context. Every received plan is re-validated with `validateCuttingTree` on the main thread before it is reported as `completed`. Malformed responses or validation exceptions fail the request and release the worker instead of leaving a pending promise. A plan that fails becomes `failed` with `invalidPlan`, so invalid plans never cross into the UI.

Dependency direction: `workers → application → domain`. The UI will use the service; it must not talk to the worker directly.

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

### Implemented Supplier Catalog

- `/catalog` (with `/suppliers` retained as an alias) manages suppliers and purchasable panel products with the existing `supplierSchema` and `supplierProductSchema`. Products are grouped by supplier, then material category. Forms require all three dimensions, nonnegative finite price and schema-valid currency; they preserve grain, availability and optional http(s) URLs. There is no quantity, stock creation or purchasing workflow. Project selection is managed separately in the project workspace.
- The product Material field supports choosing an existing Material or creating one inline. Inline creation asks only for name and category, parses the existing `materialSchema` with a generated stable ID, and calls the already-injected material repository. The saved record is added to the catalog snapshot and selected automatically without resetting any product fields. Validation/storage errors retain both drafts; pending writes block duplicate submission. This explicit material write does not create a product or stock record. No new model, service or database schema is needed for inline creation.
- `src/application/catalog/catalog-repositories.ts` wraps existing repository ports rather than introducing domain models or another store. `createCatalogRepositories(persistence)` returns guarded materials, suppliers and supplier-products repositories. Product create/update validates the existing schema and verifies both referenced records using transaction-scoped repositories before writing. The transaction serializes reference checks against guarded deletion across connections.
- Supplier deletion is blocked while catalog products reference it. Product deletion is blocked when existing stock purchase provenance references it. Material deletion is blocked when parts, products or stock reference it. These checks and deletion share one transaction; read failures abort the operation. Conflicts return typed `referenceConflict` errors with actionable messages; no cascades or silent removals occur. The composition root provides these guarded ports to Suppliers, Materials and Parts. Raw Dexie repositories remain generic schema-validating persistence adapters; application guards own the relational policy.
- Existing dangling references are displayed as missing rather than dropping products. Forms require replacement selections. Loading, empty, validation and persistence failures are explicit, failed writes preserve drafts, and committed writes reread IndexedDB. Native confirmation and focus restoration support keyboard use; tables scroll inside their panels on smaller screens.
- Tests cover supplier/product CRUD, required dimensions, prices, currencies, URLs and references, reference-conflict deletion, concurrent create/delete serialization, failure feedback and persistence across connections/remounts. Catalog operations never write stock records. Physical inventory interfaces remain deferred; tri-state project product selection is implemented in the project Materials view.

Physical stock consumption requires explicit confirmation and one atomic, idempotent transaction: verify quantities, decrement consumed stock, register confirmed reusable offcuts, record movement history and prevent double application.

## Persistence, Import/Export and PDF

Use Dexie/IndexedDB for projects, materials, suppliers, products, stock, movements and settings. JSON imports and exports include an explicit schema version, Zod validation and tested migrations. Provide complete backup/restore; never silently discard incompatible data. Remind users that browser storage can be cleared.

### Implemented Local Persistence

- `src/application/persistence/repositories.ts` defines a minimal generic `Repository<Entity>`, the six named repositories (including projects) and `LocalPersistence`. `create`, `get`, full-record `update`, `delete` and deterministic ID-ordered `list` return typed `PersistenceResult` values. Errors distinguish `invalidRecord` (with field paths), `duplicateId`, `notFound`, `storageFailure` and application-level `referenceConflict`.
- `src/infrastructure/persistence/local-database.ts` implements these ports with Dexie. `createLocalPersistence()` creates an independent connection to `opticutlist`; tests inject a fresh fake-indexeddb factory. `open()` reports storage failures and `close()` releases the connection; explicitly reopening preserves records. There is no singleton, entity cache or persistent Pinia data.
- Immutable database **version 1** has `materials`, `parts`, `suppliers`, `supplierProducts` and `stockItems`, each keyed by the existing stable `id`. Production **version 2** adds only the `projects` store, keyed by `id`; the additive upgrade preserves all five original stores and their records without transformation. Products and physically owned stock remain separate stores. IDs are supplied by callers and validated with their existing branded schemas.
- Reads and writes validate full records with the existing strict Zod schemas. Corrupt reads fail explicitly without skipping or deleting data. `create` uses insert-only `add`; full replacements require an existing record and an unchanged ID. Existence checks and writes/deletions share a transaction, preventing accidental upserts and races. These entity repositories do not introduce foreign-key cascades or alter placement compatibility rules.
- `transaction(callback)` spans all six stores and provides scoped repositories. Every failed operation, failed callback result or exception rolls back the entire transaction, even if the callback ignores an operation's error. Scoped repositories expire when the callback ends. Only await repository operations inside it; network calls and timers can cause IndexedDB to commit prematurely. Completion is reported only after commit.
- Migration strategy: keep version 1 immutable and append higher Dexie versions. Additive stores/indexes preserve records automatically; future record transformations must run in a transactional `upgrade` callback, validate transformed records and throw on failure. Never clear, delete or recreate the database as recovery. Databases newer than this application are rejected explicitly to prevent writes with an outdated schema. Tests exercise the production version-1 → version-2 upgrade, retaining every legacy entity unchanged (including invalid records, which still fail validation on read). Future version-3 index and failing-migration fixtures verify preservation, rollback and newer-version rejection.

### Implemented Project Workspaces

- `src/application/projects/project-service.ts` reuses generic record repositories and the existing transaction boundary. Project create/update validates `cuttingProjectSchema` and selected catalog references, including each product’s supplier/material and availability. Existing unavailable selections are retained explicitly; newly selecting unavailable products is rejected. Generic project updates cannot alter part ownership; deletion is blocked while a project owns parts.
- `parts(projectId)` implements the existing Part repository port for the active project. Every operation requires an existing project, checks ownership and rejects conflicting stored ownership. Creates insert the original Part and attach its stable ID to exactly one project atomically; deletions remove both the Part and its owner reference atomically. Reads list only owned Parts and fail on dangling references, instead of dropping records. Material references are checked in the write transaction. The original dimensions, quantity, grain and rotation schemas and the existing Parts CRUD/form interface remain unchanged. Part requirements may reference existing catalog materials; project catalog choices describe available inputs separately.
- Version-1 Parts have no owner and remain stored byte-for-byte after the additive upgrade. `listLegacyParts()` inspects existing project ownership and exposes only unassigned Parts for explicit review inside an open project. The legacy panel requires selection and native confirmation before `adoptLegacyParts(projectId, ids)` checks every record/reference and attaches the original IDs in one transaction. A missing/already-owned part aborts the entire adoption, including concurrent adoption from another connection. Opening or creating a project never silently assigns legacy data. Global Materials/products remain unchanged; the former transient material checkboxes had no persisted selections to migrate.
- Guarded Catalog deletions also check project selections atomically. Selected materials/products cannot be deleted until their project choices are explicitly removed; catalog edits retain stable IDs and leave selections independent. Preexisting dangling choices remain visible in Materials with an explicit removal action; storage errors never trigger automatic cleanup. Supplier products continue to represent purchasable catalog entries, never owned stock.

Inventory consumption, cutting plans, JSON import/export and PDFs remain outside this persistence implementation.

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

### Implemented Interface and Theme

- The shell header contains only the home-linked application logo and theme selector, with a hash-safe skip link and storage reminder. There is no global navigation menu or sidebar. `/` retains the responsive New Project / Import Project / Catalogue tile layout and decorative local SVG woodworking imagery using semantic theme tokens. The entire Catalogue tile is a native router link to `/catalog`, with just imagery, title and a short description; nested action buttons and decorative badges are removed. Hover and focus add a subtle shadow, with lift and transitions enabled only for `prefers-reduced-motion: no-preference`. Existing focus outlines remain visible.
- New Project is a full-surface link to `/projects`, where the existing availability view now creates a schema-validated named project via the application service and opens its Parts workspace. `ProjectList.vue`, reused on Home and the launcher, reads saved projects from IndexedDB for reopening. Import remains a disabled, focusable tile with an associated explanation; JSON import is not implemented. The three-tile layout, imagery, clean header and reduced-motion behavior are retained. Catalogue remains accessible without a project.
- `/projects/:projectId/parts` and `/projects/:projectId/materials` are nested under `ProjectWorkspace.vue`. The workspace parses the branded route ID, reads the project, shows opening/error/retry states, provides a scoped Part repository and renders Parts/Materials navigation only after a real project opens. Back to Home closes the workspace without deleting data. The root routed view is keyed by project ID so switching projects resets drafts and injected scope. Hash URLs reopen the same project after refresh without a Pinia/localStorage business-data cache. Old `/parts` and `/materials` URLs redirect to the project launcher instead of exposing a global library.
- `src/main.ts` is the composition root: it creates one local persistence connection, guarded catalog repositories and the project service, provides ports through typed injection keys and closes the connection on unmount. The global raw Part repository is not provided to routed UI; only the workspace supplies its scoped adapter. No Vue component imports Dexie or creates a database.
- `MaterialsView.vue` retains its existing catalog-material table and selected summary. It loads the active project's material/product ID lists from IndexedDB; choosing checkboxes edits a draft, and Save project selections validates and persists it through the project service. Failed saves retain the draft. Catalog products are grouped Supplier → Material Category → Product with native checkbox `indeterminate` state and `aria-checked="mixed"` on partial groups. Unavailable or broken product references are displayed and cannot be newly selected; existing selections can be removed explicitly. Loading, empty, read/write-error and missing-reference states are explicit. There are no catalog creation controls and no catalog writes; materials are still created inline in Catalogue product forms.
- `PartsView.vue` coordinates repository reads/writes and confirmation; `PartForm.vue` manages drafts and validates full records with `partSchema`. All three dimensions are required in millimeters, quantity is a positive safe integer, and grain/rotation options come from the existing schemas. Empty numeric fields remain missing during validation. New IDs are schema-parsed UUIDs and edits retain IDs. Material selection is explicit; no materials disables saving and links to the supplier catalog, unavailable references remain visible, and a repository read checks the selected material again before writing. This UI check does not add foreign-key guarantees or cascades to persistence. Failed writes retain drafts; committed writes reread IndexedDB. The full-width table shows every constraint and supports keyboard-accessible horizontal scrolling on tablets, with a responsive form below it.
- `SupplierForm.vue` and `ProductForm.vue` manage catalog drafts and validate the existing schemas; `SuppliersView.vue` coordinates interaction through injected repositories and groups catalog snapshots for presentation. These snapshots and drafts are transient UI state only.
- `src/shared/ui/FormField.vue` shares labels, required indicators, descriptions and linked errors across entity forms. The adjacent persistence-error helper translates typed repository failures, including reference conflicts, into user feedback without exposing storage implementation details.
- `ThemeSelector.vue` defaults to System, resolves the OS preference with `matchMedia`, responds to system changes, and detaches its listener on unmount. The only localStorage entry is the validated UI preference `opticutlist.theme` (`light`, `dark`, `system`). Storage failures do not prevent theme changes. No business data is persisted in Pinia or localStorage.
- `src/app/styles.css` maps reusable semantic colors to Tailwind v4 tokens for both themes, including text, surfaces, actions, errors, input borders and focus outlines. Desktop places the selected-material summary beside the library; tablet stacks the two. Labels, linked field errors, live feedback, native confirmation and focus restoration support keyboard and assistive-technology use.
- Project tests cover named creation, opening, URL refresh, project navigation, cross-project Part and catalog-selection isolation, tri-state groups, failed drafts, confirmation before legacy adoption, concurrent ownership checks, invalid references, catalog independence and atomic write rollback. Persistence tests cover project CRUD and the additive legacy-preserving upgrade. Shell tests retain full-tile activation, disabled import, clean navigation and Catalogue/Back to Home coverage. Component tests inject repository ports and check theme persistence/system changes, material selection, inline material validation/creation, supplier/product and Parts CRUD, confirmation, retry and error states. Parts tests also cover mandatory dimensions, quantity, material selection, missing references, grain/rotation and pending-write protection. Isolated fake-indexeddb integration tests verify persistence across connections and page remounts.
