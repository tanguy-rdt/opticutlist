# Parts JSON exchange (version 1)

Parts → **Export JSON** downloads `<project-name>-parts.json` as readable UTF-8 JSON.
Parts → **Import JSON** validates a file, previews its rows and requires confirmation.
Import appends new Parts; it never overwrites existing Parts or creates materials.

## Complete example

```json
{
  "format": "opticutlist-parts",
  "version": 1,
  "parts": [
    {
      "name": "Cabinet side",
      "material": "Birch plywood",
      "length": 720,
      "width": 560,
      "thickness": 18,
      "quantity": 2,
      "grainDirection": "length",
      "rotation": "forbidden"
    },
    {
      "name": "Shelf",
      "material": "Birch plywood",
      "length": 524,
      "width": 500,
      "thickness": 18,
      "quantity": 3,
      "grainDirection": "none",
      "rotation": "allowed"
    }
  ]
}
```

## Contract

All fields shown above are required. Unknown properties are rejected. There are no
optional properties in version 1.

| Field | Meaning and validation |
| --- | --- |
| `format` | Exactly `opticutlist-parts`. |
| `version` | JSON number `1`; unsupported versions are rejected. |
| `parts` | Array of part definitions; an empty array is valid. Duplicate names are allowed. |
| `name` | Non-empty string, trimmed, at most 200 characters. |
| `material` | Human-readable material label, with the same string limits. Not a database ID or a material definition. |
| `length`, `width`, `thickness` | Finite, strictly positive JSON numbers, in millimeters. Nominal, unrotated finished dimensions; width need not be the shorter side. |
| `quantity` | Positive safe integer (at most 9007199254740991). |
| `grainDirection` | `none`, `length` or `width`, relative to the nominal part axes. |
| `rotation` | `allowed` or `forbidden`, permission for a 90-degree in-plane rotation; grain and exact material/thickness compatibility still govern placement. |

The file contains no project/database IDs, catalogue entities, stock, plans or UI
state. CAD exporters should convert their units to millimeters and export original
part dimensions rather than rotated cutting placements. Numbers must be numbers,
not strings. Do not append undocumented metadata to version 1.

Before importing, choose project materials or eligible catalogue/stock panels in
Materials. Import proposes a material only when its exact label matches exactly
one eligible project Material. Missing or ambiguous labels require an explicit
per-row material choice in the preview. No material is inferred from dimensions,
stock provenance or preset texture. Own-project offcuts never qualify. Identical
material names cannot convey database identity: review these mappings explicitly.

Every imported Part gets a new internal ID. Importing a file twice intentionally
adds two batches; it is not a synchronization/update format. Validation and all
Part/ownership writes run through the existing project rules in one atomic
transaction. A failure leaves the complete batch unapplied. Existing direct
material choices remain valid, and exact thickness matching during optimization
is unchanged.
