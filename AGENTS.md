# OptiCutList — Agent Instructions

## Mission

Build OptiCutList, an open-source browser application for planning and optimizing rectangular panel cuts, primarily for woodworking. Target one first stable 1.0 release; do not invent intermediate public releases.

## Working Rules

- Read `AGENTS.md` and `ARCHITECTURE.md` before making changes.
- Inspect existing code and configuration before editing.
- Work only on the requested scope; stop after reporting results.
- Prefer simple, readable, maintainable code and strict TypeScript.
- Avoid `any`, unsafe casts, hidden global state, unnecessary dependencies and premature abstractions.
- No backend, authentication, cloud storage, monorepo or microservices unless explicitly approved.
- Do not perform destructive Git operations or commit credentials.
- Ask before changing fundamental architecture or domain invariants.

## Non-Negotiable Domain Rules

- Every `Part`, `SupplierProduct` and `StockItem` has mandatory `lengthMm`, `widthMm` and `thicknessMm` fields; all must be finite and strictly positive.
- Material compatibility and exact thickness equality are required for placement.
- Respect grain direction, permitted rotation, saw kerf, margins and quantities.
- A collision-free layout is not necessarily guillotine-feasible. Independently validate executable plans and their cut trees.
- Supplier products and physically owned stock are distinct concepts.
- Physical stock may only be consumed after explicit confirmation; consumption must be atomic and idempotent.
- Never silently accept invalid plans or silently discard imported data.

## Architecture Boundaries

- Domain: pure TypeScript; no Vue, Pinia, Konva, Dexie or pdf-lib dependencies.
- Application: use cases and ports that coordinate domain behavior.
- Infrastructure: adapters for persistence, import/export and PDF.
- Features: Vue UI; no optimization algorithms or direct IndexedDB access.
- Pinia manages UI state; IndexedDB is the persistent source of truth.
- Run optimization in a Web Worker.
- Enforce dependency direction and avoid circular imports.
- Create modules and directories when needed; avoid empty scaffolding.

## Testing and Quality

- Use ESLint, strict TypeScript, Vitest and Playwright where relevant.
- Test business invariants, invalid inputs, edge cases and regressions.
- Validate external data at runtime using Zod when implementing import/persistence boundaries.
- Do not disable checks to hide errors.
- Before completing a task, run lint, typecheck, relevant tests and production build. Report any checks that could not run.
- Commands: `npm run lint` (zero warnings allowed), `npm run typecheck`, `npm run test:unit`, `npm run build`.
- ESLint uses `typescript-eslint` `strictTypeChecked` and `eslint-plugin-vue` recommended rules; SFCs must use `<script setup lang="ts">`.
- TypeScript also enables `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and unused-symbol checks.
- Place unit tests in `__tests__/*.spec.ts` next to the code under test; import Vitest APIs explicitly (no globals).
- Domain models are Zod schemas with inferred types (`z.infer`); do not declare a parallel interface by hand. Use `z.strictObject` so unknown keys fail instead of being stripped.
- Use the branded ID types from `src/domain/model/ids.ts`; obtain IDs only by parsing through their schema.
- Zod is the only third-party runtime dependency allowed in `src/domain/`.
- Computed, non-persisted domain values (e.g. geometry `Rect`, fit results) may be plain TypeScript types.
- Geometry arithmetic and comparisons go through the micrometre helpers in `src/domain/geometry/units.ts`. Never add, subtract or compare raw millimeter floats, and never introduce ad-hoc epsilons.
- Geometry functions throw `RangeError` for out-of-range numeric input rather than clamping. Expected business outcomes (e.g. "does not fit") are returned as typed issues, never thrown.
- Validators of untrusted structures (e.g. cutting trees) convert numbers with `tryToMicrometres` and report every problem with its location. They must not throw on malformed contents.
- A cutting tree is executable only if `validateCuttingTree` returns `{ valid: true }`. Producers such as the optimizer or the editor must not bypass or duplicate this validator.
- In validator tests, write expected regions as literal coordinates rather than deriving them with the code under test.
- Optimizers must be deterministic: no `Math.random`, clocks or iteration over unordered inputs. Break ties explicitly (e.g. by input order).
- Optimizers return failures as typed `{ ok: false, error }` results and report unplaced parts explicitly; they never drop parts silently.
- Randomized tests use a seeded generator so failures are reproducible.
- Create routers and stores through factories (e.g. `createAppRouter(history)`) so tests can use isolated instances and memory history.

## CI/CD

- GitHub Actions validates every push and pull request with `npm ci`, lint, typecheck, unit tests and build.
- On pushes to the default branch (currently `master`), deploy the validated build to GitHub Pages only after all checks succeed.
- Prefer maintained official GitHub Actions, least-privilege permissions and npm caching.
- Configure Vite's base path for the actual repository and Vue Router hash history for static hosting.
- Document required GitHub repository settings in `README.md`.
- Never deploy a failed build.

## Documentation Maintenance

`AGENTS.md` and `ARCHITECTURE.md` are living documents and must be maintained by the agent.

- Update `AGENTS.md` when coding conventions, agent instructions, development workflows or quality rules change.
- Update `ARCHITECTURE.md` when architecture, module responsibilities, domain models or technical decisions change.
- Make necessary documentation changes within the same task as the code changes; do not wait for a separate request.
- Keep documentation aligned with actual implementation and avoid redundant rewrites.
- Never silently remove or weaken existing requirements.
- Obtain approval before changing fundamental architecture or non-negotiable domain invariants.
- Mention documentation updates in the final task summary.

## Definition of Done

1. Implement only the requested scope.
2. Add or update relevant tests.
3. Run lint, typecheck, tests and build.
4. Update `AGENTS.md` and/or `ARCHITECTURE.md` if needed.
5. Summarize changes, checks, limitations and documentation updates.
6. Stop; do not begin the next task without approval.

## Git Commit Convention

Use Conventional Commits for all commits.

Format:
type(scope): short imperative description

Allowed types:
- feat: new functionality
- fix: bug fix
- refactor: internal restructuring without behavior changes
- perf: performance improvement
- test: tests only
- docs: documentation only
- style: formatting or visual-only changes
- build: build system or dependency changes
- ci: continuous integration and deployment
- chore: maintenance tasks

Rules:
- Use lowercase types and scopes.
- Write commit messages in English.
- Use the imperative mood.
- Do not end the subject with a period.
- Keep the subject concise, ideally under 72 characters.
- Each commit should represent one coherent change.
- Use a scope when it improves clarity.
- Use BREAKING CHANGE in the footer for incompatible changes.
- After completing each task, run all required checks.
- If all checks pass, create a Git commit using Conventional Commits.
- Automatically push the commit to the current working branch.
- Include relevant AGENTS.md and ARCHITECTURE.md updates in the same commit.
- Never commit or push when checks fail.
- Never force-push, amend existing commits or rewrite Git history.
- Never push directly to a protected branch.
- Never include secrets, credentials or unrelated changes.
- If pushing fails, report the error without attempting destructive fixes.
- Report the commit message, commit hash and push status in the final summary.