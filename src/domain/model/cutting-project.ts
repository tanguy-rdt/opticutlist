import { z } from 'zod'
import { nameSchema } from './common'
import { cuttingProjectIdSchema, materialIdSchema, partIdSchema, supplierProductIdSchema } from './ids'

/** Ownership and catalog choices; physical entities keep their existing models. */
export const cuttingProjectSchema = z.strictObject({
  id: cuttingProjectIdSchema,
  name: nameSchema,
  partIds: z.array(partIdSchema).refine(ids => new Set(ids).size === ids.length, 'Part IDs must be unique'),
  materialIds: z.array(materialIdSchema).refine(ids => new Set(ids).size === ids.length, 'Material IDs must be unique'),
  supplierProductIds: z.array(supplierProductIdSchema).refine(ids => new Set(ids).size === ids.length, 'Product IDs must be unique'),
})
export type CuttingProject = z.infer<typeof cuttingProjectSchema>
