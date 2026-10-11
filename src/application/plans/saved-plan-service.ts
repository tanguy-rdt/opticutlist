import { savedPlanContentsSchema, savedPlanSummarySchema, type SavedPlanContents, type SavedPlanSummary } from '../../domain/model/saved-cutting-plan'
import type { CuttingProjectId, SavedCuttingPlanId } from '../../domain/model/ids'
import type { ProjectCuttingPlan } from '../../domain/optimizer/project-plan'
import { validateProjectPlan } from '../../domain/optimizer/validate-project-plan'
import type { LocalPersistence, PersistenceResult, Repositories } from '../persistence/repositories'
import { compactTree, restoreSavedPlan, savedPlanContext } from './saved-plan-codec'

export interface OpenedSavedPlan { readonly summary: SavedPlanSummary; readonly contents: SavedPlanContents; readonly plan: ProjectCuttingPlan }
export interface SavePlanInput extends Pick<SavedPlanContents, 'parts' | 'settings' | 'sources'> {
  readonly plan: ProjectCuttingPlan
  readonly editedPanelIndices: readonly number[]
}
function invalid(cause: unknown): Extract<PersistenceResult<never>, { ok: false }> {
  return { ok: false, error: { kind: 'invalidRecord', issues: [{ path: ['plan'], message: cause instanceof Error ? cause.message : 'The saved plan is invalid.' }] } }
}
/** Shared transaction-scoped historical read; never consults the current catalog. */
export async function readSavedPlan(repositories: Repositories, projectId: CuttingProjectId, id: SavedCuttingPlanId): Promise<PersistenceResult<OpenedSavedPlan>> {
  const summary = await repositories.savedPlanSummaries.get(id)
  if (!summary.ok) return summary
  if (summary.value.projectId !== projectId) return { ok: false, error: { kind: 'notFound', id } }
  const contents = await repositories.savedPlanContents.get(id)
  if (!contents.ok) return contents
  if (contents.value.projectId !== projectId) return invalid(new Error('The saved plan owner does not match its summary.'))
  try { return { ok: true, value: { summary: summary.value, contents: contents.value, plan: restoreSavedPlan(contents.value) } } }
  catch (cause) { return invalid(cause) }
}
/** Scoped, insert-only snapshots. Metadata and all trees commit or roll back together. */
export function createSavedPlanService(persistence: LocalPersistence) {
  function forProject(projectId: CuttingProjectId) {
    async function scope<T>(work: (repositories: Repositories) => Promise<PersistenceResult<T>>): Promise<PersistenceResult<T>> {
      return persistence.transaction(async repositories => {
        const project = await repositories.projects.get(projectId)
        return project.ok ? work(repositories) : project
      })
    }
    async function owned(repositories: Repositories, id: SavedCuttingPlanId): Promise<PersistenceResult<SavedPlanSummary>> {
      const summary = await repositories.savedPlanSummaries.get(id)
      return summary.ok && summary.value.projectId !== projectId ? { ok: false, error: { kind: 'notFound', id } } : summary
    }
    return {
      list(): Promise<PersistenceResult<readonly SavedPlanSummary[]>> {
        return scope(repositories => repositories.savedPlanSummaries.listForProject(projectId))
      },
      async get(id: SavedCuttingPlanId): Promise<PersistenceResult<OpenedSavedPlan>> {
        return scope(repositories => readSavedPlan(repositories, projectId, id))
      },
      async save(metadata: unknown, input: SavePlanInput): Promise<PersistenceResult<OpenedSavedPlan>> {
        try {
          const summary = savedPlanSummarySchema.safeParse(metadata)
          if (!summary.success) return { ok: false, error: { kind: 'invalidRecord', issues: summary.error.issues } }
          if (summary.data.projectId !== projectId) return { ok: false, error: { kind: 'referenceConflict', message: 'A plan must belong to the active project.' } }
          const snapshot = structuredClone(input)
          const validation = validateProjectPlan(snapshot.plan, savedPlanContext(snapshot))
          if (!validation.valid) return invalid(new Error(validation.issues.map(issue => issue.message).join('; ')))
          const used = new Set(snapshot.plan.panels.map(panel => panel.supplierProductId))
          const missingIds = new Set(snapshot.plan.unplaced.map(range => range.partId))
          const contents = savedPlanContentsSchema.safeParse({
            id: summary.data.id, projectId, formatVersion: 1, parts: snapshot.parts, settings: snapshot.settings,
            sources: snapshot.sources.filter(source => used.has(source.product.id)),
            panels: snapshot.plan.panels.map((panel, index) => ({ supplierProductId: panel.supplierProductId, panelCopyIndex: panel.panelCopyIndex, strategy: panel.strategy, edited: snapshot.editedPanelIndices.includes(index), tree: compactTree(panel.plan.tree),
              ...(panel.plan.unplaced.some(range => missingIds.has(range.partId) && (range.reason.kind === 'cannotFitPanel' || range.reason.kind === 'remainderNarrowerThanKerf')) ? { unplacedReasons: [...new Map(panel.plan.unplaced.filter(range => missingIds.has(range.partId) && (range.reason.kind === 'cannotFitPanel' || range.reason.kind === 'remainderNarrowerThanKerf')).map(range => [range.partId, { partId: range.partId, kind: range.reason.kind }])).values()] } : {}),
            })),
            unplaced: snapshot.plan.unplaced, metrics: snapshot.plan.metrics,
          })
          if (!contents.success) return { ok: false, error: { kind: 'invalidRecord', issues: contents.error.issues } }
          const plan = restoreSavedPlan(contents.data)
          return await scope(async repositories => {
            const created = await repositories.savedPlanSummaries.create(summary.data)
            if (!created.ok) return created
            const body = await repositories.savedPlanContents.create(contents.data)
            return body.ok ? { ok: true, value: { summary: created.value, contents: body.value, plan } } : body
          })
        } catch (cause) { return invalid(cause) }
      },
      rename(id: SavedCuttingPlanId, name: string): Promise<PersistenceResult<SavedPlanSummary>> {
        return scope(async repositories => {
          const summary = await owned(repositories, id)
          return summary.ok ? repositories.savedPlanSummaries.update(id, { ...summary.value, name }) : summary
        })
      },
      delete(id: SavedCuttingPlanId): Promise<PersistenceResult<void>> {
        return scope(async repositories => {
          const summary = await owned(repositories, id)
          if (!summary.ok) return summary
          const contents = await repositories.savedPlanContents.get(id)
          if (!contents.ok) return contents
          if (contents.value.projectId !== projectId) return invalid(new Error('The saved plan owner does not match its summary.'))
          const confirmed = await repositories.cuttingConfirmations.find(id)
          if (!confirmed.ok) return confirmed
          if (confirmed.value !== null) return { ok: false, error: { kind: 'referenceConflict', message: 'Confirmed plans are retained for inventory movement history and cannot be deleted.' } }
          const removed = await repositories.savedPlanContents.delete(id)
          return removed.ok ? repositories.savedPlanSummaries.delete(id) : removed
        })
      },
    }
  }
  return { forProject }
}
export type SavedPlanService = ReturnType<typeof createSavedPlanService>
