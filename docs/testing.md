# Testing and validation

The required checks are defined in [AGENTS.md](../AGENTS.md) and [package.json](../package.json):

```sh
npm run lint
npm run typecheck
npm run test:unit
npm run build
```

Run these before committing. Never weaken checks or install browsers/system software to make an unsupported environment appear green.

## Tooling and organization

[vitest.config.ts](../vitest.config.ts) merges Vite configuration, runs tests in jsdom and excludes `e2e/**`. Test files live beside code under `__tests__/*.spec.ts` and explicitly import Vitest APIs. Vue tests use Vue Test Utils; persistence tests use fake-indexeddb; PDF tests use pdf-lib and structural/drawing-call assertions.

[eslint.config.ts](../eslint.config.ts) uses `strictTypeChecked`, Vue recommended rules, type-only imports and script-setup TypeScript SFCs. TypeScript references [app](../tsconfig.app.json), [tests](../tsconfig.vitest.json) and [config](../tsconfig.node.json) projects; strict settings include unchecked-index, exact-optional-property and unused-symbol checks. There is no configured Playwright dependency/browser suite despite its mention in architecture guidance. Do not interpret jsdom passing as a browser visual test.

Focused run/watch examples:

```sh
npm run test:unit -- src/domain/optimizer/__tests__/optimize-project.spec.ts
npm run test:unit -- src/infrastructure/pdf/__tests__/technical-title-block.spec.ts
npm test -- src/features/materials/__tests__/MaterialsView.spec.ts
```

## Test boundaries

| Area | Representative suites | What they establish |
| --- | --- | --- |
| Schemas and compatibility | [domain/model tests](../src/domain/model/__tests__/), [compatibility.spec.ts](../src/domain/__tests__/compatibility.spec.ts) | Runtime contracts, exact identities/thickness, optional/legacy fields |
| Geometry and trees | [geometry tests](../src/domain/geometry/__tests__/), [validate-cutting-tree.spec.ts](../src/domain/cutting-tree/__tests__/validate-cutting-tree.spec.ts) | Integer geometry, malformed input, guillotine executability |
| Optimization | [optimizer tests](../src/domain/optimizer/__tests__/) | Deterministic candidate ranking, constraints, copy accounting, Stock preference |
| Worker boundary | [optimization-service.spec.ts](../src/application/optimization/__tests__/optimization-service.spec.ts), [worker tests](../src/workers/optimization/__tests__/) | Protocol guards, cancellation, invalid responses and revalidation |
| Persistence | [local-database.spec.ts](../src/infrastructure/persistence/__tests__/local-database.spec.ts) | Strict reads/writes, reopen, migrations, transaction rollback |
| Projects/transfers | [application/projects tests](../src/application/projects/__tests__/) | Ownership, adoption, deletion, atomic import and ID remapping |
| Inventory | [application/inventory tests](../src/application/inventory/__tests__/) | Provenance, exact source limits, reconciliation/idempotency/conflicts |
| UI | Feature `__tests__` directories and [shared UI tests](../src/shared/ui/__tests__/) | Scoped workflows, focus/menu/notification states and event isolation |
| PDF | [PDF suites](../src/infrastructure/pdf/__tests__/), [export service tests](../src/application/export/__tests__/) | Validated snapshots, layout, pricing, pagination, bytes and errors |

## Domain invariant tests

Construct entities through their schemas/fixture helpers and parse branded IDs rather than casting arbitrary strings. Assert typed failure kinds and located issues. Include malformed/nonfinite/out-of-range dimensions, unsupported geometry resolution, exact thickness differences, constrained grain orientations and duplicate copy IDs.

For validator tests, write expected coordinates literally; deriving expected child regions with the same splitting helper can hide a shared bug. Preserve exact-tree baseline tests for `largestAreaFirst`. Randomized cases must use a seeded generator so failures reproduce. Do not assert only “no rectangle overlap” when a valid guillotine cut tree is required.

Test `getAllowedOrientations` consistently across fit/optimization/tree validation/manual editing, including old records with constrained grain and an opposing stored rotation flag.

## Persistence and import integration tests

Use a new `IDBFactory` from fake-indexeddb with isolated persistence instances, as in [local-database.spec.ts](../src/infrastructure/persistence/__tests__/local-database.spec.ts). Close connections after tests. Test create duplicate versus update missing behavior, changed IDs, corrupt stored records, reopened data and transaction repositories used after callback completion.

Inject a late failure after earlier writes and verify all involved stores, not only the returned error. The adapter deliberately tracks ignored failed operations; retain that regression. Upgrade tests seed older versions and verify preserved record bytes/ownership/history. A migration-failure test must assert the old database remains usable rather than recreating it.

