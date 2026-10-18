/** Editorial order and short labels for the two documentation trees. */
export const WIKI_NAVIGATION = [
  {
    title: 'User Guide',
    pages: [
      ['user-guide/README.md', 'Start here'],
      ['user-guide/installation.md', 'Install & update'],
      ['user-guide/projects.md', 'Projects'],
      ['user-guide/materials.md', 'Materials & panels'],
      ['user-guide/parts.md', 'Parts'],
      ['user-guide/optimization.md', 'Optimization'],
      ['user-guide/cutting-plans.md', 'Cutting plans & PDF'],
      ['user-guide/stock.md', 'Stock & offcuts'],
      ['user-guide/files.md', 'Import & export'],
    ]
  },
  {
    title: 'Developer Guide',
    pages: [
      ['developer-guide/README.md', 'Reference index'],
      ['developer-guide/getting-started.md', 'Developer setup'],
      ['developer-guide/architecture.md', 'Architecture'],
      ['developer-guide/domain-model.md', 'Domain & business rules'],
      ['developer-guide/features.md', 'Application & UI'],
      ['developer-guide/workflows.md', 'Workflow traces'],
      ['developer-guide/optimization.md', 'Optimization engine'],
      ['developer-guide/stock-management.md', 'Stock lifecycle'],
      ['developer-guide/persistence-and-json.md', 'Persistence overview'],
      ['developer-guide/storage.md', 'Storage internals & API'],
      ['developer-guide/deployment.md', 'Deployment & operations'],
      ['developer-guide/json-formats.md', 'JSON compatibility'],
      ['developer-guide/parts-json.md', 'Parts file reference'],
      ['developer-guide/stock-json-format.md', 'Stock file reference'],
      ['developer-guide/pdf-generation.md', 'PDF rendering'],
      ['developer-guide/testing.md', 'Testing'],
      ['developer-guide/maintenance.md', 'Safe contributions'],
      ['developer-guide/ci-cd.md', 'CI & releases'],
      ['developer-guide/wiki-publishing.md', 'Wiki publishing'],
    ]
  },
] as const
