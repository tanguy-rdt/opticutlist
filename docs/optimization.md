# Optimization, constraints and editing

Read the authoritative [algorithm rules](../AGENTS.md), especially the stable `largestAreaFirst` baseline. Optimization is pure and inventory-independent; persisting its accepted result is a separate inventory-affecting operation.

## Inputs and worker boundary

[OptimizationView.vue](../src/features/optimization/OptimizationView.vue), notably `readInputs` and `start`, rereads the project, owned Parts, selected SupplierProducts and project-aware Stock availability. It resolves historical labels for snapshots and rejects missing/broken source references rather than substituting similar panels.

[OptimizeProjectInput](../src/domain/optimizer/project-plan.ts) carries Parts, source records with finite internal quantities, and cutting settings. Catalog products remain catalog sources; [stockPanel](../src/domain/optimizer/panel-source.ts) creates a geometry-only `stock:<id>` allocation key carrying exact `stockItemId`.

[createOptimizationService](../src/application/optimization/optimization-service.ts) owns a worker port and request IDs. It returns typed outcomes rather than rejecting, supersedes/cancels obsolete work, validates responses and independently validates received plans. [optimization-protocol.ts](../src/application/optimization/optimization-protocol.ts) defines plain structured-cloneable messages and guards. [handleOptimizationRequest](../src/workers/optimization/handle-optimization-request.ts) delegates to domain algorithms; it never selects inventory, saves records or implements alternate placement logic.

## Automatic supply preparation

There are no user-configured source quantities. Legacy `CuttingProject.panelQuantities` is still parsed but is not the new-run supply policy.

- Catalog reference capacity is [catalogPanelSupply(parts)](../src/application/optimization/catalog-panel-supply.ts), the safe-integer sum of requested copies. This is a sufficient finite bound because every allocated panel must place at least one remaining copy.
- Stock capacity is the real available quantity, plus only the current project's active consumed allocation when rerunning. Sources are ordered by stable StockItem ID before optimization so availability read order cannot change physical identity tie-breaks.
- Current-project generated offcuts are excluded by exact cutting provenance. Eligible other-project offcuts are normal owned candidates.
- `unavailable` legacy catalog products remain disallowed. Prices are not costs in optimization.

This avoids unbounded catalog search while never treating physical Stock as unlimited.

## Single-panel engine

[planWithStrategy](../src/domain/optimizer/plan-with-strategy.ts) uses shared integer geometry and guillotine splitting. Current strategies are `largestAreaFirst`, `longestSideFirst`, `bestShortSideFit`. They differ in deterministic demand/region choices, not in validation rules. Do not change the baseline opportunistically while adding another strategy.

[optimizePanel](../src/domain/optimizer/optimize-panel.ts) runs all strategies and ranks valid candidates by:

1. Fewer unplaced copies.
2. Greater used area on this panel.
3. Larger single reusable waste region.
4. Declared strategy order.

Invalid trees appear as rejected candidates and never win. No valid usable region produces a typed failure, not an invented placement.

## Multi-panel schedules and Stock preference

[optimizeProject](../src/domain/optimizer/optimize-project.ts) reuses the single-panel engine inside deterministic greedy schedules. Normal candidates include maximum-copy coverage, smaller-panel selection and each possible first-source seed. Each allocation consumes only an internal source counter and advances explicit Part copy indices.

With `preferStockPanels !== false` and owned sources present, the same scheduler additionally evaluates Stock-aware coverage/small-panel schedules and Stock-aware continuations from each first-source seed. Owned means validated Stock identity, not a name such as “Stock panel.”

Final comparison is lexicographic:

1. Maximize produced copies, so a less complete plan cannot win by avoiding Catalog.
2. When preference is enabled, minimize the number of allocated Catalog panels.
3. Minimize allocated panel count.
4. Minimize waste area.
5. Retain stable candidate order for ties.

Disabling preference runs normal candidates/ranking without an explicit source bias. This is **not a small utilization bonus**, monetary objective or absolute instruction to use every available StockItem. Among evaluated complete solutions, zero Catalog beats one Catalog even if the owned panel is larger.

Example regression: selected Catalog 800 × 400; two distinct StockItems 800 × 600; two compatible 200 × 400 Parts, kerf/margin permitting both layouts. Enabled preference chooses one owned panel and no Catalog panels; the second physical identity is unused. Disabled preference may choose Catalog for lower waste. See [optimize-project.spec.ts](../src/domain/optimizer/__tests__/optimize-project.spec.ts).

