import { reconcileProjectStock } from '../inventory/project-stock-service'
import { savedCuttingPlanIdSchema } from '../../domain/model/ids'
import type { CuttingProjectId } from '../../domain/model/ids'
import type { LocalPersistence, PersistenceResult, Repositories } from '../persistence/repositories'
import { prepareSavedPlan, readSavedPlan, type OpenedSavedPlan, type SavePlanInput } from './saved-plan-service'

export interface CurrentResultState {
  readonly result: OpenedSavedPlan | null
  readonly ambiguousLegacyCount: number
}
function conflict(message: string): Extract<PersistenceResult<never>, { ok: false }> {
  return { ok: false, error: { kind: 'referenceConflict', message } }
}
/** Automatic, atomic replacement. Legacy records and physical cutting audit origins are retained. */
export function createCurrentResultService(persistence: LocalPersistence) {
  function forProject(projectId: CuttingProjectId) {
    function scope<T>(work: (repositories: Repositories) => Promise<PersistenceResult<T>>) {
      return persistence.transaction(async repositories => {
        const project = await repositories.projects.get(projectId)
        return project.ok ? work(repositories) : project
      })
    }
    return {
      load(): Promise<PersistenceResult<CurrentResultState>> {
        return scope<CurrentResultState>(async repositories => {
          const current = await repositories.currentCuttingResults.find(projectId)
          if (!current.ok) return current
          if (current.value) {
            const result = await readSavedPlan(repositories, projectId, current.value.planId)
            if (!result.ok) return result
            const stock = await reconcileProjectStock(repositories, result.value)
            return stock.ok ? { ok: true, value: { result: result.value, ambiguousLegacyCount: 0 } } : stock
          }
          const legacy = await repositories.savedPlanSummaries.listForProject(projectId)
          if (!legacy.ok) return legacy
          const only = legacy.value.length === 1 ? legacy.value[0] : undefined
          if (!only) return { ok: true, value: { result: null, ambiguousLegacyCount: legacy.value.length > 1 ? legacy.value.length : 0 } }
          // Unambiguous adoption is a reference only. The original plan is never rewritten/deleted.
          const result = await readSavedPlan(repositories, projectId, only.id)
          if (!result.ok) return result
          const linked = await repositories.currentCuttingResults.create({ id: projectId, planId: only.id, preserveLegacy: true })
          if (!linked.ok) return linked
          const stock = await reconcileProjectStock(repositories, result.value)
          return stock.ok ? { ok: true, value: { result: result.value, ambiguousLegacyCount: 0 } } : stock
        })
      },
      replace(input: SavePlanInput, signal?: AbortSignal): Promise<PersistenceResult<OpenedSavedPlan>> {
        const prepared = prepareSavedPlan({ id: savedCuttingPlanIdSchema.parse(crypto.randomUUID()), projectId, name: 'Current cutting result', createdAt: new Date().toISOString() }, input)
        if (!prepared.ok) return Promise.resolve(prepared)
        return scope(async repositories => {
          if (signal?.aborted) return conflict('The result changed before automatic persistence completed.')
          const current = await repositories.currentCuttingResults.find(projectId)
          if (!current.ok) return current
          if (current.value) {
            // Validate the old record before replacing: corruption must never trigger silent deletion.
            const previous = await readSavedPlan(repositories, projectId, current.value.planId)
            if (!previous.ok) return previous
            const receipt = await repositories.cuttingConfirmations.find(current.value.planId)
            if (!receipt.ok) return receipt
            const offcuts = await repositories.projectStock.find(projectId)
            if (!offcuts.ok) return offcuts
            const audited = offcuts.value?.movements.some(movement => movement.planId === current.value?.planId) ?? false
            if (!current.value.preserveLegacy && receipt.value === null && !audited) {
              const body = await repositories.savedPlanContents.delete(current.value.planId)
              if (!body.ok) return body
              const summary = await repositories.savedPlanSummaries.delete(current.value.planId)
              if (!summary.ok) return summary
            }
          }
          const summary = await repositories.savedPlanSummaries.create(prepared.value.summary)
          if (!summary.ok) return summary
          const body = await repositories.savedPlanContents.create(prepared.value.contents)
          if (!body.ok) return body
          const record = { id: projectId, planId: prepared.value.summary.id, preserveLegacy: false }
          const linked = current.value === null ? await repositories.currentCuttingResults.create(record) : await repositories.currentCuttingResults.update(projectId, record)
          if (!linked.ok) return linked
          if (signal?.aborted) return conflict('The result changed before automatic persistence completed.')
          const stock = await reconcileProjectStock(repositories, prepared.value)
          return stock.ok ? prepared : stock
        })
      },
    }
  }
  return { forProject }
}
export type CurrentResultService = ReturnType<typeof createCurrentResultService>
