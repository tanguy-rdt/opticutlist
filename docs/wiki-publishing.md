# Publishing developer documentation to GitHub Wiki

The main repository's `docs/` directory is the only source of truth. [publish-wiki.yml](../.github/workflows/publish-wiki.yml) generates a separate Wiki checkout; it never moves/deletes source documentation or changes the application. Publication requires the one-time GitHub setup below. No publication is performed by local generation/tests.

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

Automatic runs are scheduled by pushes changing `docs/**`, `scripts/wiki/**`, the publishing workflow or npm manifests. A dynamic job guard permits publication **only on the main repository's current default branch**. Other branch events/manual selections are skipped; there is no pull-request trigger or `pull_request_target` use. This avoids hardcoding `master` and continues to enforce the boundary after a default-branch rename.

Manual execution: **Actions → Publish developer Wiki → Run workflow**, selecting the default branch. This publishes; use the local preview command below when publication is not intended. The workflow must already exist on the default branch for manual dispatch to be available.

The job checks out source with persisted credentials disabled, uses Node from `.nvmrc`, installs locked dependencies without lifecycle scripts and runs the publisher tests. It validates the complete documentation before cloning, then generates locally and checks Wiki ownership without the token. It stages changes, commits only if content differs and pushes without force. Only the clone and push steps receive `WIKI_PUBLISH_TOKEN`; the parser, tests and commit step do not. `scripts/wiki/git-auth.sh` provides the temporary askpass helper for each authenticated Git operation. Identical reruns produce no commit. Concurrent automation runs serialize; a competing manual Wiki push causes a safe non-fast-forward failure, requiring a fresh rerun.

## Managed files, names and links

| Output | Source / rule |
| --- | --- |
| `Home.md` | Converted `docs/README.md`, plus complete generated navigation |
| `_Sidebar.md` | Grouped links to every Markdown page, including nested directories |
| `Docs-<path>.md` | Other `.md` / `.markdown` files, named by relative path rather than heading |
| `_assets/opticutlist-docs/docs/...` | Referenced, validated PNG/JPEG/WebP images inside docs only |
| `.opticutlist-docs-manifest.json` | Versioned repository identity and SHA-256 hashes authorizing managed updates/deletions |

Example: `docs/optimization.md` → `Docs-optimization.md`; `docs/guides/setup.md` → `Docs-guides--setup.md`. Each path component is normalized to ASCII letters/numbers and hyphens. Changing a page heading does not change its URL. Ambiguous case/slug collisions fail instead of silently overwriting another page.

Add a Markdown file under docs to publish it automatically. Relative Markdown links, reference definitions and image destinations are rewritten through source offsets from a Markdown parser. Links to docs pages/directories with README become absolute Wiki page URLs, retaining query/anchor suffixes. Links to source code, root guidance or directories outside docs point to the main repository's default branch. Copied images/assets use raw Wiki asset URLs. HTTP(S), mailto links and same-page anchors remain unchanged; authenticated URLs and other schemes are rejected. Images must be local.

Fenced code (including Mermaid), indented/inline code, tables, labels and link titles are preserved; the script patches destinations rather than reserializing Markdown. Raw HTML is rejected; use Markdown image/link syntax or fenced examples. This avoids incomplete HTML sanitization. Raw Wiki asset delivery must be accessible to readers; public Wiki assets work without an account, while private deployment/access policies need maintainer verification. Symlinks, missing local link targets and paths outside the repository are rejected.

Renaming/removing a source page updates generated links/navigation and removes the old output **only if the manifest owns it and its content remains unchanged**. Update inbound links when renaming. There are no automatic old-URL redirects; manually maintained aliases can be added under nonconflicting names. An unrelated Wiki page is never deleted just because it is absent from docs. A manually modified managed file blocks publication until its changes are preserved in docs or a separate manual page.

Do not delete or hand-edit the manifest. If it is lost, the publisher refuses existing generated filenames rather than guessing ownership. Recover the tracked manifest from Wiki history, or carefully migrate generated files with a maintainer-reviewed backup before rerunning.

## Publication security rules

Only `.md` and `.markdown` pages under `docs/` are published as pages. All such pages are intended to be public: do not put private drafts in this directory. Ordinary unreferenced non-Markdown files are not copied. Only explicitly referenced PNG, JPEG (`.jpg`/`.jpeg`) and WebP images within `docs/` are copied. Keep images in a directory such as `docs/assets/` and reference them with `![Panel](assets/panel.png)`; nested pages may use a relative parent path only when it resolves inside docs. Links to repository source code remain GitHub links, never copied assets.

SVG is rejected entirely, including otherwise harmless SVG. Export it to PNG, JPEG or WebP. Remote images, raw HTML, absolute filesystem paths, protocol-relative URLs, encoded traversal, symlinks, hidden source paths and ambiguous/double extensions are rejected. Root guidance and source-code links such as `../ARCHITECTURE.md` and `../src/...` remain supported; they cannot publish those files to the Wiki.

Sensitive filenames (environment/local configuration, credentials, private keys/certificates, dumps, backups, logs and exports) are forbidden even when unreferenced. Rename a legitimate document to an unambiguous name; never rename sensitive data to bypass validation. Unreferenced ordinary assets can remain locally but are not published.

Images must be at most 5 MiB and have matching PNG/JPEG/WebP container structure. PNG chunks include CRC validation; image metadata, trailing payloads and unsupported container features are rejected. Re-export rejected images without EXIF, comments, color profiles or other metadata. Markdown must be UTF-8 text, not binary or private-key/certificate/dump content. Validation is a publication boundary, not a complete image decoder, secret scanner or steganography detector: review all public text and images before committing.

All source validation runs before destination creation/writes. Errors identify the referring document and reason without quoting URL values or file contents. Existing manifest ownership, manual-edit detection and obsolete-page protections still apply. An upgrade removes previously managed assets that are no longer referenced/allowed only when their recorded content is unchanged; manually modified assets block publication.

Use `node scripts/wiki/cli.ts --validate --source . --repository OWNER/REPO --branch DEFAULT_BRANCH` to validate in memory without a Wiki checkout, credentials or writes. Resolve errors in the source document or asset, rerun validation and inspect the local preview before publishing. Do not weaken the allowlist to publish a backup or private export.

## Test without publishing

Use Node 24 from `.nvmrc` and install the existing locked development dependencies:

```sh
npm ci
npm run test:unit -- scripts/wiki/__tests__/publish.spec.ts
node scripts/wiki/cli.ts --source . --destination /tmp/opticutlist-wiki-preview --repository tanguy-rdt/opticutlist --branch master
```

The CLI writes only a local destination separate from the source checkout. It performs no clone, authentication, commit, network request or push. Use a new temporary directory for a first preview; rerun the same command to check idempotency. Inspect generated Home/sidebar/pages/assets and compare Mermaid fences with docs. Change `--repository` and `--branch` for a fork or renamed default branch.

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
| Manual run skipped | Select the default branch, not a feature branch |
| No new Wiki commit | Expected when generated bytes and manifest are unchanged |

[GitHub sidebar conventions](https://docs.github.com/en/communities/documenting-your-project-with-wikis/creating-a-footer-or-sidebar-for-your-wiki) explain the reserved `_Sidebar.md` name. Wiki publication is independent of the application's GitHub Pages deployment and does not modify its build or navigation.
