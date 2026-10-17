# CI/CD & releases

[Documentation home](README.md) / Development & reference

Exactly two native GitHub Actions workflows own automation: [CI](../.github/workflows/ci.yml) validates changes; [CD](../.github/workflows/cd.yml) has two independent jobs for Pages and Wiki publication. Their triggers, conditions and shell checks are defined directly in YAML.

## Event routing

| Event | CI | Pages | Wiki |
| --- | --- | --- | --- |
| Application-only push to master | Validate | Never | Never |
| Relevant documentation/publisher push to master | Validate | Never | Validate and publish changed content |
| Valid stable version tag push | No branch-triggered run | Verify, validate, build, deploy | Never |
| Invalid version tag push | No branch-triggered run | Reject or do not trigger | Never |
| PR targeting master | Validate | Never | Never |
| Manual CI run | Validate | Never | Never |

CD uses native push filters: `master`, `v*` tags, and documentation/publisher paths. GitHub does not evaluate path filters for tag pushes, so the documentation filter cannot suppress a release tag. See [GitHub's workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpushpull_requestpull_request_targetpathspaths-ignore).

Wiki-relevant paths are `docs/**`, `scripts/wiki/**`, `.github/workflows/cd.yml`, `package.json` and `package-lock.json`. Job conditions separate tag pushes from master pushes and exclude deleted refs. CD has no pull-request or manual-dispatch trigger. Native GitHub path filtering has its documented changed-file limits; inspect the workflow run when a very large push appears to skip documentation publication.

## Pages release procedure

1. Merge the intended release commit into `master` and check CI.
2. Choose a stable version tag such as `v1.0.0`, pointing to that commit. A maintainer publishes the tag through the normal release process; local agents do not push tags or trigger deployments.
3. The Pages job checks out the exact event SHA with full history. Inline Bash rejects invalid tags, checks agreement between HEAD/event/tag, and requires ancestry in `origin/master` before dependency installation.
4. That checkout runs `npm ci`, lint, typecheck, unit tests and production build. Only then do the official Pages actions upload `dist` and deploy it to the existing `github-pages` environment.

Stable tags contain three decimal integers without leading zeros except zero itself, and no prerelease/build suffix. Lightweight and annotated tags are supported. Unmerged commits and mismatched revisions fail validation. A newer master revision never replaces the tagged build source. No package-version synchronization or GitHub Release creation is automated.

Vite's `/opticutlist/` base, Vue Router hash routing and static assets are unchanged. Branch pushes, PRs and documentation updates cannot deploy Pages.

## Settings and security

- **Pages source:** GitHub Actions.
- **Environment:** retain `github-pages`, its protection/reviewer rules and permission for `v*` release tags. A master-only deployment rule blocks releases.
- **Permissions:** workflows default to read-only contents. Only the Pages job receives `pages: write` and `id-token: write`.
- **Wiki secret:** retain `WIKI_PUBLISH_TOKEN`; see [Wiki authentication](wiki-publishing.md#configure-authentication). No new credentials are required.
- **Wiki setup:** enable and initialize the separate Wiki repository; preserve/rename conflicting manual Home/sidebar pages before first publication.

Wiki parsing, validation, ownership checks and commits run without its token. Only clone/push steps receive it through the existing `GIT_ASKPASS` helper. Asset allowlists, path checks, the manifest and manual-page safeguards are unchanged. Pages and Wiki have separate concurrency groups and no job dependencies on one another.

## Troubleshooting and local checks

| Symptom | Check |
| --- | --- |
| No Pages run | Push a `v*` tag; branch and PR events cannot deploy |
| Tag validation fails | Use exact `vMAJOR.MINOR.PATCH`; inspect revision agreement and master ancestry |
| Pages waits or refuses deployment | Environment reviewers/tag restrictions and Pages source |
| Validation fails | Fix the source through the normal reviewed release process; never bypass checks |
| Wiki skipped | Relevant paths changed on master; inspect GitHub's native path-filter limits |
| Wiki initialization/authentication error | Follow [Wiki troubleshooting](wiki-publishing.md#troubleshooting), then rerun the original documentation-push job |

```sh
npm run test:unit -- scripts/wiki/__tests__
node scripts/wiki/cli.ts --validate --source . --repository OWNER/REPO --branch master
```

Validate YAML, embedded Bash and event conditions before committing workflow changes. Run lint, typecheck and build. Local checks must not invoke deployment actions or authenticated Wiki operations.

---

**Continue exploring:** [Wiki authoring & publishing](wiki-publishing.md) · [Testing](testing.md) · [Documentation home](README.md)