For imports, cover invalid JSON/envelopes, unsupported versions, missing/duplicate references, preview without consent, conflicts occurring after preview, ID remapping and rollback. Project import must preserve internal relationships after remapping. Stock import must **not** remap or recreate a consumed physical identity. Parts import must remain compatible with existing files despite removal of export. Use [parts-transfer-service.spec.ts](../src/application/projects/__tests__/parts-transfer-service.spec.ts), [project-transfer-service.spec.ts](../src/application/projects/__tests__/project-transfer-service.spec.ts), [catalog-transfer-service.spec.ts](../src/application/catalog/__tests__/catalog-transfer-service.spec.ts) and [stock-transfer-service.spec.ts](../src/application/inventory/__tests__/stock-transfer-service.spec.ts).

## Optimization and inventory regression matrix

Test the pure optimizer first, then the saved-setting/application path. Inject a fake `OptimizationWorkerPort`; jsdom cannot run the real Worker. Assert request IDs, supersession, cancellation/disposal and independent rejection of malformed worker plans.

Cover suitable Stock versus Catalog, preference false, offcuts, insufficient inventory, mixed sources, exact source identities and unplaced copies. The 800 × 400 Catalog / two 800 × 600 Stock / two 200 × 400 Part regression should select one StockItem when preference is enabled. Assert the other physical identity remains unused. Do not claim global optimality from a single heuristic fixture.

[project-stock-service.spec.ts](../src/application/inventory/__tests__/project-stock-service.spec.ts) and [current-result-service.spec.ts](../src/application/plans/__tests__/current-result-service.spec.ts) cover atomic current-result replacement, source consumption, safe reversal, generated offcut geometry changes, failure rollback and repeated synchronization. Verify both inventory **and movement count** on repeat runs. Include another project's consumed/modified offcut and current-project circular provenance. Test reload through persisted services, not only the original in-memory result.

[MaterialsView.spec.ts](../src/features/materials/__tests__/MaterialsView.spec.ts) covers project-aware selection, bulk/group synchronization and UI state. A stale selected Stock ID cannot authorize another project's allocation. [project-deletion.spec.ts](../src/application/projects/__tests__/project-deletion.spec.ts) covers Keep versus all-or-nothing Restore and retained audits.

## Component, async and resource tests

Inject repository/application ports with the production injection keys; avoid real database creation inside component tests. Create a fresh router/Pinia through factories to avoid hidden shared state. Await Vue/Promise updates explicitly; control delayed responses to test route switches and newer drafts arriving during writes.

Use fake timers for toast progress/dismissal and restore them after tests. Assert no success notification on failed persistence. Test accessible labels, `aria-current`, tri-state properties, dialog busy dismissal/focus restoration and menu Escape/outside/keyboard handling. Row Edit/Delete/drag/checkbox clicks must remain isolated from row navigation/selection.

[ProjectStockView.spec.ts](../src/features/projects/__tests__/ProjectStockView.spec.ts) and [StockPanelPreview.spec.ts](../src/features/projects/__tests__/StockPanelPreview.spec.ts) verify stable temporary labels, independent inspection/Keep behavior, panel collapses and automatic fit. Canvas fakes verify interaction and render configuration, not actual GPU/browser pixels.

## PDF and browser boundaries

[technical-title-block.spec.ts](../src/infrastructure/pdf/__tests__/technical-title-block.spec.ts), [part-drawings.spec.ts](../src/infrastructure/pdf/__tests__/part-drawings.spec.ts), [panel-drawing.spec.ts](../src/infrastructure/pdf/__tests__/panel-drawing.spec.ts), [pdf-table.spec.ts](../src/infrastructure/pdf/__tests__/pdf-table.spec.ts) and [cover-page.spec.ts](../src/infrastructure/pdf/__tests__/cover-page.spec.ts) cover shared geometry, page-specific context, vector dimensions, measured overflow, grids, cover fields and both orientations.

[project-pdf-pricing.spec.ts](../src/application/export/__tests__/project-pdf-pricing.spec.ts) checks exact-reference pricing without guesses. [CuttingPlansWorkspace.spec.ts](../src/features/optimization/__tests__/CuttingPlansWorkspace.spec.ts), [pdf-preview.spec.ts](../src/features/optimization/__tests__/pdf-preview.spec.ts) and [pdf-print-view.spec.ts](../src/features/optimization/__tests__/pdf-print-view.spec.ts) cover current-byte generation, loading/errors, cancellation, popup blocking and URL ownership/cleanup.

