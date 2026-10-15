import { stockOrderSchema } from './stock-order'
import { z } from 'zod'
import { stockItemSchema } from '../../domain/model/stock-item'
import { materialSchema } from '../../domain/model/material'
import type { PersistenceResult } from '../persistence/repositories'

export const stockTransferSchema = z.strictObject({
  format: z.literal('opticutlist-stock'),
  schemaVersion: z.literal(1),
  materials: z.array(materialSchema),
  stockItems: z.array(stockItemSchema),
  stockOrders: z.array(stockOrderSchema).optional(),
})
export type StockTransfer = z.infer<typeof stockTransferSchema>
export function invalidStockTransfer(message: string): Extract<PersistenceResult<never>, { ok: false }> {
  return { ok: false, error: { kind: 'invalidRecord', issues: [{ path: ['file'], message }] } }
}
export function validateStockTransfer(input: unknown): PersistenceResult<StockTransfer> {
  const parsed = stockTransferSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: { kind: 'invalidRecord', issues: parsed.error.issues } }
  const { materials, stockItems } = parsed.data
  if ([materials, stockItems].some(records => new Set(records.map(record => record.id)).size !== records.length)) return invalidStockTransfer('Material and stock IDs must be unique within each collection.')
  if (stockItems.some(item => !materials.some(material => material.id === item.materialId))) return invalidStockTransfer('Every stock item must reference an included material identity.')
  if (materials.some(material => !stockItems.some(item => item.materialId === material.id))) return invalidStockTransfer('Include only materials referenced by stock items.')
  const orders = parsed.data.stockOrders ?? []
  if (new Set(orders.map(order => order.id)).size !== orders.length) return invalidStockTransfer('Material order records must be unique.')
  if (orders.some(order => order.stockItemIds.some(id => !stockItems.some(item => item.id === id && item.materialId === order.id)))) return invalidStockTransfer('Stock order must reference included items of the same material.')
  return { ok: true, value: parsed.data }
}
