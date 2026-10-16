# OptiCutList — Agent Instructions

## Mission

Build OptiCutList, an open-source browser application for planning and optimizing rectangular panel cuts, primarily for woodworking. Target one first stable 1.0 release; do not invent intermediate public releases.

## Working Rules

- Read `AGENTS.md` and `ARCHITECTURE.md` before making changes.
- Inspect existing code and configuration before editing.
- Work only on the requested scope; stop after reporting results.
- Prefer existing tools and dependencies.
- Never install system software, browsers or browser binaries without the user's explicit approval.
- Never run Playwright browser installation commands without the user's explicit approval.
- Installing or updating npm dependencies required by an approved task is allowed; explain every new dependency in the final report. This does not authorize installing system software, browsers or browser binaries.
- If a task requires additional system software, stop and ask for permission before proceeding.
- Prefer simple, readable, maintainable code and strict TypeScript.
- Avoid `any`, unsafe casts, hidden global state, unnecessary dependencies and premature abstractions.
- No backend, authentication, cloud storage, monorepo or microservices unless explicitly approved.
- Do not perform destructive Git operations or commit credentials.
- Ask before changing fundamental architecture or domain invariants.

## Non-Negotiable Domain Rules

- Every `Part`, `SupplierProduct` and `StockItem` has mandatory `lengthMm`, `widthMm` and `thicknessMm` fields; all must be finite and strictly positive.
- Material compatibility and exact thickness equality are required for placement.
- Respect grain direction, permitted rotation, saw kerf, margins and quantities. When both part and source panel specify grain, alignment determines orientation regardless of the stored rotation preference; without grain on either side, preserve the existing rotation-policy rules.
- A collision-free layout is not necessarily guillotine-feasible. Independently validate executable plans and their cut trees.
- Supplier products and physically owned stock are distinct concepts.
- Current project cutting plans synchronize physical stock automatically through exact source StockItem IDs. Stock consumption, safe reversal and selected-offcut changes must be atomic and idempotent; catalogue sources are external panels, never owned inventory. Preserve immutable legacy confirmation history.
- Never silently accept invalid plans or silently discard imported data.

## Architecture Boundaries

- Domain: pure TypeScript; no Vue, Pinia, Konva, Dexie or pdf-lib dependencies.
- Application: use cases and ports that coordinate domain behavior.
- Infrastructure: adapters for persistence, import/export and PDF.
- Features: Vue UI; no optimization algorithms or direct IndexedDB access.
- Pinia manages UI state; IndexedDB is the persistent source of truth.
- Run optimization in a Web Worker.
- Enforce dependency direction and avoid circular imports.
- Create modules and directories when needed; avoid empty scaffolding.

## Testing and Quality

