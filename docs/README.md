# OptiCutList developer documentation

These guides describe the implementation audited on 17 October 2026. Start with the authoritative [agent instructions](../AGENTS.md) and [root architecture decisions](../ARCHITECTURE.md). These guides explain how to navigate the implementation; they do not replace those rules.

## Reading order

1. [Getting started](getting-started.md): environment, commands, repository map and contribution workflow.
2. [Architecture](architecture.md): boundaries, composition, state, routing and discrepancy register.
3. [Domain model](domain-model.md): entities, identities, invariants and ownership.
4. [Features](features.md): current screens and end-to-end workflows.
5. [Optimization](optimization.md): candidate generation, ranking, constraints and editing.
6. [Stock management](stock-management.md): availability, consumption, offcuts, history and deletion.
7. [Persistence and JSON](persistence-and-json.md): stores, transactions and portable formats.
8. [PDF generation](pdf-generation.md): validated document pipeline, rendering and browser output.
9. [Testing](testing.md): regression suites, test doubles and required checks.

Existing focused format references remain canonical examples:

- [Parts JSON import, version 1](parts-json.md).
- [Physical stock JSON exchange, version 1](stock-json-format.md).

## Where to start for maintenance

| Change | Read first | Main implementation entry |
| --- | --- | --- |
| Add a project field | Domain model; persistence and JSON | [cutting-project.ts](../src/domain/model/cutting-project.ts) |
| Change panel selection | Features; stock management | [MaterialsView.vue](../src/features/materials/MaterialsView.vue) |
| Change optimization ranking | Optimization; root architecture | [optimize-project.ts](../src/domain/optimizer/optimize-project.ts) |
| Diagnose inventory conflicts | Stock management | [project-stock-service.ts](../src/application/inventory/project-stock-service.ts) |
| Extend a file format | Persistence and JSON | [application/projects](../src/application/projects/) |
| Change PDF layout | PDF generation | [infrastructure/pdf](../src/infrastructure/pdf/) |
| Add a shared control | Architecture; testing | [shared/ui](../src/shared/ui/) |

## Audit coverage and limits

The audit covered all major `src/` directories: app, application (catalog, export, inventory, optimization, persistence, plans, projects), domain (models, compatibility, geometry, cutting trees, optimizer), every feature directory, infrastructure, shared UI and workers. Configuration, CI, public material manifest and representative unit/integration/regression suites were also inspected. Detailed source links in each guide identify the relevant boundary.

The [discrepancy register](architecture.md#guidance-and-implementation-discrepancies) records older statements that no longer match code. No application behavior or authoritative guidance was changed during this audit.

Source inspection and automated checks cannot establish real printer fidelity, browser-specific native PDF viewer behavior, production GitHub repository settings, storage quotas on individual devices or real-browser visual/accessibility behavior. Those remain manual verification areas. No browser or system software was installed.

## Keeping these guides current

Update the relevant guide when changing a public contract, ownership rule, store version, worker protocol or PDF pipeline. Keep exact schemas in source and link them instead of copying large schemas into prose. Recommendations are explicitly labeled; descriptions without that label refer to current code. Do not turn historical compatibility fields into newly supported UI features simply because they remain in a schema.
