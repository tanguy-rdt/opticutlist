/** Editorial order and short labels; existing technical paths keep their public Wiki URLs. */
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
      ['developer-guide.md', 'Reference index'],
      ['getting-started.md', 'Developer setup'],
      ['architecture.md', 'Architecture'],
      ['domain-model.md', 'Domain & business rules'],
      ['features.md', 'Application & UI'],
      ['workflows.md', 'Workflow traces'],
      ['optimization.md', 'Optimization engine'],
      ['stock-management.md', 'Stock lifecycle'],
      ['persistence-and-json.md', 'Persistence overview'],
      ['storage.md', 'Storage internals & API'],
      ['deployment.md', 'Deployment & operations'],
      ['json-formats.md', 'JSON compatibility'],
      ['parts-json.md', 'Parts file reference'],
      ['stock-json-format.md', 'Stock file reference'],
      ['pdf-generation.md', 'PDF rendering'],
      ['testing.md', 'Testing'],
      ['maintenance.md', 'Safe contributions'],
      ['ci-cd.md', 'CI & releases'],
      ['wiki-publishing.md', 'Wiki publishing'],
    ]
  },
] as const
