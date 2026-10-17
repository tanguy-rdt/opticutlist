import { catalogRecordsSchema } from '../catalog/catalog-transfer-format'
import { savedCuttingPlanIdSchema } from '../../domain/model/ids'
import { z } from 'zod'
import { cuttingProjectSchema } from '../../domain/model/cutting-project'
import { partSchema } from '../../domain/model/part'
import { savedPlanSummarySchema, savedPlanContentsSchema } from '../../domain/model/saved-cutting-plan'
import { restoreSavedPlan } from '../plans/saved-plan-codec'
import type { PersistenceResult } from '../persistence/repositories'

export interface ProjectJsonPort {
  parse(text: string): unknown
  stringify(file: unknown): string
}

export const projectTransferSchema = z.strictObject({
  format: z.literal('opticutlist-project'),
  schemaVersion: z.literal(1),
  project: cuttingProjectSchema,
  parts: z.array(partSchema),
  catalog: catalogRecordsSchema,
  currentResultId: savedCuttingPlanIdSchema.optional(),
  savedPlans: z.array(z.strictObject({ summary: savedPlanSummarySchema, contents: savedPlanContentsSchema })),
})
export type ProjectTransfer = z.infer<typeof projectTransferSchema>

export function invalidTransfer(message: string): Extract<PersistenceResult<never>, { ok: false }> {
  return { ok: false, error: { kind: 'invalidRecord', issues: [{ path: ['file'], message }] } }
}

/** Validate every boundary record, relationships and historical tree before any write. */
export function validateProjectTransfer(input: unknown): PersistenceResult<ProjectTransfer> {
  try {
    const parsed = projectTransferSchema.safeParse(input)
    if (!parsed.success) {
      return { ok: false, error: { kind: 'invalidRecord', issues: parsed.error.issues } }
    }
    const file = parsed.data
    const collections = [file.parts, file.catalog.materials, file.catalog.suppliers, file.catalog.products, file.savedPlans.map(plan => plan.summary)]
    if (collections.some(items => new Set(items.map(item => item.id)).size !== items.length)) {
      return invalidTransfer('Entity IDs must be unique in each collection.')
    }
    const sameIds = (actual: readonly string[], expected: readonly string[]) => actual.length === new Set(expected).size && actual.every(id => expected.includes(id))
    if (!sameIds(file.parts.map(part => part.id), file.project.partIds)) {
      return invalidTransfer('Project ownership must match all exported Parts exactly.')
    }
    if (!sameIds(file.catalog.products.map(product => product.id), file.project.supplierProductIds)) {
      return invalidTransfer('The selected products must match the catalog dependencies.')
    }
    const materials = [...file.project.materialIds, ...file.parts.map(part => part.materialId), ...file.catalog.products.map(product => product.materialId)]
    if (!sameIds(file.catalog.materials.map(material => material.id), materials)) {
      return invalidTransfer('Required material references are missing or unrelated materials are included.')
    }
    if (!sameIds(file.catalog.suppliers.map(supplier => supplier.id), file.catalog.products.map(product => product.supplierId))) {
      return invalidTransfer('Required supplier references are missing or unrelated suppliers are included.')
    }
    if (file.currentResultId !== undefined && !file.savedPlans.some(plan => plan.summary.id === file.currentResultId)) {
      return invalidTransfer('The current result reference is missing.')
    }
    for (const plan of file.savedPlans) {
      if (
        plan.summary.projectId !== file.project.id
        || plan.contents.projectId !== file.project.id
        || plan.contents.id !== plan.summary.id
      ) {
        return invalidTransfer('A saved plan has inconsistent identity or project ownership.')
      }
      restoreSavedPlan(plan.contents)
    }
    return { ok: true, value: file }
  } catch (cause) {
    return invalidTransfer(cause instanceof Error ? cause.message : 'The project file is invalid.')
  }
}
