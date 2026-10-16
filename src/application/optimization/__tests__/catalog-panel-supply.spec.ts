// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { catalogPanelSupply } from '../catalog-panel-supply'
import { optimizeProject } from '../../../domain/optimizer/optimize-project'
import { stockPanel } from '../../../domain/optimizer/panel-source'
import { partSchema } from '../../../domain/model/part'
import { supplierProductSchema } from '../../../domain/model/supplier-product'
import { stockItemSchema } from '../../../domain/model/stock-item'
import { validPartInput, validStockItemInput, validSupplierProductInput } from '../../../domain/model/__tests__/fixtures'

const part = partSchema.parse({ ...validPartInput, lengthMm: 80, widthMm: 80, quantity: 3, grainDirection: 'none' })
const catalog = supplierProductSchema.parse({ ...validSupplierProductInput, lengthMm: 100, widthMm: 100, grainDirection: 'none' })
const stock = stockItemSchema.parse({ ...validStockItemInput, lengthMm: 80, widthMm: 80, quantity: 1, grainDirection: 'none' })
const settings = { kerfMm: 2, edgeMarginMm: 0 }

describe('Automatic finite catalog supply', () => {
  it('uses total requested copies as a sufficient finite bound without expanding source records', () => {
    expect(catalogPanelSupply([])).toBe(0)
    expect(catalogPanelSupply([part, { ...part, quantity: 5 }])).toBe(8)
    expect(() => catalogPanelSupply([{ ...part, quantity: Number.MAX_SAFE_INTEGER }, part])).toThrow(RangeError)
    const result = optimizeProject({ parts: [part], settings, panels: [{ product: catalog, quantity: catalogPanelSupply([part]) }] })
    expect(result).toMatchObject({ ok: true, plan: { unplaced: [], metrics: { placedCount: 3, panelCount: 3 } } })
    expect(result.ok && result.plan.panels.map(panel => panel.panelCopyIndex)).toEqual([0, 1, 2])
  })
  it.each([0, 1])('preserves physical stock limit %s and explicitly reports unmet demand', quantity => {
    const result = optimizeProject({ parts: [part], settings, panels: [{ product: stockPanel(stock), quantity }] })
    expect(result).toMatchObject({ ok: true, plan: { metrics: { placedCount: quantity, unplacedCount: 3 - quantity, panelCount: quantity }, unplaced: [{ count: 3 - quantity, reason: 'panelLimitReached' }] } })
    expect(stock.quantity).toBe(1)
  })
  it('uses catalog supply alongside exact limited stock without changing the existing objective', () => {
    const result = optimizeProject({ parts: [part], settings, panels: [
      { product: catalog, quantity: catalogPanelSupply([part]) },
      { product: stockPanel(stock), quantity: stock.quantity },
    ] })
    expect(result).toMatchObject({ ok: true, plan: { unplaced: [], metrics: { placedCount: 3, panelCount: 3 } } })
    expect(result.ok && result.plan.panels.filter(panel => panel.supplierProductId === stockPanel(stock).id)).toHaveLength(1)
    expect(result.ok && result.plan.panels.filter(panel => panel.supplierProductId === catalog.id)).toHaveLength(2)
    expect(stock.quantity).toBe(1)
  })
  it('terminates without allocating empty catalog panels when geometry cannot satisfy demand', () => {
    const oversized = { ...part, lengthMm: 1000 }
    const result = optimizeProject({ parts: [oversized], settings, panels: [{ product: catalog, quantity: catalogPanelSupply([oversized]) }] })
    expect(result).toMatchObject({ ok: true, plan: { panels: [], unplaced: [{ count: 3, reason: 'constraintsPreventPlacement' }] } })
  })
})
