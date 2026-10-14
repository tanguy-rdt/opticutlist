# Physical stock JSON exchange (version 1)

Settings → Stock exports `stock.oclstock.json` as readable UTF-8 JSON. Import accepts this extension or legacy/general `.json` names; contents, not filenames, determine compatibility.

```json
{
  "format": "opticutlist-stock",
  "schemaVersion": 1,
  "materials": [
    { "id": "oak", "name": "Oak", "category": "Hardwoods", "libraryPresetId": "chene" }
  ],
  "stockItems": [
    {
      "id": "workshop-panel-1",
      "kind": "fullPanel",
      "materialId": "oak",
      "lengthMm": 2440,
      "widthMm": 1220,
      "thicknessMm": 18,
      "quantity": 2,
      "grainDirection": "length",
      "provenance": { "source": "manual" }
    }
  ]
}
```

All displayed fields are required except `Material.libraryPresetId`. IDs are stable domain identities: do not replace them with names or regenerate them when replaying a file. Material snapshots contain only identities used by included stock, for verification; **import never creates or updates materials**. A compatible catalog must already exist (use Catalog import separately). Preset identity is optional and does not determine compatibility.

Stock fields reuse the existing strict StockItem schema. Length, width and thickness are finite positive millimeters; quantity is a positive safe integer. `kind` is `fullPanel` or `offcut`; grain is `none`, `length` or `width`. Unknown properties, duplicate IDs, missing references and unsupported versions are rejected. Empty inventory uses empty `materials` and `stockItems` arrays.

Provenance is preserved verbatim:

- Manual: `{ "source": "manual" }`.
- Purchase: `{ "source": "purchase", "supplierProductId": "product-id" }`. The catalog product must already exist with the same material ID.
- Cutting: `{ "source": "cutting", "projectId": "project-id", "savedPlanId": "plan-id", "sourceStockItemId": "source-stock-id", "panelIndex": 0, "wasteIndex": 1 }`. A catalog-origin offcut uses `supplierProductId` instead of `sourceStockItemId`; at least one exact source identity is required. Indices are zero-based non-negative integers.

## Import behavior

Preview reports new and identical stock references. Explicit confirmation performs one atomic, insert-only transaction and checks all dependencies again:

- New manual/purchased records may be added with unchanged IDs and quantities.
- An exactly identical existing stock record is a no-op, never a quantity increment.
- A conflicting stock ID or material snapshot blocks the entire file. No name/dimension matching, ID remapping, replacement, quantity merging or deletion occurs.
- An absent stock ID reserved by project selections, saved-plan sources or inventory history cannot be reintroduced. This prevents restoration of consumed/deleted sources and duplicate offcuts.
- Cutting-generated offcuts are accepted only as identical existing records backed by their original project (or deleted-project audit), plan origin and matching immutable inventory snapshot. Deleted-project offcuts can use retained ledger provenance after their plan payload has been removed. Missing or modified offcuts cannot be recreated from this file.

Failures leave all existing data unchanged. Correct the reported dependency/conflict and retry. Identical records can be replayed safely without stock movements. Existing movement history, project selections, cutting results and reconciliation state are never modified by import/export; imports do not fabricate cutting movements.

## Backup limitations

This is **not a complete application backup**. Files exclude catalog products/suppliers, projects, cutting trees, movement receipts, project stock ledgers, PDFs and images. Material snapshots are dependency checks, not catalog imports. The file cannot restore project-generated stock/history to an empty installation or undo consumption in another project. These scenarios are rejected rather than guessing or resetting provenance. Transfer matching catalog dependencies separately before importing independent manual/purchased stock.
