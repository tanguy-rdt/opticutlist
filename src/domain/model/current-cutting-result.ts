import { z } from 'zod'
import { cuttingProjectIdSchema, savedCuttingPlanIdSchema } from './ids'

/** One reference per project; legacy/audit layouts remain in the original compact stores. */
export const currentCuttingResultSchema = z.strictObject({
  id: cuttingProjectIdSchema,
  planId: savedCuttingPlanIdSchema,
  preserveLegacy: z.boolean(),
})
export type CurrentCuttingResult = z.infer<typeof currentCuttingResultSchema>
