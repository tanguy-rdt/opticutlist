# OptiCutList

OptiCutList is an open-source browser application for planning and optimizing rectangular panel cuts, primarily for woodworking. Everything runs locally in the browser; there is no backend.

> Status: early development. Only the application shell and tooling exist so far.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the technical design and [`AGENTS.md`](AGENTS.md) for contribution rules.

## Developer documentation

Read the [developer documentation index](docs/README.md) or the [GitHub Wiki](https://github.com/tanguy-rdt/opticutlist/wiki). The Wiki is generated from `docs/` after the [publication setup](docs/wiki-publishing.md) is completed; edit documentation in this repository.

## Requirements

- Node.js 24 (see `.nvmrc`; Node.js 22+ is supported)
- npm 11+

## Development

```sh
npm ci              # install exact locked dependencies
npm run dev         # start the dev server
npm run lint        # ESLint (fails on warnings)
npm run typecheck   # vue-tsc strict type checking
npm run test:unit   # Vitest, single run
npm test            # Vitest, watch mode
npm run build       # production build into dist/
npm run preview     # serve the production build locally
```

The app uses Vue Router hash history (`#/...`), so deep links work on static hosting without server rewrites.

## Continuous Integration and Deployment

`.github/workflows/ci.yml` runs on every push and pull request:

1. `npm ci`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run test:unit`
5. `npm run build`

On a push to the repository's **default branch** (currently `master`), the validated `dist/` is uploaded and a separate `deploy` job publishes it to GitHub Pages. The deploy job depends on the validation job, so a failed check never deploys. Pull requests and other branches are validated only.

### Required GitHub repository settings

1. **Settings → Pages → Build and deployment → Source:** select **GitHub Actions**.
2. **Settings → Environments → `github-pages`:** created automatically on the first deployment. Under *Deployment branches and tags*, allow the default branch (`master`). If you rename the default branch, update this rule too.
3. **Settings → Actions → General → Workflow permissions:** the default *Read repository contents* is sufficient; the workflow requests `pages: write` and `id-token: write` only for the deploy job.
4. Optional: **Settings → Branches** — add a branch protection rule for the default branch requiring the *Lint, typecheck, test and build* check to pass before merging.

The site is served at `https://<owner>.github.io/opticutlist/`.

### Base path

The Vite `base` in `vite.config.ts` is `/opticutlist/`, matching the repository name. If the repository is renamed or deployed to a custom domain at the root, update `base` accordingly (use `/` for a root custom domain).

## License

[GPL-3.0](LICENSE)

Parts JSON import from CAD exporters: see [the version 1 format and example](docs/parts-json.md).

Physical Stock JSON exchange: see [the version 1 format, dependencies and restore limitations](docs/stock-json-format.md).
