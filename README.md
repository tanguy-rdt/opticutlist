![OptiCutList — Smarter cuts. Less waste.](assets/branding/banner.svg)

# OptiCutList

OptiCutList is an open-source tool for planning rectangular panel cuts. Turn a parts list into efficient layouts, keep track of your material and take clear cutting plans to the workshop.

Use it online or run the same application on your own server. Cutting optimization runs in your browser in both modes.

## Get started

### Use online

**[Open OptiCutList in your browser](https://tanguy-rdt.github.io/opticutlist/)**

No installation or account required. Projects, catalogs and stock are stored locally in your current browser using IndexedDB. They are not automatically shared with other browsers or devices.

Export the projects, catalogs and stock you want to preserve or transfer. Clearing browser data can erase your work; these separate JSON exports are not a complete application backup. See [what exports include](docs/persistence-and-json.md#backup-boundaries).

### Self-host OptiCutList

Run OptiCutList on your own server, with a Node.js backend and a shared SQLite database. Devices connecting to that server access the same stored data. Your online browser data stays separate; switching modes does not copy or synchronize it.

Choose [Docker or Portainer](docs/storage.md#standalone-docker-deployment), or follow the [manual installation guide](docs/storage.md#run-the-service). Release automation is configured to publish versioned Docker images at `ghcr.io/tanguy-rdt/opticutlist`; check the guide for release availability before choosing an image version.

> **Self-hosting has no built-in login.** Use a trusted network, private VPN or access-controlled deployment. Do not expose the application directly to the public Internet. Read the [self-hosting security guidance](docs/storage.md#self-hosted-storage).

## Features

- **Organize your projects** — manage parts, materials and supplier panel references in one workflow.
- **Plan efficient cuts** — account for thickness, grain, rotation, saw kerf and edge margins, with an option to prefer panels you already own.
- **Inspect and refine layouts** — explore dimensioned cutting plans, make validated edits, and undo or redo changes.
- **Manage stock and offcuts** — track owned panels and keep reusable offcuts from your cutting plans.
- **Prepare workshop documents** — preview, print or download customizable vector PDFs with fabrication schedules and technical drawings.
- **Transfer your work** — import and export projects, catalogs and stock through JSON files, and import parts lists.

## Documentation

- [Using the application](docs/features.md) — projects, materials, parts and the cutting workflow.
- [Self-hosting with Docker or Portainer](docs/storage.md#standalone-docker-deployment) — setup, persistent storage, backups and upgrades.
- [Exports and backup limitations](docs/persistence-and-json.md#backup-boundaries) — understand what each transfer preserves.
- [Developer Wiki](https://github.com/tanguy-rdt/opticutlist/wiki) — technical guides and reference material, also available in [docs/](docs/README.md).

## Contributing

Bug reports, practical feedback, documentation improvements and code contributions are welcome. Start with the [contribution guide](docs/getting-started.md#contribution-workflow) and [developer documentation](docs/README.md).

## License

Open source under the [GNU General Public License v3.0](LICENSE).
