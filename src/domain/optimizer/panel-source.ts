import { z } from 'zod'
import { panelSnapshotSchema } from '../model/saved-cutting-plan'
import { supplierProductSchema } from '../model/supplier-product'
import type { StockItem } from '../model/stock-item'

/** Geometry-only stock source, never a SupplierProduct or a new inventory record. */
export const stockPanelSchema = panelSnapshotSchema.safeExtend({
  stockItemId: panelSnapshotSchema.shape.stockItemId.unwrap(),
  availability: z.literal('available'),
}).refine(panel => panel.id === `stock:${panel.stockItemId}`, 'Invalid stock allocation key')
export const optimizationPanelSchema = z.union([supplierProductSchema, stockPanelSchema])
export type OptimizationPanel = z.infer<typeof optimizationPanelSchema>

export function stockPanel(item: StockItem): z.infer<typeof stockPanelSchema> {
  return stockPanelSchema.parse({
    id: `stock:${item.id}`, stockItemId: item.id,
    name: item.kind === 'offcut' ? 'Stock offcut' : 'Stock panel',
    materialId: item.materialId, lengthMm: item.lengthMm, widthMm: item.widthMm,
    thicknessMm: item.thicknessMm, grainDirection: item.grainDirection, availability: 'available',
  })
}
