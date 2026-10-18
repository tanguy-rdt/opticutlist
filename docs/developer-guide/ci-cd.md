# CI/CD & releases

[Documentation home](../README.md) / [Developer Guide](README.md) / Development & reference

Exactly two native GitHub Actions workflows own automation: [CI](../../.github/workflows/ci.yml) validates changes; [CD](../../.github/workflows/cd.yml) has four independent jobs for Pages deployment, GHCR images, standalone release archives and Wiki publication. Their triggers, conditions and shell checks are defined directly in YAML.

## Event routing

| Event | CI | Pages | Docker / GHCR | Standalone archive | Wiki |
| --- | --- | --- | --- | --- | --- |
| Application-only push to master | Validate | Never | Never | Never | Never |
| Relevant documentation/publisher push to master | Validate | Never | Never | Never | Validate and publish changed content |
| Valid stable version tag push | No branch-triggered run | Verify, validate, build, deploy | Verify, validate, build, publish | Build, smoke-test, attach | Never |
| Valid SemVer prerelease tag push | No branch-triggered run | Never | Verify, validate, build, publish | Build, smoke-test, attach | Never |
| Invalid version tag push | No branch-triggered run | Reject or do not trigger | Reject or do not trigger | Reject or do not trigger | Never |
| PR targeting master | Validate | Never | Never | Never | Never |
| Manual CI run | Validate | Never | Never | Never | Never |

