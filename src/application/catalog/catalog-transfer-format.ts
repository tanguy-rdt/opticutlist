import { z } from 'zod'
import { materialSchema } from '../../domain/model/material'
import { supplierSchema } from '../../domain/model/supplier'
import { supplierProductSchema } from '../../domain/model/supplier-product'
import type { PersistenceResult } from '../persistence/repositories'

export const catalogRecordsSchema = z.strictObject({ materials: z.array(materialSchema), suppliers: z.array(supplierSchema), products: z.array(supplierProductSchema) })
export type CatalogRecords = z.infer<typeof catalogRecordsSchema>
export const catalogTransferSchema = z.strictObject({ format: z.literal('opticutlist-catalog'), schemaVersion: z.literal(1), catalog: catalogRecordsSchema })
export type CatalogTransfer = z.infer<typeof catalogTransferSchema>
export function invalidCatalog(message: string): Extract<PersistenceResult<never>, { ok: false }> {
  return { ok: false, error: { kind: 'invalidRecord', issues: [{ path: ['file'], message }] } }
}
export function validateCatalogTransfer(input: unknown): PersistenceResult<CatalogTransfer> {
  const parsed = catalogTransferSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: { kind: 'invalidRecord', issues: parsed.error.issues } }
  const { materials, suppliers, products } = parsed.data.catalog
  if ([materials, suppliers, products].some(records => new Set(records.map(record => record.id)).size !== records.length)) return invalidCatalog('Entity IDs must be unique in each collection.')
  if (products.some(product => !materials.some(material => material.id === product.materialId) || !suppliers.some(supplier => supplier.id === product.supplierId))) return invalidCatalog('Every product must reference an included material and supplier.')
  return { ok: true, value: parsed.data }
}
