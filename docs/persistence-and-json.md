# Persistence and JSON contracts

Business records are stored exclusively in IndexedDB. [Repositories](../src/application/persistence/repositories.ts) are application ports; [createLocalPersistence](../src/infrastructure/persistence/local-database.ts) implements them with Dexie. Vue features receive guarded services through injection, not database connections.

## Database and evolution

The database is `opticutlist`, currently Dexie version **8**. All declarations remain in [local-database.ts](../src/infrastructure/persistence/local-database.ts):

| Version | Additions |
| --- | --- |
| 1 | materials, parts, suppliers, supplierProducts, stockItems |
| 2 | projects; old Parts remain unassigned |
| 3 | savedPlanSummaries (projectId index), savedPlanContents |
| 4 | cuttingConfirmations (projectId index) |
| 5 | currentCuttingResults, keyed by project ID |
| 6 | projectStock, keyed by project ID |
| 7 | stockOrders, keyed by material ID |
| 8 | catalogOrders, keyed by supplier ID |

The implemented versions are additive store declarations, not destructive data migrations. Dexie represents versions as ten times the declared number in native IndexedDB. A future unsupported database version is rejected. Never delete/recreate storage to work around an upgrade failure.

Adding optional record fields may not require a new store/index version. Existing examples are project description, cutting settings and PDF settings. Defaults are commonly resolved at use time rather than rewriting every legacy record. Changing a required field still requires reviewing old data validation and file compatibility explicitly.

## Validated repository behavior

`Repository<Entity>` provides create/get/update/delete/list, returning `PersistenceResult<T>` with `invalidRecord`, `duplicateId`, `notFound`, `storageFailure` or `referenceConflict`. Create is insert-only (`add`); update replaces a validated existing record with unchanged ID and cannot upsert. All reads validate stored records with domain schemas. List fails as a whole on corruption instead of hiding records.

`LocalPersistence.transaction` covers multiple stores and supplies scoped repositories. It tracks the first failed operation and rolls back even if a callback ignores the failure. Scoped repositories cannot escape the callback lifetime. Await all operations; do not await network, timers or unrelated browser work inside a transaction. Guarded catalog/project/stock services add cross-record invariants beyond schema validation.

[Saved-plan codec](../src/application/plans/saved-plan-codec.ts) reconstructs full geometry from compact cut trees, Parts, source snapshots and historical settings, then independently validates it. Cyclic/reused compact nodes are rejected before recursive parsing. Canvas/PDF data, images of drawings and undo/redo are not plan payloads.

## Supported portable formats

All transfers use strict runtime validation, explicit preview/confirmation for import, and transaction-time rechecking. The shared JSON adapter [project-json.ts](../src/infrastructure/projects/project-json.ts) removes an optional leading UTF-8 BOM, parses unknown data and pretty-prints with indentation. Extensions are UI conventions; content identifies the format.

| Transfer | Envelope/version | Direction and main source |
| --- | --- | --- |
| Project `.oclproject.json` | `opticutlist-project`, `schemaVersion: 1` | Import/export; [project-transfer-format.ts](../src/application/projects/project-transfer-format.ts) |
| Catalog `.cocl` | `opticutlist-catalog`, `schemaVersion: 1` | Import/export in Settings; [catalog-transfer-format.ts](../src/application/catalog/catalog-transfer-format.ts) |
| Stock `stock.oclstock.json` | `opticutlist-stock`, `schemaVersion: 1` | Import/export in Settings; [stock-transfer-format.ts](../src/application/inventory/stock-transfer-format.ts) |
| Parts `.oclparts.json` | `opticutlist-parts`, `version: 1` | **Import only**; [parts-transfer-format.ts](../src/application/projects/parts-transfer-format.ts) |

Project download filenames use [project-filename.ts](../src/shared/ui/project-filename.ts) normalization. Parts import accepts existing filenames; there is no current Parts download filename generator. Older `.pocl` and general `.json` filenames are accepted by project import; these extensions do not imply an arbitrary legacy schema converter. The accepted content remains the validated version-1 contract. Missing supported optional fields are backward-compatible; unknown fields or unsupported versions are rejected.

### Full project transfer

The envelope contains `project`, `parts`, `catalog: { materials, suppliers, products }`, `savedPlans: [{ summary, contents }]` and optional `currentResultId`. [validateProjectTransfer](../src/application/projects/project-transfer-format.ts) checks unique identities, exact Part ownership, selected-product dependencies, required materials/suppliers, plan ownership, current pointer and reconstructed trees.

