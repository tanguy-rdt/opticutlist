import { partSchema } from '../../model/part'
import { supplierProductSchema } from '../../model/supplier-product'
import { validPartInput, validSupplierProductInput } from '../../model/__tests__/fixtures'
import type { PanelCuttingPlan } from '../../optimizer/plan-with-strategy'

export const viewerPart = partSchema.parse({ ...validPartInput, id: 'viewer-part', name: 'Shelf', lengthMm: 50, widthMm: 30, quantity: 1, rotation: 'allowed' })
export const viewerPanel = supplierProductSchema.parse({ ...validSupplierProductInput, lengthMm: 100, widthMm: 80, grainDirection: 'width' })
export const viewerSettings = { kerfMm: 2, edgeMarginMm: 5 }
export const viewerPlan: PanelCuttingPlan = {
  tree: { kind: 'cut', region: { xMm: 5, yMm: 5, lengthMm: 90, widthMm: 70 }, cut: { axis: 'length', offsetMm: 30 },
    first: { kind: 'cut', region: { xMm: 5, yMm: 5, lengthMm: 30, widthMm: 70 }, cut: { axis: 'width', offsetMm: 50 },
      first: { kind: 'part', region: { xMm: 5, yMm: 5, lengthMm: 30, widthMm: 50 }, partId: viewerPart.id, copyIndex: 0, orientation: 'rotated' },
      second: { kind: 'waste', region: { xMm: 5, yMm: 57, lengthMm: 30, widthMm: 18 } } },
    second: { kind: 'waste', region: { xMm: 37, yMm: 5, lengthMm: 58, widthMm: 70 } } },
  placements: [{ partId: viewerPart.id, copyIndex: 0, orientation: 'rotated', region: { xMm: 5, yMm: 5, lengthMm: 30, widthMm: 50 }, dimensions: { lengthMm: 30, widthMm: 50, thicknessMm: 18 } }],
  unplaced: [], metrics: { panelAreaMm2: 8000, usedAreaMm2: 1500, wasteAreaMm2: 6500, utilizationPercent: 18.75 },
}
export function freezeDeep(value: unknown): void {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return
  Object.freeze(value)
  for (const child of Object.values(value)) freezeDeep(child)
}
