import { z } from 'zod'
import { pdfSettingsSchema } from './pdf-settings'
import { cuttingSettingsSchema } from './cutting-settings'
import { nameSchema } from './common'
import { cuttingProjectIdSchema, materialIdSchema, partIdSchema, stockItemIdSchema, supplierProductIdSchema } from './ids'

/** Ownership and catalog choices; physical entities keep their existing models. */
export const panelQuantitySchema = z.number().int().min(0).refine(Number.isSafeInteger, 'Quantity must be a safe integer')
export const cuttingProjectSchema = z.strictObject({
  id: cuttingProjectIdSchema,
  name: nameSchema,
  description: z.string().trim().max(2000).optional(),
  partIds: z.array(partIdSchema).refine(ids => new Set(ids).size === ids.length, 'Part IDs must be unique'),
  materialIds: z.array(materialIdSchema).refine(ids => new Set(ids).size === ids.length, 'Material IDs must be unique'),
  supplierProductIds: z.array(supplierProductIdSchema).refine(ids => new Set(ids).size === ids.length, 'Product IDs must be unique'),
  stockItemIds: z.array(stockItemIdSchema).refine(ids => new Set(ids).size === ids.length, 'Stock IDs must be unique').optional(),
  cuttingSettings: cuttingSettingsSchema.optional(),
  pdfSettings: pdfSettingsSchema.optional(),
  // Retained for compatibility with older project files; new runs derive catalog supply from demand.
  panelQuantities: z.array(z.strictObject({ supplierProductId: supplierProductIdSchema, quantity: panelQuantitySchema })).optional(),
}).refine(project => project.panelQuantities === undefined || (
  new Set(project.panelQuantities.map(item => item.supplierProductId)).size === project.panelQuantities.length &&
  project.panelQuantities.every(item => project.supplierProductIds.includes(item.supplierProductId))
), 'Panel quantities must reference distinct selected products')
export type CuttingProject = z.infer<typeof cuttingProjectSchema>