### Search limitations and termination

This is not exhaustive packing or a proof of globally minimum Catalog count. A schedule greedily continues after its first source and cannot explore every placement/allocation sequence. At most `2n + 4` schedules are constructed when preference is active for `n` sources; each loop either places at least one remaining copy or stops. Supply is finite and there are no empty allocated panels. Large safe-integer quantities are still potentially expensive: numeric validity is not a performance guarantee.

## Geometry and independent validation

[units.ts](../src/domain/geometry/units.ts) rounds supported millimetres to integer micrometres (0.001 mm). Arithmetic and region comparisons use these helpers. Range errors are distinct from expected “does not fit” outcomes. Validators use nonthrowing conversion and accumulate located issues for malformed external data.

[rect.ts](../src/domain/geometry/rect.ts) removes the edge margin from each side; that margin includes its trim cut. Internal splits account for physical kerf between child regions. A remainder cannot silently absorb an impossible kerf. Material identity and exact thickness are checked separately from 2D geometry.

[getAllowedOrientations](../src/domain/geometry/part-orientation.ts) applies final grain-axis compatibility when both grains are specified, overriding stale rotation preferences where needed. When either grain is `none`, rotation policy applies. Shared fit, optimizer, editor and validators must use this same rule.

[validateCuttingTree](../src/domain/cutting-tree/validate-cutting-tree.ts) checks executable full-region guillotine structure, regions, leaves, compatibility, orientation and copy accounting. [validateProjectPlan](../src/domain/optimizer/validate-project-plan.ts) additionally checks global quantities, source panel limits and allocations. A nonoverlapping picture is insufficient proof of manufacturability.

## Outputs and utilization

[ProjectCuttingPlan](../src/domain/optimizer/project-plan.ts) explicitly returns allocated panels, global unplaced copy ranges/reasons and metrics. Reasons distinguish no compatible source, constraints preventing fit, and finite capacity/usable-space limits. Per-panel `allocatedElsewhere` demand describes copies made on other panels; it is not globally unplaced demand.

Used area sums finished placed rectangles. Panel area uses full physical panel dimensions; waste is panel area minus placed area, so trims and kerf contribute to utilization loss rather than becoming reusable offcuts. Overall utilization is `usedArea / panelArea * 100`, not an average of panel percentages; an empty result uses zero.

## Editing, annotations and persistence

[editCuttingTree](../src/domain/cutting-tree/edit-cutting-tree.ts) performs immutable constrained rotate/swap operations. Rotation may recut only an anchored reserved region; swaps require exact permitted fits within existing regions. Both original and candidate trees are validated. Rejection leaves the old tree unchanged.

[plan-editing-session.ts](../src/application/optimization/plan-editing-session.ts) maintains isolated baseline/current/undo/redo state. [plan-canvas.ts](../src/features/optimization/viewer/plan-canvas.ts) handles presentation; dragging pans, not free part relocation. The accepted edited plan participates in current-result persistence and PDF snapshots, never by mutating the baseline.

[cutting-plan-scene.ts](../src/application/optimization/cutting-plan-scene.ts) derives parts, waste and physical kerf rectangles from a validated tree. [plan-canvas.ts](../src/features/optimization/viewer/plan-canvas.ts) scales those rectangles with panel geometry; zero-width/height kerfs get a 0.75-pixel screen-space stroke for visibility. The current `--cutting-kerf` token in [styles.css](../src/app/styles.css) is brown in light/dark themes, not red. There is no separate red centerline renderer in the current implementation. Piece boundaries use their own palette entry and are not interpreted as additional cuts.

[dimensions.ts](../src/features/optimization/viewer/dimensions.ts) always draws overall dimensions and optionally selected-copy oriented dimensions/X/Y positions from the panel origin. Annotation strokes/text are screen-sized and noninteractive. It does not invent a selected-cut concept or cutting sequence. Fit reserves annotation lanes; ordinary editing does not reset manual zoom.

[Current-result service](../src/application/plans/current-result-service.ts) validates/encodes and atomically replaces the current snapshot while reconciling inventory. Legacy/audited plans are retained. Cancellation and project changes invalidate stale queued writes; failed persistence must not expose an older plan as the current export. See [stock management](stock-management.md) and [testing](testing.md).