- Use ESLint, strict TypeScript, Vitest and Playwright where relevant.
- Test business invariants, invalid inputs, edge cases and regressions.
- Validate external data at runtime using Zod when implementing import/persistence boundaries.
- Do not disable checks to hide errors.
- Before completing a task, run lint, typecheck, relevant tests and production build. Report any checks that could not run.
- Commands: `npm run lint` (zero warnings allowed), `npm run typecheck`, `npm run test:unit`, `npm run build`.
- ESLint uses `typescript-eslint` `strictTypeChecked` and `eslint-plugin-vue` recommended rules; SFCs must use `<script setup lang="ts">`.
- TypeScript also enables `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and unused-symbol checks.
- Place unit tests in `__tests__/*.spec.ts` next to the code under test; import Vitest APIs explicitly (no globals).
- Domain models are Zod schemas with inferred types (`z.infer`); do not declare a parallel interface by hand. Use `z.strictObject` so unknown keys fail instead of being stripped.
- Use the branded ID types from `src/domain/model/ids.ts`; obtain IDs only by parsing through their schema.
- Zod is the only third-party runtime dependency allowed in `src/domain/`.
- Computed, non-persisted domain values (e.g. geometry `Rect`, fit results) may be plain TypeScript types.
- Geometry arithmetic and comparisons go through the micrometre helpers in `src/domain/geometry/units.ts`. Never add, subtract or compare raw millimeter floats, and never introduce ad-hoc epsilons.
- Geometry functions throw `RangeError` for out-of-range numeric input rather than clamping. Expected business outcomes (e.g. "does not fit") are returned as typed issues, never thrown.
- Validators of untrusted structures (e.g. cutting trees) convert numbers with `tryToMicrometres` and report every problem with its location. They must not throw on malformed contents.
- A cutting tree is executable only if `validateCuttingTree` returns `{ valid: true }`. Producers such as the optimizer or the editor must not bypass or duplicate this validator.
- In validator tests, write expected regions as literal coordinates rather than deriving them with the code under test.
- Optimizers must be deterministic: no `Math.random`, clocks or iteration over unordered inputs. Break ties explicitly (e.g. by input order).
- Optimizers return failures as typed `{ ok: false, error }` results and report unplaced parts explicitly; they never drop parts silently.
- Randomized tests use a seeded generator so failures are reproducible.
- New placement strategies are added to `PLACEMENT_STRATEGIES` in `plan-with-strategy.ts`. They reuse the shared splitting and validation, and must not change the selection ranking in `optimize-panel.ts` without updating `ARCHITECTURE.md`.
- Keep `largestAreaFirst` byte-for-byte stable; its exact-tree tests are the optimizer's regression baseline.
- The optimization worker is a thin adapter: never put optimization or validation logic in `src/workers/`. Delegate to the domain.
- Worker messages must be plain, structured-cloneable data defined in `optimization-protocol.ts`. Check incoming messages with its type guards rather than casting `MessageEvent.data`.
- UI code uses `createOptimizationService`, never a `Worker` directly. Inject a fake `OptimizationWorkerPort` in tests (jsdom has no workers).
- The service resolves typed outcomes instead of rejecting, and re-validates every received plan. Keep both properties when extending it.
- Project Optimization uses only scoped Parts and selected catalog supplier products or owned StockItems; reread inputs before running. Keep all requested copies explicit, including incompatible/unplaced demand. Expose one automatic Optimize workflow without a single/multi mode selector or a per-run panel picker. Respect project-specific available panel quantities; keep the single-panel engine internal and unchanged. Validate every tree plus global copy accounting and panel limits, never allocate empty panels, and never purchase or mutate stock inside the worker/placement engine. Current-result persistence performs the project’s automatic inventory reconciliation. Each view owns and disposes its service; invalidate pending reads/results on cancellation, input changes and project exit.
- The Optimization canvas always offers constrained editing of independently validated tree regions, without a mode toggle or free resizing. Editing uses pure, immutable operations and validates every candidate before accepting it; rejected edits leave the current plan unchanged. Rotation may recut only an anchored region containing the selected copy and waste; swaps preserve existing cut regions and require exact fits with permitted orientations. Keep geometry in pure TypeScript helpers with micrometre arithmetic, and Konva in presentation code. Dragging pans the viewport only. Never mutate the optimizer baseline or stock; keep undo/redo history transient and isolated per allocated panel in the current project result, preserve it across layout navigation, and reset it when inputs change. Destroy stages and detach observers/listeners on exit.
- Project Cutting Plans is a dedicated document step after Optimization, using the same validated, automatically persisted current result including accepted edits. The project Cutting Plans tab navigates without changing stock; wait for pending result writes and never expose an older result when replacement or editing persistence fails. Keep Optimization as a panel/part sidebar, interactive canvas and compact inline selection strip, without duplicated counts or accordion summaries. Cutting Plans automatically generates a validated A4/A3 vector PDF and renders its actual bytes through a local PDF.js worker. Preview/download never expose inventory finalization or write stock. Cancel obsolete page renders and destroy obsolete PDF documents/workers; preview and download share identical bytes. Keep the project Stock tab after Cutting Plans, separate from PDF preview/download. Automatic reconciliation and offcut selection belong to project application services; preserve legacy finalization records and services.
- Cutting-plan PDF export uses every currently displayed layout, including accepted edits, through the application service with a detached snapshot, independent tree validation and global copy accounting before generation. Reuse the shared scene/geometry and pdf-lib panel drawing inside one document with a project-name cover and compact fabrication schedules; never concatenate screenshots. Keep pdf-lib in infrastructure, geometry in millimeters, scale uniform and all thickness/grain/rotation/unplaced demand explicit. Paginate readable details, report unsupported text, and never mutate plans or stock. PDF previews use the same generated document, not a duplicated cutting viewer. Fabrication sheets use physical, conventional print scales with Actual size / 100% instructions, offset dimension lines and waste-only vector hatching. Preserve the centered project-name-only cover, complete parts/material references, hierarchical physical-panel inventory, individual part drawings and full validated cutting layouts; never invent purchasing data or a cutting sequence. Fabrication schedules use aligned vector tables with repeated headers and whole-row pagination above a shared fixed title block; keep human-readable references and currency-separated known totals, never database UUIDs or invented prices.
- Each project has at most one current cutting result, automatically persisted and restored through the application service. Persist all accepted panel edits together; atomically replace ordinary unconfirmed results without run history. Never expose Save/Open/Validate Plan actions or a Saved Plans list. Validate before encoding and after reconstruction; use the existing compact payloads, historical constraints and names, never canvas/PDF/image data or Undo/Redo history. Warn before discarding manual changes whose automatic persistence is pending or failed. Preserve every legacy record: adopt only a sole valid legacy plan, report multiple-plan ambiguity without selecting/deleting any, and retain confirmed origins for immutable inventory audit references. Cancellation/project changes must invalidate queued writes as well as worker responses.
- Project-generated cutting stock is ineligible as a panel source for its own originating project, identified only by cutting provenance projectId. Keep it visible globally and eligible for other projects. Preserve previously saved circular selections with an actionable warning/removal path, but reject new assignments and new optimizations using them.
- Project Stock derives offcuts only from independently validated waste leaves, excluding margins and kerf. Persist Keep decisions separately from physical StockItems; checkboxes synchronize automatically, without Save/Apply/Update, manual matching or confirmation UI. Consume exact stock sources when the current result is persisted/restored, and include the current project’s own allocated units in read-only planning availability so reruns cannot double-consume. Catalogue panels cause no deductions and their offcuts retain an explicit catalogue source ID. Match selections by source identity, panel copy and exact micrometre geometry, never by names/dimensions alone. Remove outdated or unchecked generated offcuts only when unchanged and unused; never recreate consumed offcuts. Safe source reversals and replacements record append-only movements in the same transaction. If stock or generated offcuts were consumed/modified elsewhere, preserve stock/history and persist a clear conflict. Preserve plans referenced by inventory audits and keep the legacy atomic confirmation service/receipts intact.
- Physical stock exchange uses `stock.oclstock.json` (`opticutlist-stock`, schemaVersion 1). Preserve stable stock IDs/provenance; validate strict StockItems and matching existing Material snapshots. Import only new independent manual/purchased stock after preview and explicit consent in one transaction; identical records are no-ops, conflicts and history-reserved missing IDs block the entire file. Never recreate absent cutting offcuts, remap inventory identities, overwrite/merge quantities or import/reset movement history. Existing cutting stock requires matching recorded origin/history. Stock files are not full application backups.
- Portable catalog transfers use `.cocl` UTF-8 JSON (`opticutlist-catalog`, schema version 1); projects download as normalized lowercase `<project_name>.oclproject.json` while accepting legacy `.pocl` and `.json` files; Parts JSON import accepts `.oclparts.json` and legacy `.json`; standalone Parts export is not supported. Share existing serialization, strict catalog schemas and identity remapping. Catalog imports require preview and explicit consent, recheck conflicts and references within one insert-only transaction, reuse only identical stable IDs/fields, and never overwrite records or transfer projects, physical stock or rendering data.
- Portable project JSON is a strict, versioned project-only boundary. Validate every entity, reference and saved cutting tree before import and after ID remapping. Require preview and explicit confirmation; insert all dependencies, owned Parts, project and saved plans atomically without overwriting existing records. Reuse catalog records only with identical stable identity and fields; remap conflicts consistently. Never transfer physical inventory, cutting movements, rendered data or transient editing history.
- Persistence code uses the application repository ports; Dexie stays in `src/infrastructure/`.
- Validate records on both database reads and writes with existing strict domain schemas. Never omit corrupt records from lists or upsert through `create`/`update`.
- Multi-record writes use the persistence transaction callback, only its scoped repositories, and await every operation. Any failed operation aborts all changes; do not await network requests or timers inside transactions.
- Database schema versions are immutable once shipped. Append versions and transactional migrations; never delete/recreate a database to recover from an upgrade failure. Use isolated fake-indexeddb factories for persistence tests.
- Vue features receive repositories through typed injection keys provided by the bootstrap; never create database connections in components.
- Shared presentation controls live in `src/shared/ui/`: use AppButton for standard actions (primary/secondary/ghost/destructive, default/small; icon-only controls require an accessible label), and AppDialog for native modal/drawer lifecycle and the shared close button. Keep control heights, focus/disabled states, palette and menu styling in semantic CSS tokens/classes. Form actions use `.dialog-actions` with Cancel before the primary action; retain specialized tile/canvas interactions rather than blindly wrapping every control.
- Use semantic theme tokens from `src/app/styles.css` for UI colors. Theme preferences may use localStorage; persistent business records remain exclusively in IndexedDB.
- Component tests inject repository ports; persistence integration tests use isolated fake-indexeddb factories. Confirm deletions and associate field validation errors with their inputs.
- Entity forms validate complete records with their existing domain schemas. Keep empty numeric inputs empty until validation; never substitute zero or omit mandatory thickness. Use the shared `FormField` for labels, required indicators and linked errors.
- Parts forms reuse the shared MaterialSelector and require an explicit selection from the active project’s saved material choices or eligible selected catalogue/stock panels’ materials. Never seed presets, create catalog records or change project selections from this form. Enforce material membership inside the scoped Part write transaction, not only in the picker; reject new/updated assignments to unselected materials. Preserve existing Parts when selections change and display compatibility warnings. Show missing material references and preserve failed drafts rather than silently replacing selections.
- Catalog presentation uses a selectable supplier list, material-grouped tables and contextual details; create/edit forms open only in accessible dialogs. Summary counts and read-only stock information must come from the existing StockItem repository and explicit purchase provenance, never guessed quantities or catalog availability. Keep catalog transfers in global Settings and inline material creation working; no inventory writes or project-selection actions belong in this screen.
- Supplier catalog UI uses the guarded application repositories from `createCatalogRepositories`. Product saves check supplier/material references in the same transaction as the write. Supplier, product and material deletion checks run atomically with deletion; never cascade or bypass a reference conflict.
- Supplier logos embed only a direct `/favicon.ico` URL derived from a validated http(s) website origin, without credentials in the URL or a referrer. Never scrape websites or use logo aggregation APIs; show the generic supplier icon until load succeeds and on failure. Material previews resolve only from the associated Material preset ID and reuse local assets, never product names or stored image binaries.
- Catalog products never create owned stock. Check existing stock purchase provenance before deleting a product, without implementing purchasing or stock consumption in catalog UI.
- Supplier product forms offer existing Material selection and inline creation with editable `Material.name` and `Material.category`, validated by `materialSchema` and saved through the existing repository. The optional local-library preset choice stores only `libraryPresetId`, never image binaries; custom materials have no image. Never seed catalog records from presets, and reuse preset-derived records only with matching stable preset identity and full name/category; never merge scratch materials by display name. Built-in presets are directly selectable even with an empty catalog. Resolve/create their Material and save the product atomically through `CatalogProductRepository.saveWithPreset`, never with sequential UI writes. Select the saved record and retain the entire product draft on success or failure.
- Materials is for selecting existing catalog materials and products within an open project, not global catalog creation/editing/deletion. Show only materials with catalog products or physical stock in the available library; retain source-less saved material selections explicitly in the summary. Persist material/product IDs and optional distinct stockItemIds on the project through the guarded project service; never modify catalog records when selections change. Keep unavailable or missing selections explicit, with removal by user action. Materials has no manual Refresh control: reread source snapshots on reactivation/window focus, guard overlapping reads and preserve pending/failed drafts. Materials selection changes autosave through serialized writes; retain newer drafts while a write is pending, await saves before tab/project navigation, and warn before discarding failed changes. Show saving/errors with Retry only when needed, without manual Save controls or permanent idle status.
- Sidebar Projects restores the last intentional Projects-section destination (overview or project workspace), remembered separately from the last opened project. All projects and direct overview navigation set that destination to the overview; workspace opening/tab changes set it to the project’s session-remembered tab by stable project ID. Recheck active-project existence before resuming and preserve cached completed editor/viewport state on global navigation. Do not rerun optimization on resume.
- Project tabs are ordered Materials / Parts / Optimization / Cutting Plans / Stock; enable Cutting Plans only for a valid current result. Creation and project-opening links without an explicit active tab default to Materials; preserve explicit Parts/Optimization routes.
- Project deletion atomically removes owned Parts, current/legacy cutting payloads and selection state. Default to Keep current stock; Restore initial stock must preflight and recheck complete identity-based reversibility, blocking consumed/modified/externally referenced offcuts or ambiguous history. Retain immutable receipts and a named deleted-project inventory audit, clear active offcut decisions, reserve archived project IDs and never reconcile deleted projects. Never silently perform partial restoration or delete shared catalog/other-project records.
- New Parts must be created through `createProjectService().parts(projectId)`, which atomically maintains `CuttingProject.partIds` ownership with the existing Part repository. Part CRUD must never expose another project’s records. Project updates cannot directly reassign Part IDs; use the scoped workflow. Keep the physical Part schema and placement algorithms unchanged.
- Materials selects allowed panel references but exposes no planning quantity controls. Optimization derives a finite catalog supply bound from total requested Part copies: no used panel may be empty, so one panel per copy is sufficient without limiting the existing strategy. Physical Stock sources keep their actual project planning availability, including this project's own allocated units for idempotent reruns; stock is never unlimited. Legacy panelQuantities remain readable/exportable but do not constrain new runs or get rewritten on open. Cutting settings contains only kerf and margin; Save settings persists optional project cuttingSettings without launching optimization, and the header Optimize rereads selected sources/settings. Inventory reconciliation remains in current-result persistence; material choices, optimization input preparation and PDF generation never write inventory.
- Version-1 Parts are preserved as unassigned legacy records. Do not automatically create owners, assign records on open, delete records or rewrite their IDs. Show legacy records only within an open project and require explicit review/confirmation for atomic adoption; reject already-owned records and roll back the full adoption on failure.
- The application shell has a persistent desktop sidebar with existing branding, Home/Projects/Catalog/Stock navigation and bottom Settings access; Settings contains the existing theme selector and global catalog/stock transfer workflows without changing routes; it collapses on tablet/mobile. Preserve the three Home tiles and existing project workflows. Stock navigation uses the guarded stock application repository for manual physical inventory CRUD and real cutting history. Keep provenance and immutable cutting receipts unchanged; compare draft snapshots in the write transaction to reject stale quantity edits/deletions. Show Parts, Materials and cutting-tool navigation only within a genuinely opened project; never expose independent global library links. Resolve the active project from a schema-validated route ID and IndexedDB, and clear workspace state when switching projects. Old global Parts/Materials URLs redirect to the project launcher. Preserve existing records.
- Available Home tiles use one native link across the entire surface, without nested actions. Unavailable tiles stay visibly disabled with keyboard-accessible explanations. Keep focus visible and apply lift/transition effects only when reduced motion is not requested.
- Home actions reuse existing workflows. If project creation/import is unavailable, show disabled actions with accessible explanations. Catalog remains accessible without a project, and existing deep links and records must remain usable.
- Create routers and stores through factories (e.g. `createAppRouter(history)`) so tests can use isolated instances and memory history.

## CI/CD

- GitHub Actions validates every push and pull request with `npm ci`, lint, typecheck, unit tests and build.
- On pushes to the default branch (currently `master`), deploy the validated build to GitHub Pages only after all checks succeed.
- Prefer maintained official GitHub Actions, least-privilege permissions and npm caching.
- Configure Vite's base path for the actual repository and Vue Router hash history for static hosting.
- Document required GitHub repository settings in `README.md`.
- Never deploy a failed build.

## Documentation Maintenance

`AGENTS.md` and `ARCHITECTURE.md` are living documents and must be maintained by the agent.

- Update `AGENTS.md` when coding conventions, agent instructions, development workflows or quality rules change.
- Update `ARCHITECTURE.md` when architecture, module responsibilities, domain models or technical decisions change.
- Make necessary documentation changes within the same task as the code changes; do not wait for a separate request.
- Keep documentation aligned with actual implementation and avoid redundant rewrites.
- Never silently remove or weaken existing requirements.
- Obtain approval before changing fundamental architecture or non-negotiable domain invariants.
- Mention documentation updates in the final task summary.

## Definition of Done

1. Implement only the requested scope.
2. Add or update relevant tests.
3. Run lint, typecheck, tests and build.
4. Update `AGENTS.md` and/or `ARCHITECTURE.md` if needed.
5. Summarize changes, checks, limitations and documentation updates.
6. Stop; do not begin the next task without approval.

## Git Commit Convention

Use Conventional Commits for all commits.

Format:
type(scope): short imperative description

Allowed types:
- feat: new functionality
- fix: bug fix
- refactor: internal restructuring without behavior changes
- perf: performance improvement
- test: tests only
- docs: documentation only
- style: formatting or visual-only changes
- build: build system or dependency changes
- ci: continuous integration and deployment
- chore: maintenance tasks

Rules:
- Use lowercase types and scopes.
- Write commit messages in English.
- Use the imperative mood.
- Do not end the subject with a period.
- Keep the subject concise, ideally under 72 characters.
- Each commit should represent one coherent change.
- Use a scope when it improves clarity.
- Use BREAKING CHANGE in the footer for incompatible changes.
- After completing each task, run all required checks.
- If all checks pass, create a local Conventional Commit only.
- Include relevant AGENTS.md and ARCHITECTURE.md updates in the same commit.
- Never commit when checks fail.
- Never run `git push`, including force-push, for any task. Completed work stays in local commits only.
- Never amend existing commits or rewrite Git history.
- Never include secrets, credentials or unrelated changes.
- Report the commit message and hash in the final summary.
