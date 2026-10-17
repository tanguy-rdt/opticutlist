# Persistence backends and browser storage

[Documentation home](README.md) / Data & persistence

This is the physical-storage companion to [persistence and JSON](persistence-and-json.md). Exact contracts are [Repositories / Persistence](../src/application/persistence/repositories.ts), [local-database.ts](../src/infrastructure/persistence/local-database.ts) and the linked schemas below. Relationships are application-enforced; IndexedDB has no foreign-key or automatic cascade rules here.

**On this page:** [Self-hosted deployment & API](#self-hosted-storage) · [Storage deployment modes](#storage-deployment-modes) · [Adapter construction and transaction architecture](#adapter-construction-and-transaction-architecture) · [Complete table catalog](#complete-table-catalog) · [CRUD read/write mechanics](#crud-readwrite-mechanics) · [Atomic write sets](#atomic-write-sets) · [Versions: three separate axes](#versions-three-separate-axes) · [Deletion and recovery boundaries](#deletion-and-recovery-boundaries)

## Storage deployment modes

The default browser adapter is unchanged: IndexedDB database `opticutlist`, schema v8, existing keys and strict domain validation. Application services use [Persistence / Repositories](../src/application/persistence/repositories.ts), not Dexie. `LocalPersistence` remains a compatibility alias.

[createConfiguredStorage](../src/app/persistence.ts) selects service execution at bootstrap. Unset/`browser` `VITE_STORAGE_MODE` uses local services and Dexie; `server` uses HTTP adapters to the same guarded services running beside SQLite. Unknown configuration and server failures never fall back to browser storage. `npm run build` remains the static application; `npm run build:self-hosted` explicitly builds the server deployment. There is no hostname detection or user toggle.

The optional Node service, SQLite schema, transaction scopes, shared ownership, backup procedure and no-auth security restrictions are documented in [Self-hosting](storage.md#self-hosted-storage). Browser data is still origin/profile-local. Switching modes does not upload or synchronize it. Existing JSON transfers remain partial exchanges, not complete inventory/audit backups.

Theme preferences remain device-local; navigation and editor state remain transient. Project cutting/PDF settings and cover data follow the configured project persistence. The remainder of this page describes **the browser adapter**, including its independent migration history.

## Adapter construction and transaction architecture

`createLocalPersistence(name = DATABASE_NAME, options?: DexieOptions)` constructs an independent Dexie connection; it is not a singleton. Options allow isolated IndexedDB factories in tests. [Startup selection](../src/app/persistence.ts) creates the production browser instance for `main.ts`; `main.ts` closes it when the app unmounts. Repositories can cause Dexie to open lazily; `open()` is an explicit typed-result API, not a mandatory call before every method.

```mermaid
flowchart TD
  View[Vue feature with typed injection key] --> Guard[Guarded application service]
  Guard --> Port[Persistence and Repositories ports]
  Port --> Adapter[createLocalPersistence Dexie adapter]
  Adapter --> Single[Single-table r or rw transaction]
  Adapter --> Multi[All-store rw transaction callback]
  Single --> Parse[Strict schema validation]
  Multi --> Scoped[Transaction-scoped repositories and failure tracker]
  Scoped --> Parse
  Parse --> DB[(IndexedDB opticutlist)]
```

The generic adapter enforces record validity, ID stability and insert/update semantics. It does **not** itself know Part ownership, supplier deletion dependencies or stock reversibility. Those checks belong in guarded application use cases. Calling raw CRUD from a new feature would bypass them even though Zod parsing still passes.

## Complete table catalog

Every key is the record's `id`, with no auto-increment or compound primary key. Only two secondary indexes are declared. Arrays such as `partIds` are not indexed.

| Table | Primary key | Secondary indexes | Record and purpose | Lifecycle |
| --- | --- | --- | --- | --- |
| `materials` | MaterialId | None | [Material](../src/domain/model/material.ts), compatibility identity and optional preset | Shared; deletion checks selected materials, Parts, products and stock |
| `parts` | PartId | None | [Part](../src/domain/model/part.ts), finished demand | Owned through `projects.partIds`; legacy unassigned records remain |
| `suppliers` | SupplierId | None | [Supplier](../src/domain/model/supplier.ts), supplier metadata | Shared; products block deletion |
| `supplierProducts` | SupplierProductId | None | [SupplierProduct](../src/domain/model/supplier-product.ts), external planning reference | Shared; project choices and purchase-stock provenance block deletion |
| `stockItems` | StockItemId | None | [StockItem](../src/domain/model/stock-item.ts), currently owned available quantity | Depleted records may be deleted; exact historical snapshots remain elsewhere |
| `projects` | CuttingProjectId | None | [CuttingProject](../src/domain/model/cutting-project.ts), ownership, selections, settings | Guarded create/update; coordinated deletion |
| `savedPlanSummaries` | SavedCuttingPlanId | `projectId` | [SavedPlanSummary](../src/domain/model/saved-cutting-plan.ts), name/owner/date | Current, legacy and audited origins |
| `savedPlanContents` | SavedCuttingPlanId | None | [SavedPlanContents](../src/domain/model/saved-cutting-plan.ts), compact validated historical payload | Same identity as summary; deleted together where safe |
| `cuttingConfirmations` | SavedCuttingPlanId | `projectId` | [CuttingConfirmation](../src/domain/model/cutting-confirmation.ts), immutable legacy receipt | Retained across project deletion |
| `currentCuttingResults` | CuttingProjectId | None | [CurrentCuttingResult](../src/domain/model/current-cutting-result.ts), planId and preserveLegacy | At most one pointer per project |
| `projectStock` | CuttingProjectId | None | [ProjectStock](../src/domain/model/project-stock.ts), decisions, active consumption, embedded movements/audit | Preserved as named audit after deletion |
| `stockOrders` | MaterialId | None | [StockOrder](../src/application/inventory/stock-order.ts), ranked Stock IDs | Presentation metadata; stale IDs ignored by sorting |
| `catalogOrders` | SupplierId | None | [CatalogOrder](../src/application/catalog/catalog-order.ts), ranked product IDs | Presentation metadata; per-material views filter supplier-wide order |

A `StockMovement` concept exists as embedded ProjectStock movement records and receipt arrays; there is **no standalone stockMovements table**. Similarly, offcut decisions are embedded entries, not an independent offcuts store. Do not add direct table lookups for conceptual entities that are stored as snapshots.

### Physical relationship diagram

Dashed/historical references below can outlive their live record. `snapshot_arrays` means embedded values, not normalized child tables.

```mermaid
erDiagram
  projects {
    string id PK
    array partIds
    array materialIds
    array supplierProductIds
    array stockItemIds
    object cuttingSettings
    object pdfSettings
  }
  parts {
    string id PK
    string materialId
  }
  materials {
    string id PK
  }
  suppliers {
    string id PK
  }
  supplierProducts {
    string id PK
    string supplierId
    string materialId
  }
  stockItems {
    string id PK
    string materialId
    object provenance
    int quantity
  }
  savedPlanSummaries {
    string id PK
    string projectId "indexed"
  }
  savedPlanContents {
    string id PK
    string projectId
    array sources "snapshots"
    array parts "snapshots"
    array panels "compact trees"
  }
  currentCuttingResults {
    string id PK "project ID"
    string planId
    boolean preserveLegacy
  }
  cuttingConfirmations {
    string id PK "plan ID"
    string projectId "indexed"
    array consumed "snapshots"
    array offcuts "snapshots"
  }
  projectStock {
    string id PK "project ID"
    array entries "decisions and snapshots"
    array consumed "active snapshots"
    array movements "append-only snapshots"
    object deletedProject
  }
  stockOrders {
    string id PK "material ID"
    array stockItemIds
  }
  catalogOrders {
    string id PK "supplier ID"
    array productIds
  }
  projects ||--o{ parts : owns_via_array
  materials ||--o{ parts : referenced_by
  materials ||--o{ supplierProducts : referenced_by
  suppliers ||--o{ supplierProducts : referenced_by
  materials ||--o{ stockItems : referenced_by
  supplierProducts o|..o{ stockItems : purchase_provenance
  projects ||--o| currentCuttingResults : current_pointer
  currentCuttingResults }o--|| savedPlanSummaries : planId
  savedPlanSummaries ||--|| savedPlanContents : same_id
  projects o|..o{ savedPlanSummaries : owner
  projects o|..o| projectStock : live_or_archived_owner
  savedPlanSummaries o|..o| cuttingConfirmations : receipt_origin
  materials ||--o| stockOrders : display_order
  suppliers ||--o| catalogOrders : display_order
```

IDs in source snapshots are not necessarily live catalog foreign keys: a Stock allocation uses a branded-compatible `stock:<id>` key plus exact StockItem ID. The historical Part array in saved contents is independent of live `parts` ownership.

## CRUD read/write mechanics

`createRepository` validates unknown input with the supplied schema. `get` validates the ID, checks existence and parses the stored record. `list` reads in primary-key order (`orderBy(':id')`) and parses every record; it fails the entire operation on any corrupt row. It never filters corruption away.

```mermaid
sequenceDiagram
  participant Caller
  participant Repo as Generic repository
  participant Dexie
  participant Schema as Zod schema
  Caller->>Repo: get(id) or list()
  Repo->>Dexie: Single-table read transaction
  Dexie-->>Repo: Structured-cloned stored data
  Repo->>Schema: Parse ID and complete records
  alt valid existing data
    Repo-->>Caller: ok true with parsed entity/list
  else absent get
    Repo-->>Caller: notFound
  else malformed record or storage exception
    Repo-->>Caller: invalidRecord or storageFailure
  end
```

Create uses `add()` and maps ConstraintError to `duplicateId`, so concurrent creation never overwrites. Update parses the new record and ID, requires matching identity, rereads the previous record to confirm existence/validity, then `put()` replaces the full record. Delete requires a valid existing record before removal. No patch API, automatic relationship repair or upsert is exposed.

```mermaid
sequenceDiagram
  participant Caller
  participant Guard as Application guard
  participant Tx as Scoped transaction
  participant Repo as Generic repository
  participant DB as IndexedDB
  Caller->>Guard: Save complete record
  Guard->>Guard: Schema precheck
  Guard->>Tx: transaction(callback)
  Tx->>DB: Begin rw transaction on every table
  Guard->>Repo: Reread dependencies through scoped repositories
  Repo->>DB: Get validated records
  Guard->>Repo: create or update
  Repo->>DB: add or require-then-put
  alt every operation and callback succeeds
    DB-->>Caller: Commit, ok true
  else any scoped failure or thrown exception
    Tx->>DB: Abort, including earlier successful writes
    Tx-->>Caller: First tracked failure or callback error
  end
```

`find` on projectStock/currentCuttingResults/cuttingConfirmations returns successful null for absence, unlike generic `get`. Project-scoped summary/receipt reads use `projectId` indexes; summaries are explicitly sorted by createdAt then ID. Most reference guards scan lists because no corresponding secondary indexes exist.

## Atomic write sets

| Application operation | Principal records written in one transaction |
| --- | --- |
| Scoped Part create/delete or batch import | `parts` plus owning `projects.partIds` |
| Inline preset product save | Resolve/create `materials`, then `supplierProducts` |
| Catalog Add to stock | Distinct `stockItems` after product/material/supplier snapshot checks |
| Current-result replace | Summary, contents, current pointer, source Stock deltas, generated offcuts and projectStock ledger |
| Keep checkbox | projectStock decision plus safe Stock additions/removals/movement |
| Project deletion | Owned Parts/plans/current/project; audit retained; optional source restoration/offcut removal |
| Catalog import | Materials, suppliers, products and optional catalogOrders after remapping |
| Stock import | New independent stock and optional new stockOrders; no movement reset |
| Ordering move | One order record after rereading complete valid group membership |

Read [workflows](workflows.md) before assuming every read is pure: current-result `load()` can write, and project Stock `sync()` is explicitly a reconciliation operation.

### Stock reconciliation transaction trace

This diagram combines `CurrentResultService.replace` and `reconcileProjectStock`; the physical write phase begins only after safety checks. A business conflict can commit the new result/conflict ledger while leaving inventory untouched. A database failure aborts the entire transaction.

```mermaid
sequenceDiagram
  participant View as OptimizationView
  participant Current as CurrentResultService
  participant Tx as Transaction-scoped repositories
  participant Reconcile as reconcileProjectStock
  participant DB as IndexedDB
  View->>Current: replace(detached validated SavePlanInput, signal)
  Current->>Current: prepareSavedPlan and reconstruct/validate
  Current->>Tx: Begin transaction, require live project
  Current->>Tx: Read old pointer, plan, receipts and ledger
  Current->>Tx: Remove old ordinary unaudited plan if allowed
  Current->>Tx: Insert new summary/contents and pointer
  Current->>Reconcile: Reconcile new saved plan within same transaction
  Reconcile->>Tx: Read live stock, ledgers and receipts
  Reconcile->>Reconcile: Compute exact desired consumption and offcut deltas
  alt physical changes safe
    Reconcile->>Tx: Apply stock deltas, decisions, append movement
    Tx->>DB: Commit result and inventory together
  else unsafe business reversal
    Reconcile->>Tx: Persist conflict without physical changes
    Tx->>DB: Commit preserved inventory with conflict/result
  else repository failure
    Tx->>DB: Abort result and every stock write
  end
  Current-->>View: PersistenceResult
```

## Versions: three separate axes

| Axis | Current value | Meaning |
| --- | --- | --- |
| Application package version | `0.0.0` in package.json | Development package metadata; product target remains first stable 1.0 |
| IndexedDB/Dexie schema | 8 (native backend version 80) | Table/index upgrade path for one local database |
| JSON exchange contracts | Each envelope version 1 | Independent portable-file contracts; Parts uses `version`, others `schemaVersion` |
| Compact saved payload | `formatVersion: 1` | Persisted/reconstructed tree encoding within saved-plan contents |
| Material manifest | `version: 2` | Static local thumbnail manifest, not a backup or database version |

Changing one axis does not automatically change the others. An added optional project field can remain in DB v8 and project JSON v1. A new indexed table needs a new Dexie version even if no file format changes.

### Implemented upgrade path and future migrations

Current versions 1–8 only append stores/index declarations. There is no application-level record-rewrite migration registry and no destructive recovery handler. Dexie handles declared schema upgrades transactionally; tests exercise failure preservation with an explicit simulated upgrade.

```mermaid
flowchart TD
  Open[Open origin-local database] --> Existing{Stored version}
  Existing -->|No database| Create[Create latest declared stores]
  Existing -->|Older supported version| Upgrade[Dexie applies successive declarations transactionally]
  Existing -->|Current version| Ready[Ready with strict repository validation]
  Existing -->|Unsupported newer version| Error[Typed storage failure, preserve database]
  Upgrade --> Success{Upgrade commits?}
  Success -->|yes| Ready
  Success -->|no| Rollback[Keep previous records and version, report failure]
  Create --> Ready
```

The ready hook rejects native versions greater than `DATABASE_VERSION * 10`; underlying open errors are also surfaced. **Recommendation for future data migrations:** append a version with an awaited upgrade callback, transform in that upgrade transaction, and test real old fixtures before/after reopen plus forced failure. Never edit shipped declarations or silently normalize corrupted records during list reads.

## Deletion and recovery boundaries

Generic delete has no cascade. Guarded supplier deletion refuses existing products; product deletion refuses selected project references or live purchase-linked stock; material deletion refuses direct project choices and live Part/product/stock references. Historical snapshot references intentionally do not always block live catalog deletion.

Scoped Part delete removes its ID from the owner atomically. Project deletion is coordinated by [project-deletion.ts](../src/application/projects/project-deletion.ts), including a transaction-time replay of inventory history before optional restoration. It retains receipts and an archived named ledger, not a hidden active project. Order records are not a replacement for referential ownership: stale ranks are tolerated/ignored and export filters stale IDs.

There is no automatic corrupt-record quarantine, repair UI, full application backup or cross-tab revision conflict protocol. On `invalidRecord`, preserve the original storage and inspect the reported path/schema. `notFound` can be a real dependency issue; do not create replacements with matching names. Browser quota, permission or IndexedDB errors become storage failures; Retry does not promise the underlying condition is resolved. Storage eviction/privacy behavior and concurrent-tab UX remain browser-level risks.

Persisted, derived and transient data are catalogued in [architecture](architecture.md#data-flow-and-state-lifetime). Theme localStorage and session navigation are deliberate exceptions to IndexedDB business persistence, not alternative stores for domain entities.

## Self-hosted storage

OptiCutList v1's default application remains a static, browser-local application. The optional self-hosted build serves the same UI and a small versioned HTTP API from one Node.js process. Its database belongs to the deployment, not to a browser profile. Optimization, manual editing, PDF generation and PDF preview still execute in the browser.

> **Trusted environments only.** This version has no authentication or user isolation. Everyone who can access the service can read and change its entire shared database. Use loopback, a private LAN or a VPN; do not expose it directly to the public internet. Origin checks are not authentication.

### Run the service

Use Node.js 24 or newer and the existing npm dependencies. The server uses `node:http` and `node:sqlite`; no framework, ORM or additional runtime dependency is required. Node 24.8, used for the initial verification, labels SQLite experimental. Prefer an up-to-date maintained Node 24 runtime; review Node's SQLite compatibility before upgrading production.

```sh
npm ci
npm run build:self-hosted
npm run start:self-hosted
```

Open `http://127.0.0.1:3000/opticutlist/`. The frontend retains the existing Vite base and hash routing. `dist-self-hosted/` contains the server-mode frontend; `server-dist/main.js` is the Node entry point. Install dependencies on the host and deploy these two build directories together. Run as an unprivileged OS user with access to the database directory. The service does not require a second web server.

For local development, rebuild with `npm run build:self-hosted` after changes and restart the service. The ordinary `npm run dev` remains browser-local; there is no implicit API proxy or hostname-based mode selection.

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `OCL_HOST` | `127.0.0.1` | Listening interface; binding beyond loopback requires `OCL_ORIGIN` |
| `OCL_PORT` | `3000` | Listening TCP port, 1–65535 |
| `OCL_ORIGIN` | Loopback HTTP origin for the selected port | Exact external `http(s)://host[:port]`, without a path or trailing slash; must match incoming Host and browser Origin |
| `OCL_DATABASE_PATH` | `data/opticutlist.sqlite` | Durable SQLite file, resolved from the process working directory |
| `OCL_FRONTEND_PATH` | `dist-self-hosted` | Matching built frontend directory |

Example behind an HTTPS reverse proxy on a private network:

```sh
OCL_HOST=127.0.0.1 OCL_ORIGIN=https://opticutlist.internal \
OCL_DATABASE_PATH=/srv/opticutlist/data/opticutlist.sqlite npm run start:self-hosted
```

Prefer an absolute database path in a service configuration; otherwise changing the working directory changes the selected dataset. Do not store the database in a frontend/build directory. Startup rejects that configuration, unrelated databases and unsupported newer database versions. It never resets an existing database. A generated storage-mode marker also prevents accidentally serving a browser-mode build as the self-hosted frontend.

Outside loopback, use HTTPS with a browser-trusted certificate even on a LAN/VPN: the existing frontend uses secure-context APIs such as `crypto.randomUUID`. Plain HTTP to a remote LAN IP does not provide those APIs. Loopback HTTP works for local use.

A reverse proxy must preserve the configured Host and forward the actual browser Origin. Set `OCL_ORIGIN` to the exact external origin. The server does not trust forwarded headers or infer an origin from a request. HTTPS, VPN restrictions, process supervision and firewall/access controls are the operator's responsibility.

### Execution and storage boundary

```mermaid
flowchart TD
  UI[Vue UI and injected services] --> Choice[Explicit build-time storage mode]
  Choice --> Browser[Browser application services]
  Browser --> Dexie[Dexie: unchanged IndexedDB v8]
  Choice --> Remote[HTTP service adapter]
  Remote --> API[Node: fixed API operations and request validation]
  API --> Guards[Same guarded application services]
  Guards --> SQLite[SQLite Persistence implementation]
  SQLite --> Disk[(Persistent host file)]
  UI --> Worker[Browser optimization worker]
```

[createConfiguredStorage](../src/app/persistence.ts) composes the service interfaces injected by [main.ts](../src/app/main.ts). Unset/`browser` `VITE_STORAGE_MODE` constructs the unchanged Dexie adapter and local services. `server` constructs [HTTP service adapters](../src/infrastructure/http/storage-services.ts). Unknown modes fail; unavailable server storage returns a clear typed failure and never falls back to IndexedDB.

[createStorageServices](../src/application/storage/services.ts) is shared browser/server composition for the existing catalog, project, Parts, stock, current-result, offcut, confirmation and transfer use cases. The backend executes these operations, not a separate copy of their business rules. The existing [Persistence contract](../src/application/persistence/repositories.ts) remains an **in-process** transaction boundary. A callback is never sent over HTTP.

Theme and navigation preferences remain browser-local. Business records, project settings, cover images and accepted plans are shared through SQLite in server mode. There is no live synchronization of already-open screens; reloading/rereading is needed to see other clients' changes.

### API contract

[api-contract.ts](../src/application/storage/api-contract.ts) defines every supported method, argument tuple and response codec. [operations.ts](../server/operations.ts) maps the fixed whitelist to guarded application operations. The paths below are prefixed by `/api/v1/`; dots in contract names become slashes.

| Paths | Methods and operations |
| --- | --- |
| `health` | GET: SQLite service/schema identity |
| `catalog/materials/{list,get,create,update,delete}` | GET list/get, POST create, PUT update, DELETE delete |
| `catalog/suppliers/{list,get,create,update,delete}` | Same guarded CRUD methods |
| `catalog/products/{list,get,create,update,delete}` | Same guarded CRUD methods |
| `catalog/products/{ordering,move,saveWithPreset}` | GET ordering; POST move/saveWithPreset |
| `projects/records/{list,get,create,update,delete}` | Guarded project CRUD; deletion preserves the existing default stock handling |
| `projects/{deletionPreview,delete,legacyParts,adopt}` | GET preview/legacyParts; DELETE delete with keep/restore; POST adoption |
| `parts/{list,get,create,createMany,update,delete}` | Project-scoped GET reads, POST creation, PUT update, DELETE deletion |
| `stock/{list,get,create,update,delete}` | Guarded physical inventory CRUD, including supplied stale-draft checks |
| `stock/{ordering,move,addFromProduct,saveWithPreset}` | GET ordering; POST movement in UI order/purchase/preset save |
| `stock/{selectionStock,planningStock,history}` | GET project-aware snapshots/history |
| `current/{load,replace}` | POST load (may reconcile/adopt); PUT validated result replacement plus stock reconciliation |
| `projectStock/{preview,sync,setKeep}` | GET preview; POST reconciliation/Keep decision |
| `confirmations/{list,preview,confirm}` | GET legacy receipt reads; POST existing guarded confirmation |
| `{catalogTransfer,stockTransfer,projectTransfer}/{export,preview,import}` | GET export; POST validated preview/import with existing consent rules |
| `partsTransfer/{preview,import}` | POST project-scoped Parts preview/import |

GET arguments are a JSON tuple in the `args` query parameter (maximum 8 KiB). Other methods use a JSON tuple body (maximum 16 MiB), `Content-Type: application/json`, `X-OptiCutList: 1` and a unique `Idempotency-Key` (1–128 ASCII alphanumeric/hyphen characters). Tuple order and record schemas are authoritative in the contract, not inferred from URL parameters.

For example, POST `catalog/materials/create` accepts `[materialRecord]`; PUT `stock/update` accepts `[stockId, replacementRecord, previousSnapshot?]`. PUT `current/replace` accepts `[projectId, validatedCompactContents, editedPanelIndices]`. It reconstructs and independently validates plan data through existing services; there is no optimization endpoint.

Responses are `{ "ok": true, "value": ... }` or `{ "ok": false, "error": ... }`. Void responses omit `value` (cached retries may return null). Errors retain the existing discriminants: invalid records → 400, missing records → 404, identity/reference conflicts → 409, storage failures → 503. Protocol/security errors use 403/405/413/414/415 as appropriate; unexpected failures return a sanitized 500. Clients validate envelopes and returned records. Neither SQL nor arbitrary repository/transaction execution is exposed.

The host/origin checks, non-simple application header, JSON content type and lack of CORS approval prevent ordinary cross-origin browser mutations. They do not prevent a trusted-network client from deliberately calling the API. No credentials, tracking or analytics are introduced.

### SQLite model and migrations

[sqlite.ts](../server/sqlite.ts) implements the existing repositories. Migration **1** creates thirteen strict entity tables with stable text IDs and schema-validated JSON records:

| Tables | Ownership and additional database constraints |
| --- | --- |
| `materials`, `suppliers` | Shared catalog records |
| `supplierProducts` | Generated material/supplier foreign keys |
| `parts`, `stockItems` | Generated material foreign key; ownership/provenance remain application-validated |
| `projects` | Selections/settings and Part IDs retain their existing domain format |
| `savedPlanSummaries`, `savedPlanContents` | Contents ID references summary; summaries indexed by project |
| `currentCuttingResults` | Project ID and current saved-plan ID foreign keys |
| `projectStock` | Existing consumption, offcut decisions, movements and deleted-project audits |
| `cuttingConfirmations` | Immutable legacy receipts, indexed by project |
| `stockOrders`, `catalogOrders` | Existing presentation ordering |

Every entity table checks JSON validity and agreement between the primary key and record ID. Strict domain Zod schemas validate reads and writes, including every list item. Generated foreign keys are deferred until commit, allowing valid multi-record writes. Arrays and historical audit references remain governed by the existing application rules. There are deliberately no cascading deletes of inventory audits or shared catalog records. This is not a blind table dump: historical references can legitimately outlive live projects/plans and must not be forced into live-record foreign keys.

`schema_migrations` records applied versions; `PRAGMA user_version` is the SQLite schema version and `application_id` identifies this database. These versions are independent of IndexedDB v8, JSON format v1 and the released product version. Future SQL upgrades must append a transactionally applied migration; never rewrite migration 1, reset a file or assume an IndexedDB migration is a SQL migration.

`request_receipts` stores successful mutation response/hash pairs with their request keys. Old receipts are pruned after 30 days on subsequent successful commands; do not reuse a key after that retention window. They are operational retry records, not a replacement for immutable inventory audit history.

### Transactions, concurrency and network failures

Each API mutation wraps the **entire guarded operation and its request receipt** in a SQLite `BEGIN IMMEDIATE` transaction. Application transaction callbacks run locally with transaction-scoped repositories. Nested service transactions share the same operation. A failed scoped operation poisons the transaction even if its result is ignored; scopes expire at completion. Responses report success only after commit. Writes use parameters; table names come only from a fixed internal registry.

One process uses one serialized connection with foreign keys enabled, WAL journaling, `synchronous=FULL` and a five-second lock wait. This prevents concurrent stock checks and deductions from interleaving. Purchase creation, complete imports, result replacement/reconciliation, offcut changes and deletion/restoration retain the existing application's identity checks and rollback behavior. SQLite does not turn catalog references into owned inventory. Stock reconciliation still uses exact source IDs and remains idempotent.

Replaying the same key and payload returns the committed response without repeating the operation, including across service restart. Reusing a key for different arguments fails. No separate HTTP requests emulate a transaction. Browser plan computation remains independent and writes no stock until accepted-result persistence.

The frontend does not automatically retry failed writes. A lost connection can occur **after** commit; reload before repeating an action. A pre-aborted current-result save is rejected before transmission, but disconnecting/canceling after transmission cannot retract a server commit. Existing stock snapshot and reconciliation guards protect inventory, while ordinary project/catalog edits retain the existing full-record last-writer behavior. This is not real-time collaboration or a general optimistic-revision protocol. Run a single service process per dataset; clustering/high availability are outside this implementation.

### Backup, restore and explicit data transfers

Default durable files are in `data/`, outside build outputs, and ignored by Git. New directories use owner-only permissions and the SQLite main file is set to owner read/write. Protect the containing directory, WAL/SHM files and backups with OS permissions. Avoid network filesystems whose locking/durability cannot satisfy SQLite's requirements.

For a consistent full backup:

1. Stop the service gracefully and ensure no other process is writing the dataset.
2. Copy the complete database directory to protected backup storage; retain any WAL/SHM sidecars present. Do not copy just a live main file.
3. Restart the service. Periodically test restoring a copy in a separate private instance.

To restore, stop the service, preserve the existing directory as a rollback copy, restore the complete compatible backup into an empty destination directory, check ownership/permissions, set `OCL_DATABASE_PATH`, and restart. Never combine unrelated main/WAL files or remove sidecars from a live database. An online SQLite backup procedure can be added operationally; no backup/reset HTTP endpoint exists.

Browser data remains in its original origin/profile. There is no automatic browser-to-server upload or synchronization. Existing Catalog/project/Stock JSON imports remain available with their current preview, confirmation, conflict and identity rules. They are **partial transfers**, not a complete backup: movement history and missing/consumed offcuts are not recreated. See [JSON formats](json-formats.md) and [backup boundaries](persistence-and-json.md#backup-boundaries) before migrating real inventory. A complete browser snapshot/restore format remains unimplemented.

### Validation and limitations

`npm run test:server` runs the new Node-environment tests under `server/__tests__/`, using real temporary file databases and HTTP listeners. They cover migrations/restart, ignored-operation rollback, foreign keys, expired scopes, request validation, concurrent stock changes, deduplication, JSON workflows, unavailable storage and idempotent current-result/offcut reconciliation. `npm run test:unit` also includes them. Existing browser tests remain unchanged.

The ordinary `npm run build` still produces the backend-free GitHub Pages application. Self-hosted builds and startup do not modify IndexedDB schemas or release tags. No accounts, automatic migration, cloud sync, network optimization, live updates or multi-tenant isolation are implemented. Public hosting requires a separately designed access-control boundary; do not interpret a working shared API as approval for unauthenticated public exposure.


---

**Continue exploring:** [Inventory lifecycle](stock-management.md) · [Migration recipe](maintenance.md#add-a-dexie-table-or-migration) · [Documentation home](README.md)
