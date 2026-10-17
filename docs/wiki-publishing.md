# Wiki authoring & publishing

[Documentation home](README.md) / Development & reference

The main repository's `docs/` directory is the only source of truth. [cd.yml](../.github/workflows/cd.yml) generates a separate Wiki checkout; it never moves/deletes source documentation or changes the application. Publication requires the one-time GitHub setup below. No publication is performed by local generation/tests.

**On this page:** [Enable and initialize the Wiki](#enable-and-initialize-the-wiki) · [Configure authentication](#configure-authentication) · [Managed files, names and links](#managed-files-names-and-links) · [Publication security rules](#publication-security-rules) · [Test without publishing](#test-without-publishing) · [Troubleshooting](#troubleshooting)

## Enable and initialize the Wiki

1. In the main repository, enable **Settings → General → Features → Wikis**. Restrict Wiki editing to collaborators.
2. Open **Wiki** and save an initial page. GitHub does not create the cloneable Wiki Git repository until the first page exists. See [GitHub's Wiki Git instructions](https://docs.github.com/en/communities/documenting-your-project-with-wikis/adding-or-editing-wiki-pages).
3. Reserve `Home.md` and `_Sidebar.md` for automation. If initialization creates Home, preserve any content by moving it to a different page (for example `Manual-notes`), then remove the original Home page before the first run. Likewise preserve/rename an existing manual sidebar. The publisher refuses to take over unowned files, even if their names match generated output.
4. Keep unrelated manual pages under other names. Avoid the `Docs-` page prefix, `_assets/opticutlist-docs/` and the manifest name below.

Wiki Git is separate from the main repository: `https://github.com/OWNER/REPO.wiki.git`. Its actual default branch is discovered from the clone; the workflow does not assume that it matches the main repository's branch. Only that Wiki branch is pushed, with normal fast-forward semantics.

## Configure authentication

Create a repository Actions secret named **`WIKI_PUBLISH_TOKEN`** under **Settings → Secrets and variables → Actions**. The credential's account must have write access to this repository/Wiki. Keep an expiry/rotation schedule and apply organization approval/SSO requirements where relevant. Do not put tokens in source, Git URLs or workflow inputs.

### Preferred: a dedicated fine-grained token, where Wiki Git accepts it

In GitHub personal access token settings:

- Resource owner: the owner of this repository (`tanguy-rdt` for the current upstream).
- Repository access: **Only select repositories → opticutlist**; select the main repository, not a fictitious `.wiki` repository entry.
- Repository permissions: **Contents: Read and write**; Metadata read access is included by GitHub. No Actions, Workflows, Administration or organization-wide permissions are required by this workflow.
- Set an expiration; obtain approval if the organization requires it.

GitHub recommends fine-grained tokens where supported, but its general permission documentation does not establish Wiki-specific Git access for every account/organization/token scenario. This task does not test a live Wiki credential. Confirm the token against the initialized Wiki by a maintainer-triggered workflow run after setup; a successful public clone alone does not prove push permission. See [GitHub token guidance and limitations](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).

### Explicit alternative when fine-grained Wiki access is rejected

Configure the **same secret** with a dedicated classic PAT instead: **`public_repo`** for a public repository, or **`repo`** if the repository/Wiki is private. No `workflow`, admin or unrelated scopes are needed. Classic tokens cannot be scoped to a single repository; prefer a dedicated automation account whose write access is limited to this repository, and honor organization policies/SSO authorization. Review the broader classic scope deliberately rather than adding unrelated permissions to a rejected token. GitHub documents the scope differences in its [scope reference](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps).

The workflow never changes credential type or silently falls back. Missing/expired/rejected credentials fail with setup guidance. `GITHUB_TOKEN` has `contents: read` for the main checkout only and is never used as a Wiki push credential.

Credentials reach Git only through a temporary `GIT_ASKPASS` executable reading the step's secret environment variable. The helper contains no token literal, is removed on exit, and tokens are not stored in remote URLs/Git config or passed as process arguments. Do not enable shell tracing or Git HTTP credential tracing for troubleshooting.

## Triggers and execution

Native CD path filters publish the Wiki for master pushes changing `docs/**`, `scripts/wiki/**`, `.github/workflows/cd.yml` or npm manifests. Path filters do not apply to tag pushes; the independent Pages and Docker jobs handle those. The Wiki job explicitly requires a master push and excludes deleted refs. Pull requests, other branches and version tags never publish the Wiki. Branch renames require updating the YAML guards.

CD has no manual-dispatch trigger. After completing setup or correcting an authentication problem, rerun the Wiki job from the original relevant master-push run. For a local dry run, use the preview command below. See [CI/CD and releases](ci-cd.md).

The job checks out source with persisted credentials disabled, uses Node from `.nvmrc`, installs locked dependencies without lifecycle scripts and runs the publisher tests. It validates the complete documentation before cloning, then generates locally and checks Wiki ownership without the token. It stages changes, commits only if content differs and pushes without force. Only the clone and push steps receive `WIKI_PUBLISH_TOKEN`; the parser, tests and commit step do not. `scripts/wiki/git-auth.sh` provides the temporary askpass helper for each authenticated Git operation. Identical reruns produce no commit. Concurrent automation runs serialize; a competing manual Wiki push causes a safe non-fast-forward failure, requiring a fresh rerun.

## Managed files, names and links

| Output | Source / rule |
| --- | --- |
| `Home.md` | Authored documentation hub from `docs/README.md`, with converted links |
| `_Sidebar.md` | Curated topic groups plus automatic links for new/nested pages |
| `Docs-<path>.md` | Other `.md` / `.markdown` files, named by relative path rather than heading |
| `_assets/opticutlist-docs/docs/...` | Referenced, validated PNG/JPEG/WebP images inside docs only |
| `.opticutlist-docs-manifest.json` | Versioned repository identity and SHA-256 hashes authorizing managed updates/deletions |

Example: `docs/optimization.md` → `Docs-optimization.md`; `docs/guides/setup.md` → `Docs-guides--setup.md`. Each path component is normalized to ASCII letters/numbers and hyphens. Changing a page heading does not change its URL. Ambiguous case/slug collisions fail instead of silently overwriting another page.

Add a Markdown file under docs to publish it automatically. Relative Markdown links, reference definitions and image destinations are rewritten through source offsets from a Markdown parser. Links to docs pages/directories with README become absolute Wiki page URLs, retaining query/anchor suffixes. Links to source code, root guidance or directories outside docs point to `master`, the configured source branch. Copied images/assets use raw Wiki asset URLs. HTTP(S), mailto links and same-page anchors remain unchanged; authenticated URLs and other schemes are rejected. Images must be local.

Fenced code (including Mermaid), indented/inline code, tables, labels and link titles are preserved; the script patches destinations rather than reserializing Markdown. Raw HTML is rejected; use Markdown image/link syntax or fenced examples. This avoids incomplete HTML sanitization. Raw Wiki asset delivery must be accessible to readers; public Wiki assets work without an account, while private deployment/access policies need maintainer verification. Symlinks, missing local link targets and paths outside the repository are rejected.

Renaming/removing a source page updates generated links/navigation and removes the old output **only if the manifest owns it and its content remains unchanged**. Update inbound links when renaming. There are no automatic old-URL redirects; manually maintained aliases can be added under nonconflicting names. An unrelated Wiki page is never deleted just because it is absent from docs. A manually modified managed file blocks publication until its changes are preserved in docs or a separate manual page.

Do not delete or hand-edit the manifest. If it is lost, the publisher refuses existing generated filenames rather than guessing ownership. Recover the tracked manifest from Wiki history, or carefully migrate generated files with a maintainer-reviewed backup before rerunning.

## Navigation and page design

Home is authored in [docs/README.md](README.md); the publisher does not append a duplicate index. Keep its introduction, contributor journey and task links concise. The Wiki sidebar is generated from [navigation.ts](../scripts/wiki/navigation.ts), which defines the topic order and short labels. It uses the existing path-to-page mapping; changing a display title does not rename a Wiki page.

When adding a page, link it from related guides and add its relative docs path to an appropriate sidebar group. Unlisted pages remain discoverable automatically under **More reference** or their nested directory heading, so new documentation is not silently orphaned. Empty curated groups are omitted. Keep filenames stable; reorder display links rather than moving files merely to change navigation.

Technical pages begin with a link home and a short overview. Longer guides provide section jump links; related reading at the bottom connects the next useful topic. Preserve existing heading anchors when reorganizing content. The [getting-started guide](getting-started.md) is introductory, while [storage](storage.md), [JSON contracts](json-formats.md) and [workflow traces](workflows.md) retain detailed implementation references.

Use native Markdown headings, compact tables and fenced code. Mermaid diagrams should stay readable at ordinary Wiki widths; use top-to-bottom flow for long pipelines. No HTML layout, custom styles, decorative image banners or external documentation site is needed.

## Publication security rules

Only `.md` and `.markdown` pages under `docs/` are published as pages. All such pages are intended to be public: do not put private drafts in this directory. Ordinary unreferenced non-Markdown files are not copied. Only explicitly referenced PNG, JPEG (`.jpg`/`.jpeg`) and WebP images within `docs/` are copied. Keep images in a directory such as `docs/assets/` and reference them with `![Panel](assets/panel.png)`; nested pages may use a relative parent path only when it resolves inside docs. Links to repository source code remain GitHub links, never copied assets.

SVG is rejected entirely, including otherwise harmless SVG. Export it to PNG, JPEG or WebP. Remote images, raw HTML, absolute filesystem paths, protocol-relative URLs, encoded traversal, symlinks, hidden source paths and ambiguous/double extensions are rejected. Root guidance and source-code links such as `../ARCHITECTURE.md` and `../src/...` remain supported; they cannot publish those files to the Wiki.

Sensitive filenames (environment/local configuration, credentials, private keys/certificates, dumps, backups, logs and exports) are forbidden even when unreferenced. Rename a legitimate document to an unambiguous name; never rename sensitive data to bypass validation. Unreferenced ordinary assets can remain locally but are not published.

Images must be nonempty, at most 5 MiB and match their extension through simple signature checks: PNG signature/end marker, JPEG start/end markers, or WebP RIFF/WEBP signature and declared file length. These reject obvious disguised files and trailing payloads without maintaining custom chunk, CRC or JPEG scan parsers. They do not guarantee that an image decodes correctly. Ordinary metadata and color profiles are allowed; authors must inspect images and strip private EXIF, comments or other sensitive metadata before committing. Re-export images with mismatched signatures in a supported format. Markdown must be UTF-8 text, not binary or private-key/certificate/dump content. Validation is a publication boundary, not a complete image decoder, secret scanner or steganography detector: review all public text and images before committing.

All source and destination ownership/path validation runs before destination creation/writes. Errors identify the referring document and reason without quoting URL values or file contents. Existing manifest ownership, manual-edit detection and obsolete-page protections still apply. An upgrade removes previously managed assets that are no longer referenced/allowed only when their recorded content is unchanged; manually modified assets block publication.

Use `node scripts/wiki/cli.ts --validate --source . --repository OWNER/REPO --branch DEFAULT_BRANCH` to validate in memory without a Wiki checkout, credentials or writes. Resolve errors in the source document or asset, rerun validation and inspect the local preview before publishing. Do not weaken the allowlist to publish a backup or private export.

## Test without publishing

Use Node 24 from `.nvmrc` and install the existing locked development dependencies:

```sh
npm ci
npm run test:unit -- scripts/wiki/__tests__
node scripts/wiki/cli.ts --source . --destination /tmp/opticutlist-wiki-preview --repository tanguy-rdt/opticutlist --branch master
```

The CLI writes only a local destination separate from the source checkout. It performs no clone, authentication, commit, network request or push. Use a new temporary directory for a first preview; rerun the same command to check idempotency. Inspect generated Home/sidebar/pages/assets and compare Mermaid fences with docs. Change `--repository` and `--branch` for a fork or renamed default branch.

The implementation stays in five small modules: [cli.ts](../scripts/wiki/cli.ts) handles arguments/errors, [publish.ts](../scripts/wiki/publish.ts) converts Markdown and preflights/synchronizes managed files, [navigation.ts](../scripts/wiki/navigation.ts) defines sidebar order, [publication-policy.ts](../scripts/wiki/publication-policy.ts) checks names/text/image signatures, and [git-auth.sh](../scripts/wiki/git-auth.sh) handles authenticated Git only. Image parsing is deliberately limited: contributor review, the referenced-asset allowlist, containment checks and isolated credentials are the security boundaries, not a custom image decoder.

The generator uses one development-only dependency, `mdast-util-from-markdown`, to distinguish real links from code/examples. Node's built-in filesystem/crypto modules and existing Zod validate paths and the managed manifest. No browser, publishing action, global package or system software is required.

## Troubleshooting

| Failure | Check |
| --- | --- |
| Missing `WIKI_PUBLISH_TOKEN` | Exact repository Actions secret spelling and availability |
| Cannot clone Wiki | Wiki enabled and initialized, account access, token expiry, SSO/organization approval |
| Clone succeeds but push fails | Public clone may be anonymous; verify actual Wiki write permission/token support and concurrent changes |
| Fine-grained credential rejected | Do not assume Contents permission proves Wiki endpoint support; explicitly configure the documented dedicated classic alternative if policy allows |
| Unmanaged Home/sidebar/page collision | Preserve/rename manual content; the first run intentionally refuses takeover |
| Managed file edited manually | Move desired changes back to docs or preserve in an unrelated manual page, then restore the managed file from history |
| Missing link or naming collision | Fix the reported source path/filename in docs; no publication occurs on generation failure |
| Source and destination overlap / symlink error | Use a separate real temporary checkout/directory, not docs or a symlink into it |
| No manual Run workflow control | CD is push-only; rerun the original relevant master-push Wiki job after correcting setup |
| No new Wiki commit | Expected when generated bytes and manifest are unchanged |

[GitHub sidebar conventions](https://docs.github.com/en/communities/documenting-your-project-with-wikis/creating-a-footer-or-sidebar-for-your-wiki) explain the reserved `_Sidebar.md` name. Wiki publication is independent of the application's GitHub Pages deployment and does not modify its build or navigation.

---

**Continue exploring:** [Documentation QA](testing.md#documentation-checks) · [Contribution guidance](maintenance.md) · [Documentation home](README.md)
