import { z } from 'zod'
import { nameSchema } from './common'
import { cuttingProjectIdSchema, materialIdSchema, partIdSchema, supplierProductIdSchema } from './ids'

/** Ownership and catalog choices; physical entities keep their existing models. */
export const panelQuantitySchema = z.number().int().min(0).refine(Number.isSafeInteger, 'Quantity must be a safe integer')
export const cuttingProjectSchema = z.strictObject({
  id: cuttingProjectIdSchema,
  name: nameSchema,
  partIds: z.array(partIdSchema).refine(ids => new Set(ids).size === ids.length, 'Part IDs must be unique'),
  materialIds: z.array(materialIdSchema).refine(ids => new Set(ids).size === ids.length, 'Material IDs must be unique'),
  supplierProductIds: z.array(supplierProductIdSchema).refine(ids => new Set(ids).size === ids.length, 'Product IDs must be unique'),
  panelQuantities: z.array(z.strictObject({ supplierProductId: supplierProductIdSchema, quantity: panelQuantitySchema })).optional(),
}).refine(project => project.panelQuantities === undefined || (
  new Set(project.panelQuantities.map(item => item.supplierProductId)).size === project.panelQuantities.length &&
  project.panelQuantities.every(item => project.supplierProductIds.includes(item.supplierProductId))
), 'Panel quantities must reference distinct selected products')
export type CuttingProject = z.infer<typeof cuttingProjectSchema>
