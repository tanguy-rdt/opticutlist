/** Editorial order and short labels; paths retain their existing public Wiki URLs. */
export const WIKI_NAVIGATION = [
  { title: 'Start here', pages: [['getting-started.md', 'Getting started'], ['features.md', 'Application & UI']] },
  { title: 'Architecture & domain', pages: [['architecture.md', 'Architecture'], ['domain-model.md', 'Domain & business rules']] },
  { title: 'Data & persistence', pages: [['persistence-and-json.md', 'Persistence overview'], ['storage.md', 'IndexedDB reference']] },
  { title: 'Optimization & inventory', pages: [['optimization.md', 'Optimization engine'], ['stock-management.md', 'Stock & offcuts']] },
  { title: 'Cutting plans & PDF', pages: [['pdf-generation.md', 'PDF pipeline & rendering']] },
  { title: 'Import & compatibility', pages: [['json-formats.md', 'JSON formats'], ['parts-json.md', 'Parts import'], ['stock-json-format.md', 'Stock exchange']] },
  { title: 'Development & reference', pages: [['workflows.md', 'Workflow traces'], ['testing.md', 'Testing'], ['maintenance.md', 'Safe contributions'], ['wiki-publishing.md', 'Wiki authoring & publishing']] },
] as const