**Recommended manual QA when available:** inspect real generated Portrait/Landscape pages, long names, tiny/wide drawings and multi-page schedules; exercise native modal focus, responsive panels, PDF viewers and Actual size printing. Browser/OS print differences, storage eviction and deployed repository settings are not established by the current automated suites. Installing a browser requires separate approval.

## Documentation checks

For documentation-only changes, verify every relative Markdown target, source symbol and cross-document claim. Review all major directories rather than relying on old feature summaries. Keep a discrepancy register and list unverified external/runtime behavior. Source paths in these guides are relative to `docs/`; do not paste developer-machine absolute file URLs.

Recommendations above are future/manual practices, not claims that additional tools or suites already exist.

## Fixtures and execution environments

The default is jsdom, but persistence/application suites can explicitly opt into Node using `// @vitest-environment node`; [project-service.spec.ts](../src/application/projects/__tests__/project-service.spec.ts) is an example. Do not infer a browser dependency merely because Vitest configuration defaults to jsdom.

[domain/model fixture inputs](../src/domain/model/__tests__/fixtures.ts) provide raw complete examples; tests parse them through the production schemas to obtain branded types. [viewer fixtures](../src/domain/cutting-tree/__tests__/viewer-fixtures.ts), [editing fixtures](../src/domain/cutting-tree/__tests__/editing-fixtures.ts) and [PDF fixtures](../src/application/export/__tests__/pdf-fixtures.ts) establish different accepted-plan contexts. Use the fixture appropriate to the invariant being tested rather than forcing every suite through a UI-generated plan.

A common persistence arrangement creates a fresh `IDBFactory` per test, connects multiple `createLocalPersistence(name, { indexedDB, IDBKeyRange })` instances to that factory for reload/concurrency tests and closes every connection in afterEach. A fresh connection is not a fresh database when the factory/name are shared intentionally. Failed migration tests must inspect persisted contents/version through a new compatible connection.

Component tests use fresh Pinia/router factories and injected services. For ports, type the fake to the production interface rather than casting an incomplete object. Hoisted spies and `vi.mock` isolate module adapters; PDF.js preview tests simulate loading/render tasks, cancellation and page cleanup rather than invoking a real PDF worker. Konva fakes inspect shapes/events and resource lifecycle rather than browser layout pixels.

### Assertion patterns that catch business regressions

| Scenario | Assert beyond a success result |
| --- | --- |
| Part create/import | Both Part records and owner partIds; another project's list unchanged |
| Optional setting | Omitted, true and false survive the relevant persistence/transfer path distinctly |
| Stock rerun | Exact IDs, quantities, active consumed snapshots and unchanged movement count |
| Late transaction failure | All original tables/records unchanged, not only error kind |
| Plan restoration | Literal reconstructed regions, copy ranges, oriented dimensions and independent validator result |
| ID-remapping import | All foreign/tree/current-result references use the same map; old destination records unchanged |
| PDF row/table layout | Measured geometry, page bounds, numbering, vector calls and no omitted child rows |
| Async route change | Delayed old read/worker/write cannot enter the new project or expose stale export bytes |

A mutation of the code under test that changes the intended invariant should fail the test. Assertions that mirror a label string or rebuild expected coordinates through the same helper may pass despite incorrect behavior.

## Current CI and completion process

[ci.yml](../.github/workflows/ci.yml) runs on push, pull_request and workflow_dispatch. The validation job uses Node from `.nvmrc`, npm caching, `npm ci`, lint, typecheck, tests and build with a 15-minute timeout. Default-branch pushes upload `dist` as a Pages artifact. The deploy job remains commented out; documentation or a green artifact does not verify a live deployment.

No configured coverage threshold, browser screenshot suite, architectural dependency-boundary plugin or Mermaid lint command is currently part of package scripts. Those are potential future tooling decisions, not checks that can be claimed as already running in CI. The full local test command includes application/persistence integration suites despite its `test:unit` name.

If an existing test fails during a documentation-only task, retain evidence and rerun the relevant suite to distinguish a reproducible regression from timing interference. Do not edit production/test behavior to make an unrelated documentation commit pass. Record initial failures and final verified results honestly.

## Maintaining the technical reference

[maintenance.md](maintenance.md) gives concrete change recipes for domain fields, Dexie migrations, optimization rules, stock reconciliation, JSON versions and new feature boundaries. [storage.md](storage.md) and [json-formats.md](json-formats.md) are the corresponding contract checklists.

For Mermaid validation, use a real Mermaid parser when available; balanced fences alone do not prove valid syntax. A browser is unnecessary for parser-only validation. Keep temporary documentation tooling outside project dependencies unless adopting it as maintained repository tooling is explicitly part of the task. Link checks should include relative target existence, heading fragments, repository-root paths and newly added source-symbol references.
