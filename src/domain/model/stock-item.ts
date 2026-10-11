import { z } from 'zod'

import { quantitySchema } from './common'
import { dimensions3DSchema } from './dimensions'
import { cuttingProjectIdSchema, savedCuttingPlanIdSchema, materialIdSchema, stockItemIdSchema, supplierProductIdSchema } from './ids'
import { grainDirectionSchema } from './orientation'

export const stockItemKindSchema = z.enum(['fullPanel', 'offcut'])
export type StockItemKind = z.infer<typeof stockItemKindSchema>

/** Where physically owned stock came from. */
export const stockProvenanceSchema = z.discriminatedUnion('source', [
  z.strictObject({ source: z.literal('manual') }),
  z.strictObject({ source: z.literal('purchase'), supplierProductId: supplierProductIdSchema }),
  z.strictObject({ source: z.literal('cutting'), projectId: cuttingProjectIdSchema, savedPlanId: savedCuttingPlanIdSchema, sourceStockItemId: stockItemIdSchema, panelIndex: z.number().int().nonnegative(), wasteIndex: z.number().int().nonnegative() }),
])
export type StockProvenance = z.infer<typeof stockProvenanceSchema>

/** Physically owned panel or offcut. Distinct from purchasable `SupplierProduct`s. */
export const stockItemSchema = z.strictObject({
  id: stockItemIdSchema,
  kind: stockItemKindSchema,
  materialId: materialIdSchema,
  ...dimensions3DSchema.shape,
  quantity: quantitySchema,
  grainDirection: grainDirectionSchema,
  provenance: stockProvenanceSchema,
})

export type StockItem = z.infer<typeof stockItemSchema>
