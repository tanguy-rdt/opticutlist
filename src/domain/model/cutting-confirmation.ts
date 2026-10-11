import { z } from 'zod'
import { cuttingProjectIdSchema, savedCuttingPlanIdSchema, stockItemIdSchema } from './ids'
import { stockItemSchema } from './stock-item'
import { quantitySchema } from './common'

export const cuttingConfirmationSchema = z.strictObject({
  // One physical cutting operation per immutable saved plan, including across connections.
  id: savedCuttingPlanIdSchema,
  projectId: cuttingProjectIdSchema,
  confirmedAt: z.iso.datetime(),
  consumed: z.array(z.strictObject({ stock: stockItemSchema, quantity: quantitySchema, panelIndices: z.array(z.number().int().nonnegative()) })),
  offcuts: z.array(stockItemSchema),
})
export type CuttingConfirmation = z.infer<typeof cuttingConfirmationSchema>
export const confirmCuttingInputSchema = z.strictObject({
  confirmed: z.literal(true),
  assignments: z.array(z.strictObject({ panelIndex: z.number().int().nonnegative(), stockItemId: stockItemIdSchema })),
  offcuts: z.array(z.strictObject({ panelIndex: z.number().int().nonnegative(), wasteIndex: z.number().int().nonnegative() })),
})
export type ConfirmCuttingInput = z.infer<typeof confirmCuttingInputSchema>