CD uses native push filters: `master`, `v*` tags, and documentation/publisher paths. GitHub does not evaluate path filters for tag pushes, so the documentation filter cannot suppress a release tag. See [GitHub's workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpushpull_requestpull_request_targetpathspaths-ignore).

Wiki-relevant paths are `docs/**`, `scripts/wiki/**`, `.github/workflows/cd.yml`, `package.json` and `package-lock.json`. Job conditions separate tag pushes from master pushes and exclude deleted refs. CD has no pull-request or manual-dispatch trigger. Native GitHub path filtering has its documented changed-file limits; inspect the workflow run when a very large push appears to skip documentation publication.

## Pages release procedure

1. Merge the intended release commit into `master` and check CI.
2. Choose a stable version tag such as `v1.0.0`, pointing to that commit. A maintainer publishes the tag through the normal release process; local agents do not push tags or trigger deployments.
3. The Pages job checks out the exact event SHA with full history. Inline Bash rejects invalid tags, checks agreement between HEAD/event/tag, and requires ancestry in `origin/master` before dependency installation.
4. That checkout runs `npm ci`, lint, typecheck, unit tests and production build. Only then do the official Pages actions upload `dist` and deploy it to the existing `github-pages` environment.

Pages requires stable tags containing three decimal integers without leading zeros except zero itself, and no prerelease/build suffix. GHCR additionally accepts a hyphen followed by nonempty dot-separated SemVer prerelease identifiers: ASCII letters, digits and hyphens, with no leading zeros in numeric-only identifiers. Build metadata is outside the release policy and remains rejected. See [SemVer prerelease rules](https://semver.org/#spec-item-9). Lightweight and annotated tags are supported. Unmerged commits and mismatched revisions fail validation. A newer master revision never replaces the tagged build source. No package-version synchronization or GitHub Release creation is automated.

Vite's `/opticutlist/` base, Vue Router hash routing and static assets are unchanged. Branch pushes, PRs and documentation updates cannot deploy Pages.

## Docker image publication

The independent `docker` job uses the same inline release-validation block as Pages, shared by a native YAML anchor (`verify-release`). Both jobs check out the exact event SHA with full history and disabled persisted credentials, validate the supported SemVer forms and verify HEAD/event/tag agreement plus `origin/master` ancestry. Pages additionally excludes hyphenated tags at the job boundary, so valid prereleases publish only to GHCR. The shared validator rejects malformed non-prerelease candidates before Pages can deploy. An invalid or unmerged tag fails before registry login. No extra workflow, routing script or intermediary job is needed. Pages and Docker have no `needs` dependency, so either distribution can succeed when the other fails.

After `npm ci`, lint, typecheck and the full unit suite, maintained Docker actions generate metadata, set up QEMU/Buildx, authenticate to `ghcr.io` with the built-in `GITHUB_TOKEN`, and build/push the root checkout using `context: .` and `file: ./docker/Dockerfile`. The Dockerfile itself builds the server-storage frontend and Node backend; browser Pages storage stays IndexedDB. Runtime dependencies, non-root execution, `/data`, origin protection and healthcheck are unchanged.

`docker/metadata-action` lowercases `ghcr.io/${{ github.repository }}` and emits only the full SemVer (`type=semver,pattern={{version}}`, `flavor: latest=false`). For this repository, `v1.2.3` maps to **`ghcr.io/tanguy-rdt/opticutlist:1.2.3`** and `v1.1.0-beta.2` maps to **`ghcr.io/tanguy-rdt/opticutlist:1.1.0-beta.2`**. `v1.1.0-beta` and `v1.1.0-rc.1` are also accepted; `v01.1.0`, `v1.1`, `v1.1.0-beta.02`, `v1.1.0-` and `v1.1.0+build` cannot publish. No floating or branch aliases are generated. OCI labels identify the actual source repository, release version/revision, package description and GPL-3.0-only license.

The build targets `linux/amd64` and `linux/arm64` in one Buildx publication, with ARM64 emulation on the hosted runner. Node provides SQLite directly; the lockfile includes Linux x64/ARM64 prebuilt build-tool packages. The final versioned multi-platform image requires both builds to succeed. These are configured targets, not a claim that cross-platform builds or GHCR publication have already run locally. Verify the successful Actions run and registry platform manifest before advertising a particular published release.

To make releases anonymously installable, open the owner's **Packages → opticutlist → Package settings → Change visibility → Public** after first publication. Packages may initially be private even for a public source repository. Confirm that the package is connected to this repository and that its Actions access permits this repository to write. Organization package policies can also restrict publication. No personal access token or visibility-changing API script is used. See [GitHub Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

Existing release tags are not backfilled automatically by adding this workflow. A maintainer must publish a new intended release tag through the established release process; this implementation task does not create/push tags or publish images. Do not repoint a release tag to ship different source under the same version. See [Docker and Portainer installation](deployment.md#standalone-docker-deployment) for pulls, configuration, backups and upgrades.

## Standalone release archives

The independent `standalone` job reuses `verify-release` for stable and SemVer prerelease tags, exact checkout and `origin/master` ancestry. It runs the existing checks, invokes `npm run package:self-hosted -- "$GITHUB_REF_NAME"`, then runs the extracted-archive tests against that exact artifact through `OCL_TEST_ARCHIVE`. Only after success does GitHub CLI attach `dist-standalone/opticutlist-TAG-self-hosted.tar.gz` to the corresponding GitHub Release. Missing releases are created with `--verify-tag` (never creating a tag), with prerelease status for hyphenated tags. Existing release metadata is preserved; reruns replace only the same named archive asset.

Only this job has `contents: write`. The built-in token reaches only the final release step; no PAT, new workflow or application service is introduced. Pages, GHCR and Wiki have no dependency on archive publication. No release is created/published during local validation.

The packager stages an explicit runtime allowlist in a temporary directory and uses the existing `tar` tool for `.tar.gz`. It includes no Node binary, database, source checkout, dev toolchain or native npm module. It checks compiled imports so a new SSR dependency must be deliberately packaged. Archive tests run independently with only bundled Zod, a writable external home/data directory and the host's Node 24+ runtime. Local verification covers macOS ARM64; the hosted release job gates attachment on the same tests on Linux x64. Windows and other combinations remain unverified. See [installation and upgrades](deployment.md#standalone-archive).

For a local artifact (no publication):

```sh
npm run package:self-hosted -- local
OCL_TEST_ARCHIVE="$PWD/dist-standalone/opticutlist-local-self-hosted.tar.gz" npm run test:unit -- scripts/self-hosted/__tests__
```

## Settings and security

- **Pages source:** GitHub Actions.
- **Environment:** retain `github-pages`, its protection/reviewer rules and permission for `v*` release tags. A master-only deployment rule blocks releases.
- **Permissions:** workflows default to read-only contents. Only Pages receives `pages: write` and `id-token: write`; only Docker receives `packages: write` alongside `contents: read`; only standalone release attachment receives `contents: write`. The built-in token authenticates registry login, without entering npm commands or image build arguments; no new secret/PAT is needed.
- **Wiki secret:** retain `WIKI_PUBLISH_TOKEN`; see [Wiki authentication](wiki-publishing.md#configure-authentication). No new credentials are required.
- **Wiki setup:** enable and initialize the separate Wiki repository; preserve/rename conflicting manual Home/sidebar pages before first publication.

Wiki parsing, validation, ownership checks and commits run without its token. Only clone/push steps receive it through the existing `GIT_ASKPASS` helper. Asset allowlists, path checks, the manifest and manual-page safeguards are unchanged. Pages, Docker, standalone archives and Wiki have separate concurrency groups and no dependencies on one another. Docker publication serializes per release ref; registry logout is handled by the login action. No registry credential is passed as a Docker build argument, secret or image label.

## Troubleshooting and local checks

| Symptom | Check |
| --- | --- |
| No Pages run | Push a `v*` tag; branch and PR events cannot deploy |
| Tag validation fails | Use a supported stable/prerelease tag, without leading-zero numeric identifiers or build metadata; inspect revision agreement and master ancestry |
| Pages waits or refuses deployment | Environment reviewers/tag restrictions and Pages source |
| Validation fails | Fix the source through the normal reviewed release process; never bypass checks |
| GHCR publication denied / anonymous pull fails | Repository package-write policy, package Actions access, and Public visibility; do not add a PAT workaround |
| ARM64 build fails | Inspect the QEMU/Buildx build log and locked native package availability; do not publish a falsely advertised platform |
| Wiki skipped | Relevant paths changed on master; inspect GitHub's native path-filter limits |
| Wiki initialization/authentication error | Follow [Wiki troubleshooting](wiki-publishing.md#troubleshooting), then rerun the original documentation-push job |

```sh
npm run test:unit -- scripts/wiki/__tests__
node scripts/wiki/cli.ts --validate --source . --repository OWNER/REPO --branch master
```

Validate YAML, embedded Bash and event conditions before committing workflow changes. Run lint, typecheck and build. Local checks must not invoke deployment actions or authenticated Wiki operations.

---

**Continue exploring:** [Wiki authoring & publishing](wiki-publishing.md) · [Testing](testing.md) · [Documentation home](../README.md)
