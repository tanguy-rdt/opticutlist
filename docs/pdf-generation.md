# Cutting plans & PDF

[Documentation home](README.md) / Cutting plans & PDF

PDFs are generated locally with pdf-lib and previewed from the actual bytes with PDF.js. Technical drawings remain vector paths, text, arrows and hatching. Cover images are the only optional user-provided raster content. No screenshot concatenation or external rendering service is involved.

**On this page:** [Boundaries and generation flow](#boundaries-and-generation-flow) · [Document settings and cover](#document-settings-and-cover) · [Page composition](#page-composition) · [Coordinates, scales and supported paper](#coordinates-scales-and-supported-paper) · [Renderer module reference](#renderer-module-reference) · [Output sequence and cleanup ownership](#output-sequence-and-cleanup-ownership)

## Boundaries and generation flow

[cutting-plan-pdf-service.ts](../src/application/export/cutting-plan-pdf-service.ts) defines detached document DTOs and the renderer port. It independently validates trees/global copy accounting before calling infrastructure and returns typed generation failures. [cutting-plan-scene.ts](../src/application/optimization/cutting-plan-scene.ts) derives geometry shared with interactive presentation.

[OptimizationView.vue](../src/ui/pages/OptimizationView.vue) supplies the current accepted displayed layouts, including manual edits, only after result persistence is safe. [CuttingPlansWorkspace.vue](../src/ui/components/optimization/CuttingPlansWorkspace.vue) coordinates current settings, generation, cancellation, preview and output.

```mermaid
flowchart TD
  Current[Validated result and accepted edits] --> Snapshot[Detached application PDF DTO]
  Settings[Project PDF settings] --> Snapshot
  Snapshot --> Pricing[Exact-reference price resolution]
  Pricing --> Renderer[pdf-lib vector renderer]
  Renderer --> Bytes[One generated PDF byte array]
  Bytes --> Preview[Local PDF.js preview]
  Bytes --> Download[Browser download]
  Bytes --> Print[Native PDF viewer tab]
```

Neither preview nor generation/print/download consumes stock. Current-result persistence has already performed inventory reconciliation through a different application boundary.

## Document settings and cover

[PdfSettings](../src/domain/model/pdf-settings.ts) belongs to CuttingProject: optional A4/A3, portrait/landscape, title override, description and cover image. Missing orientation defaults to Portrait at use time. Existing explicit Landscape is preserved, including in project JSON. Settings writes reread the project and serialize through the project service, preserving unrelated selections/ownership.

Document title defaults to project name; override affects PDF cover/metadata, never renames the project. Clearing the override restores fallback. Description is optional, multiline and bounded to 2,000 characters. [cover-page.ts](../src/infrastructure/pdf/cover-page.ts) measures/wraps it in gray italic text, preserves meaningful line breaks and fits only present content as a balanced block. There is no empty image placeholder or obsolete OptiCutList/Cutting plans heading above the title.

[cover-image.ts](../src/infrastructure/pdf/cover-image.ts) validates PNG/JPEG decoding, 2 MB maximum and 40 megapixels. One bounded MIME/base64 payload persists in PDF settings; a transient data URI supplies the sidebar preview. Temporary object URLs are never stored. New selections/removal invalidate obsolete reads. Import schema checks signatures/size, while actual decoding still detects corrupt payloads at generation. Replace/Remove remain recovery options.

The sidebar uses full-width title and four-line textarea, horizontal contained image preview/actions, segmented paper/orientation controls and equal-width Print/Download actions. Scaling is automatic, not an editable field. No drawing settings are persisted in cover image data.

Long text is measured and may shrink within supported readable limits. Impossible cover content produces an actionable shorter-text/larger-paper error rather than clipping or silently discarding it.

## Page composition

[generateProjectCuttingPdf](../src/infrastructure/pdf/cutting-plan-pdf.ts) builds one document in this order:

1. Cover.
2. Fabrication schedules: complete Parts list, materials/purchasing and panel inventory; unplaced demand when present.
3. Individual Part drawing grid pages.
4. One cutting drawing per allocated physical/planning panel, with part-list continuation pages when needed.

Sheet numbers are filled after all pages are generated, including continuation pages. The cover has no technical title block but counts in document page numbering. Part/reference codes derive from document Part order and copy indices; technical pages do not show raw database UUIDs.

### Fabrication schedules

[pdf-table.ts](../src/infrastructure/pdf/pdf-table.ts) measures column widths/text and whole-row heights, repeats headers after page breaks and reserves footer space. Fabrication styling uses grayscale hierarchy: medium-light column headers, bold gray parent panels, white normal/indented child rows and thin separators, without position-based zebra striping. Parents can be kept with the next child where possible.

Purchasing groups allocated source identities and counts actual used panels. [resolveProjectPdfPricing](../src/application/export/project-pdf-pricing.ts) obtains current catalog prices by exact catalog identity or purchase/cutting stock provenance, including safe ancestor traversal. Missing/cyclic/unavailable ancestry cannot establish a price. It never matches material/dimensions or invents historical costs. A consumed source that is absent from the live stock repository can limit ancestry resolution; no price-history reconstruction is implemented.

[purchasing-schedule.ts](../src/infrastructure/pdf/purchasing-schedule.ts) computes known unit totals and currency-separated sums. Unknown remains N/A, never zero. The visual summary is a compact right-aligned **TOTAL:** block; when unknown prices exist the numeric sum is only known prices, even though no “known only” note is printed. It is not a complete purchase valuation or optimizer cost function.

### Individual Part drawings

[part-drawing-grid.ts](../src/infrastructure/pdf/part-drawing-grid.ts) creates two columns with up to three rows, depending on orientation/usable height. Partial pages keep the capacity-derived cell size; they do not stretch one or two drawings to fill the sheet. [part-drawings.ts](../src/infrastructure/pdf/part-drawings.ts) centers each nominal Part drawing with independent fit scale, name/thickness, extension lines, arrows and exact millimetre labels. Thin internal grid rules are lighter than the outer frame.

One shared bottom title block per page shows actual project identity, UNITS / Millimeters (mm), SCALE N/A and final SHEET number. There are no per-Part metadata/title-block tables or large page heading bands. Independent cell scale does not change physical dimensions.

### Cutting panel drawings

[panel-drawing.ts](../src/infrastructure/pdf/panel-drawing.ts) draws the validated panel, placed Parts, true oriented dimensions, grain and waste-only hatching. It reserves dimension clearance and title assembly height before choosing scale. [panel-title-block.ts](../src/infrastructure/pdf/panel-title-block.ts) adds a full-width nomenclature directly above the shared technical strip: panel reference/material with dimensions right-aligned, then indented Part references/names with complete oriented dimensions and thin separators. Source Stock/Catalog provenance is omitted from this label.

Rows use their measured heights; extra Parts continue on paginated detail sheets rather than becoming unreadably small or disappearing. Continuation sheets retain technical settings, scale and numbering. No cutting sequence is inferred from decorative borders.

## Shared technical strip

[technical-title-block.ts](../src/infrastructure/pdf/technical-title-block.ts) is the single four-cell renderer:

`PROJECT | CONTEXT | SCALE | SHEET`

The strip is 52 PDF points high, inside the shared frame (28-point side inset, 36-point bottom). Context width is 145 points; SCALE/SHEET are 72.5 points each; project receives remaining width. Grayscale lines/padding/typography are shared. Project text wraps to at most three lines, with bounded truncation for exceptionally long names. SCALE/SHEET label-value pairs are centered horizontally and vertically; sheet values are deferred and bold.

Schedules and cutting sheets use CUTTING SETTINGS / kerf / edge margin; individual drawings use UNITS. Schedules/individual scales are N/A; cutting drawings use their actual calculated print scale. Only cutting drawings have the adjacent nomenclature assembly.

## Coordinates, scales and supported paper

[pdf-layout.ts](../src/infrastructure/pdf/pdf-layout.ts) converts millimetres to PDF points (72 points/inch) and applies uniform scale with PDF's bottom-up coordinate system. [technical-drawing.ts](../src/infrastructure/pdf/technical-drawing.ts) selects a conventional print scale that fits actual available drawing bounds; drawings are never stretched in one axis. Dimensions report source millimetres, not measurements estimated from pixels.

A4/A3 Portrait and Landscape use the same measured layout helpers. Font/column/row overflow is reported where it cannot safely fit rather than clipping geometry. Printing at Actual size / 100% is required to preserve a labeled physical scale; browser “fit” options can rescale an otherwise correct PDF.

## Preview, download and print resources

[pdf-preview.ts](../src/ui/pdf/pdf-preview.ts) lazily imports PDF.js and uses its Vite-bundled local worker. It passes detached bytes, cancels obsolete loads/renders, cleans pages and destroys obsolete documents/workers. Preview raster canvases are UI output only; the exported bytes stay vector.

Download and Print share the generation pipeline/current configuration and use busy guards/spinners. Browser handoff success shows no toast claiming disk saving. Errors are retryable and use persistent error toasts where appropriate.

[pdf-print-view.ts](../src/ui/pdf/pdf-print-view.ts) opens a tab synchronously from the click to avoid asynchronous popup blocking, clears opener, then embeds the generated Blob URL in a native PDF viewer. Users print there; automatic print dialog behavior is not guaranteed. A blocked/closed tab produces an actionable error. The viewer owns URL cleanup on pagehide and survives SPA workspace navigation once ready; pending tabs close on cancellation/failure.

Download removes its temporary anchor and revokes the URL after a bounded grace period/document exit because browsers expose no reliable download-completion event. Do not revoke an output URL immediately after handing it to a browser consumer.

## Known limits and verification

Built-in Helvetica/WinAnsi does not encode arbitrary Unicode; unsupported text yields an explicit error instead of silently substituted characters. Portrait/landscape structural tests do not replace print QA. Native viewer support, popup policy, device margins and actual print scaling require manual browser/printer verification. Source prices are current references, not recorded acquisition costs. See [PDF regression suites](testing.md#pdf-and-browser-boundaries).

## Renderer module reference

| Module / symbols | Input/output responsibility |
| --- | --- |
| [cutting-plan-pdf-service.ts](../src/application/export/cutting-plan-pdf-service.ts): `prepareProjectPdfDocument`, `panelDocument` | Clone/validate accepted plans, create per-panel scenes/metrics and portable renderer DTOs |
| [project-pdf-pricing.ts](../src/application/export/project-pdf-pricing.ts): `resolveProjectPdfPricing` | Read-only current-reference lookup with per-generation Promise caches and cycle detection |
| [cutting-plan-pdf.ts](../src/infrastructure/pdf/cutting-plan-pdf.ts): `generateProjectCuttingPdf`, `appendFabricationSections`, `finishPdf` | Document order, shared fonts, page assembly and deferred numbering |
| [cover-page.ts](../src/infrastructure/pdf/cover-page.ts): `drawCoverPage` | Measure present cover content, wrap description/title and contain image |
| [pdf-layout.ts](../src/infrastructure/pdf/pdf-layout.ts): `pdfPageSize`, `pdfRect`, `fitPdfPanel` | Paper geometry, uniform coordinate transforms and true kerf extents |
| [technical-drawing.ts](../src/infrastructure/pdf/technical-drawing.ts): `technicalTransform`, `drawDimensions`, `drawWaste`, `drawGrain` | Conventional scales and vector annotation primitives |
| [part-drawing-grid.ts](../src/infrastructure/pdf/part-drawing-grid.ts): `partDrawingCells`, `partDrawingGeometry` | Two-column drawing capacity and independent per-cell fit |
| [panel-title-block.ts](../src/infrastructure/pdf/panel-title-block.ts): `layoutPanelTitleBlock`, `panelPartReference` | Measured nomenclature rows and copy-consistent drawing labels |
| [technical-title-block.ts](../src/infrastructure/pdf/technical-title-block.ts) | One four-cell strip renderer and deferred sheet-number coordinates |
| [pdf-table.ts](../src/infrastructure/pdf/pdf-table.ts): `createPdfTables` | Shared page cursor, column measurement, whole-row breaks and repeated headers |
| [pdf-text.ts](../src/infrastructure/pdf/pdf-text.ts) | Font-measured wrapping/bounded text; no manual character-count clipping |

### Coordinate transformation, explicitly

Domain/canvas geometry uses a panel-corner origin with x along length and y along width. PDF uses bottom-left page coordinates. For source region `(xMm, yMm, lengthMm, widthMm)`, `pdfRect` converts each value to points, uses one scale `s`, and maps:

```text
pdfX      = transform.x + points(xMm) * s
pdfY      = transform.y + (transform.panelHeight - points(yMm) - points(widthMm)) * s
pdfWidth  = points(lengthMm) * s
pdfHeight = points(widthMm) * s
```

`transform.panelHeight` is the full source panel height in points. At scale 1:5, 100 mm becomes about 56.69 PDF points; its dimension label still says 100 mm. A 3 mm kerf becomes about 1.70 points, not a fixed screen-pixel width. Zero-extent kerf is preserved rather than expanded into fictional removed material.

`technicalTransform` searches denominators `1, 2, 5` times powers of ten, never enlarging above 1:1, and selects the first fitting scale. `fitPdfPanel` is the general uniform fit validator/helper, not a second physical size definition. Screen preview zoom changes raster viewing size only, not document scale.

### Measured pagination decisions

Fabrication tables reserve `technicalTitleBlockLayout(...).top + 12` as their bottom boundary. Column minima account for header widths and nonwrapping/numeric values; remaining width is allocated by measured text demand and declared column weight. Every row's wrapped line count determines height. A parent with `keepWithNext` reserves the next row before a break. If one required row group cannot fit even on a new sheet, generation fails with a larger-paper/shorter-text error.

Individual drawings determine row capacity using available page area and measured label needs, capped at three rows/two columns. They create one cell per nominal Part definition, not one per quantity copy. Their production quantities remain represented in schedules/demand; this prevents thousands of identical individual drawing cells. The shared footer scale is N/A because cells fit independently.

Cutting nomenclature measures dimensions first to reserve right alignment, bounds the one-line panel/material label and wraps Part labels. It uses natural row heights and allows visible rows up to a compact target (`min(150 points, pageHeight * 0.22)`), keeping the panel and first child together. Remaining full rows continue in table pages. Technical-strip height is added before fitting the drawing; no individual row is stretched to fill a fixed side block.

Sheet numbering uses final PDF page indices/total count, not estimated drawing counts. A continuation or expanded schedule therefore participates in actual final numbering.

## Output sequence and cleanup ownership

```mermaid
sequenceDiagram
  actor User
  participant UI as CuttingPlansWorkspace
  participant Tab as Native print viewer
  participant Service as CuttingPlanPdfService
  participant Renderer as pdf-lib adapter
  participant Preview as PDF.js adapter
  User->>UI: Print or Download PDF
  alt Print
    UI->>Tab: Open blank tab synchronously
  end
  UI->>UI: Set shared action guard and regenerate revision
  UI->>Service: exportProject(current detached input and settings)
  Service->>Service: Validate copies, geometry and optional pricing
  Service->>Renderer: generateProject(document DTO)
  Renderer-->>Service: Complete PDF bytes
  Service-->>UI: Typed bytes result
  UI->>Preview: Load detached bytes and replace current preview
  alt Still current and Print
    UI->>Tab: Show PDF Blob URL owned by viewer realm
    Tab->>Tab: Revoke URL on pagehide
  else Still current and Download
    UI->>UI: Click temporary anchor and remove element
    UI->>UI: Revoke URL on document exit or bounded grace timer
  else Failure or obsolete request
    UI->>Tab: Close pending print tab when present
    UI->>UI: Error or silent obsolete-result discard
  end
  UI->>UI: Reset loading/action state
```

Generation itself is asynchronous but not cooperatively cancellable inside pdf-lib here; revision checks prevent obsolete bytes from being used after work finishes. PDF.js loading and rendering have their own AbortSignals/cancel/destroy lifetimes. A completed print viewer deliberately outlives SPA component unmount; a pending viewer must not. Download's 60-second fallback is paired with document-exit cleanup, not treated as a reliable browser completion event.

### Pricing consistency boundary

Price enrichment reads exact current product/live Stock references with caches but does not wrap the entire set of lookups in one new database snapshot transaction. Existing explicit validated pricing supplied in the DTO wins. Therefore a document is a validated geometry snapshot with optional current-reference prices, not an immutable accounting valuation. Missing live consumed Stock records can prevent resolving an otherwise historical purchase association; current code does not fall back through ProjectStock consumed snapshots.

This limitation must not be “fixed” by matching dimensions/material, treating unknown as zero or changing saved geometry. A future price-history feature would need its own explicit business contract.

---

**Continue exploring:** [Validated plan inputs](optimization.md) · [PDF regression tests](testing.md#pdf-and-browser-boundaries) · [Documentation home](README.md)
