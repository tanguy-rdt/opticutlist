# Application & UI

[Documentation home](README.md) / [Developer Guide](developer-guide.md) / Start here

This guide describes current screens, not a future product roadmap. [Architecture](architecture.md) maps routes and layers; [stock management](stock-management.md) explains inventory rules.

**On this page:** [Home and Projects](#home-and-projects) · [Global Catalog](#global-catalog) · [Project Materials](#project-materials) · [Project Parts](#project-parts) · [Optimization](#optimization) · [Cutting Plans and PDF](#cutting-plans-and-pdf)

## Home and Projects

[HomeView.vue](../src/ui/pages/HomeView.vue) provides New Project, Import Project and Catalogue tiles using the existing workflows. [ProjectsView.vue](../src/ui/pages/ProjectsView.vue) lists projects, supports creation/import through a split button and edits project name/optional description. [ProjectRow.vue](../src/ui/components/projects/ProjectRow.vue) displays metadata and a clamped description; its action menu isolates clicks from the clickable project row. Export and guarded deletion remain project operations.

[ProjectCreationDialog.vue](../src/ui/components/projects/ProjectCreationDialog.vue) validates the complete new project. Existing projects default to Materials when opened without an explicit tab. [ProjectWorkspace.vue](../src/ui/layouts/ProjectWorkspace.vue) shows All projects / actual project name and compact Materials / Parts / Optimization / Cutting Plans / Stock links. No sequential completion state is inferred. The shell remembers the last intentional Projects overview/workspace destination separately from the open project and remembers tabs in session state.

[LegacyPartsPanel.vue](../src/ui/components/projects/LegacyPartsPanel.vue) exposes explicit review/adoption of unassigned historical Parts. Project deletion offers keeping current inventory or safe restoration, described in [stock management](stock-management.md#project-deletion).

## Global Catalog

[SuppliersView.vue](../src/ui/pages/SuppliersView.vue) combines supplier navigation, material-grouped selectable product tables and a details sidebar. Supplier header actions are Add Product plus a menu for edit/delete. Product rows expose Add to stock, Edit and Delete; the details sidebar is informational. Deletion uses the existing confirmation and reference safeguards.

[ProductForm.vue](../src/ui/components/suppliers/ProductForm.vue) groups dimensions with grain, then pricing. Price is optional and unknown prices display N/A; currency validation remains. Supplier availability is not editable, but the legacy domain field still controls eligibility where relevant. Material selection supports existing records or inline creation, including an optional library preset. Presets are not seeded catalog records. [catalog-repositories.ts](../src/application/catalog/catalog-repositories.ts) saves preset/material/product relationships atomically.

[SupplierForm.vue](../src/ui/components/suppliers/SupplierForm.vue) normalizes optional website domains on save through [supplier-website.ts](../src/ui/utils/supplier-website.ts). Logos are direct favicon requests, with generic fallback. Product URLs are ellipsized clickable links with full URL titles, not truncated stored data.

Products can be manually reordered by grip within the same supplier/material group. Search/filter states disable ambiguous ordering; ordering is persisted separately from products. Catalog reads refresh through existing lifecycle and Settings-import revision handling, without a manual refresh button.

### Catalog to physical Stock

[AddProductStockDialog.vue](../src/ui/components/suppliers/AddProductStockDialog.vue) displays the selected product snapshot and edits only a positive integer quantity. Confirmation invokes guarded `StockRepository.addFromProduct`. A request for five panels creates five distinct `quantity: 1` StockItems in one transaction, preserving exact purchase product provenance. Opening/canceling does nothing; duplicate submissions are blocked. It neither edits the product nor selects/reserves stock for a project. Success uses the shared toast.

## Global Stock

[StockView.vue](../src/ui/pages/StockView.vue) manages physically owned full panels/offcuts with material navigation, search/filtering, selected-row highlighting and details. Rows show dimensions and quantity rather than raw UUID/provenance text; Edit/Delete icon actions do not select rows. [StockForm.vue](../src/ui/components/inventory/StockForm.vue) and [stock-repository.ts](../src/application/inventory/stock-repository.ts) preserve inventory safeguards and reject stale edits/deletions from changed snapshots.

Grip-only drag and keyboard Up/Down moves reorder within a material. Filters disable reordering to avoid moving across hidden rows. Details retain useful provenance/history; a technical dimension preview uses uniform fill rather than material textures. Global stock management and project Stock serve different purposes.

## Project Materials

[MaterialsView.vue](../src/ui/pages/MaterialsView.vue) retains a three-column workflow: material library, source selection, project selections. The middle has Stock above Catalog. Both cards initially expand; supplier groups initially collapse and are keyed by supplier ID. Expansion is transient and retained while switching materials within the page.

Stock shows eligible distinct physical identities. Catalog groups product references by supplier, with branding at the group rather than repeated in every row. Stock bulk selection affects only the active material's eligible items. Supplier bulk selection affects only that supplier's eligible active-material products. Tri-state checkboxes are computed from individual selection IDs; there is no independent bulk-selection record. Collapsing never changes selection.

Selections autosave through serialized project-service writes. The right-hand panel and row/group checkboxes share the same draft IDs. Source snapshots refresh on reactivation/window focus; pending/failed drafts are retained. Failed writes expose Retry and navigation protection. Missing or invalid selections remain explicit until user removal. Current-project active consumed stock is valid for that project only, and own-generated offcuts cannot be newly selected. There are **no manual planning quantity inputs**.

## Project Parts

[ProjectPartsView.vue](../src/ui/pages/ProjectPartsView.vue) provides scoped ownership to [PartsView.vue](../src/ui/pages/PartsView.vue). New part's split menu imports Parts JSON; standalone Parts JSON export and manual refresh are absent. Table dimensions, quantity, selection and actions remain; grain/rotation details live in forms/details rather than redundant table columns.

[PartForm.vue](../src/ui/components/parts/PartForm.vue) restricts material choices to project membership and validates the complete Part. Grain is in Dimensions. Rotation is shown only for no grain constraint; hiding it retains the draft preference. Shared technical previews and errors do not change validation semantics. Create/update/delete/import success messages use shared toasts; failures remain actionable.

[PartsJsonTransfer.vue](../src/ui/components/parts/PartsJsonTransfer.vue) previews rows and resolves material labels explicitly before atomic import. Read the [format reference](parts-json.md).

## Optimization

[OptimizationView.vue](../src/ui/pages/OptimizationView.vue) rereads scoped input before each run. A compact header contains Optimize, utilization and Cutting settings. Settings saves kerf, margin and Prefer stock panels without launching optimization. Missing preference defaults to true; false is preserved.

The sidebar shows used panels, compact utilization bars and only the selected panel's placed copies, plus explicit unplaced demand and inspection. [PanelPlanView.vue](../src/ui/components/optimization/PanelPlanView.vue) integrates constrained editing and viewport controls. Overall dimensions are always visible; a toggle adds selected-copy dimensions and supported X/Y positions. There is no independent selected-cut workflow or inferred manufacturing sequence.

Accepted edits are independently validated and automatically persisted. Undo/redo are transient; pending/failed writes block document access rather than exporting an older plan. [Optimization](optimization.md) describes ranking, finite supply and grain rules.

## Cutting Plans and PDF

The Cutting Plans route uses the validated current result, including accepted edits. [CuttingPlansWorkspace.vue](../src/ui/components/optimization/CuttingPlansWorkspace.vue) displays an actual PDF.js preview and project-specific document settings. Cover title override, multiline description and PNG/JPEG image persist separately from the project name; paper A4/A3 and Portrait/Landscape are configurable. Portrait is the fallback.

Print and Download PDF share generated bytes/settings with preview, with loading buttons and error feedback. Print opens a native browser PDF viewer; automatic printing is not promised. No success toast claims a file was saved. See [PDF generation](pdf-generation.md).

## Project Stock: generated offcuts

[ProjectStockView.vue](../src/ui/pages/ProjectStockView.vue) groups validated offcuts by allocated panel, with counts, collapses and a fit-to-container drawing. Rows and canvas synchronize hover/inspection by internal identity. Temporary Offcut 1, Offcut 2 labels are numbered per source panel in waste-index order, not persisted or used as StockItem IDs.

Only checkboxes alter Keep/physical stock. Selecting/hovering never adds or removes inventory. Placed parts remain visible but secondary; small offcut labels are omitted when they do not fit. There are no manual Fit controls or movement history section on this page. The service still maintains movement history and reports unsafe-reconciliation conflicts.

## Settings and transfers

[SettingsDialog.vue](../src/ui/components/settings/SettingsDialog.vue) is a native modal on the current page, with Appearance, Catalog and Stock sections. Light, Dark and System apply immediately and persist via localStorage. Closing preserves the active route/project.

Catalog and Stock import/export live here, with preview/confirmation and error workflows. Successful imports notify active views through [data-import-revision.ts](../src/ui/state/data-import-revision.ts) and [use-data-import-refresh.ts](../src/ui/composables/use-data-import-refresh.ts). Project transfer is in Projects; Parts transfer is import-only in Parts. [Persistence and JSON](persistence-and-json.md) distinguishes these files from full backups.

## Developer workflow traces

For each feature's UI entry, service calls, domain operations, actual write set, validation and failure paths, see [End-to-end workflows](workflows.md). This feature map remains the concise screen index rather than duplicating those sequences.

---

**Continue exploring:** [Follow implementation traces](workflows.md) · [Shared UI conventions](architecture.md#shared-ui-and-assets) · [Documentation home](README.md)