[project-transfer-service.ts](../src/application/projects/project-transfer-service.ts) exports scoped data in a transaction. Import rereads existing identities, remaps conflicts through [remap-project-transfer.ts](../src/application/projects/remap-project-transfer.ts), revalidates and inserts all dependencies/Parts/project/plans atomically. Identical catalog identities/fields may be reused; same-name records are not merged. Project description, cutting settings and PDF settings travel as project fields. Legacy `panelQuantities` travels for compatibility, without re-enabling controls.

Physical StockItems, inventory movements, receipts and offcut decisions are not transferred. Saved Stock source IDs and project stockItemIds can remain references, but import does not conjure their physical records or transfer ownership. A restored/imported plan may therefore be inspectable yet unable to reconcile safely in the destination. Treat an inventory dependency error as a real constraint, not a reason to remap Stock IDs by dimensions.

Minimal valid project envelope example (no Parts or dependencies):

```json
{
  "format": "opticutlist-project",
  "schemaVersion": 1,
  "project": {
    "id": "example-project", "name": "Workbench",
    "partIds": [], "materialIds": [], "supplierProductIds": []
  },
  "parts": [],
  "catalog": { "materials": [], "suppliers": [], "products": [] },
  "savedPlans": []
}
```

### Catalog transfer

Envelope: `format`, `schemaVersion`, `catalog` with complete materials/suppliers/products and optional `catalogOrders`. [remapCatalog](../src/application/catalog/remap-catalog.ts) preserves IDs only when safe, reuses identical stable-ID records and remaps collisions consistently across relationships. It never overwrites existing catalog entities or merges by display name.

Import inserts dependency order in one transaction. Existing manual ranks are preserved; new references append in imported order after ID remapping. Availability remains a validated legacy field; optional price stays omitted when unknown. This differs from Stock import, which blocks identity conflicts rather than remapping physical inventory.

### Stock transfer

Read the [complete format example and safety rules](stock-json-format.md). The file contains referenced Material snapshots and strict StockItems, optionally `stockOrders`. Materials must already exist and match; they are checks, not material creation requests. Purchased stock requires its exact catalog dependency.

[stock-transfer-service.ts](../src/application/inventory/stock-transfer-service.ts) is atomic and insert-only: identical records are no-ops; conflicting IDs, missing dependencies or reserved historical identities block the entire import. Cutting offcuts require matching existing stock and recorded origin/audit history. Missing generated inventory cannot be recreated. Stock movements and quantities are never merged or reset.

### Parts import

Read the [complete Parts JSON specification](parts-json.md). Rows use human-readable material labels and nominal `length`, `width`, `thickness`, not domain `lengthMm` keys or IDs. Every imported Part receives a new identity. Unique exact eligible labels can propose a material; ambiguous/missing labels require user mapping in preview.

[parts-transfer-service.ts](../src/application/projects/parts-transfer-service.ts) rechecks project material membership and creates the whole batch plus ownership atomically. Reimporting intentionally creates another batch. There is no standalone Parts exporter to maintain; full project export is the portable project backup path.

## Settings compatibility

Missing cutting settings fall back to restored result settings or kerf 3 / edge margin 0 in the Optimization workflow. Missing `preferStockPanels` means true; explicit false remains false. Missing PDF orientation means Portrait; explicit Landscape remains. Title overrides are separate from project name and redundant overrides can be omitted. Cover images are bounded PNG/JPEG MIME/base64 payloads in project PDF settings, not object URLs or plan snapshots.

## Backup boundaries

None of these exchanges is a complete IndexedDB/audit backup. Project files omit physical inventory/history; Stock files require existing dependencies and cannot restore missing consumed/generated stock; Catalog files omit projects and inventory; Parts files import definitions only. Exporting all file types still does not reproduce all immutable receipts/ledgers. There is no general full-application backup/restore service implemented.

## Recommendations for future compatibility

These are recommendations, not existing migration behavior:

- Add optional fields only with clear absent-value semantics; test omitted/empty/false/zero separately.
- Version incompatible envelopes explicitly and validate both old/new readers before remapping.
- Preserve identity maps across every dependent collection, including historical tree snapshots.
- Keep preview advisory and repeat checks in the write transaction.
- Use a separately designed full-backup contract if audit restoration is required; do not relax stock exchange safety to approximate it.
