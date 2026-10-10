import { z } from 'zod'

// Stable identifiers are opaque strings (e.g. UUIDs) that never change once assigned.
// Each entity has its own branded type so IDs of different entities cannot be mixed up.
const stableIdSchema = z
  .string()
  .min(1, { error: 'ID must not be empty' })
  .max(128, { error: 'ID must be at most 128 characters' })
  .regex(/^\S+$/, { error: 'ID must not contain whitespace' })

export const materialIdSchema = stableIdSchema.brand<'MaterialId'>()
export type MaterialId = z.infer<typeof materialIdSchema>

export const partIdSchema = stableIdSchema.brand<'PartId'>()
export type PartId = z.infer<typeof partIdSchema>

export const supplierIdSchema = stableIdSchema.brand<'SupplierId'>()
export type SupplierId = z.infer<typeof supplierIdSchema>

export const supplierProductIdSchema = stableIdSchema.brand<'SupplierProductId'>()
export type SupplierProductId = z.infer<typeof supplierProductIdSchema>

export const stockItemIdSchema = stableIdSchema.brand<'StockItemId'>()
export type StockItemId = z.infer<typeof stockItemIdSchema>

export const cuttingProjectIdSchema = stableIdSchema.brand<'CuttingProjectId'>()
export type CuttingProjectId = z.infer<typeof cuttingProjectIdSchema>
