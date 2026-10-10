import type { CuttingTreeNode } from '../cutting-tree'
import { partSchema } from '../../model/part'
import { supplierProductSchema } from '../../model/supplier-product'
import type { PanelCuttingPlan } from '../../optimizer/plan-with-strategy'
import { viewerPanel, viewerPart, viewerPlan, viewerSettings } from './viewer-fixtures'

export const rotationInput = { panel: { ...viewerPanel, grainDirection: 'none' as const }, parts: [viewerPart], settings: viewerSettings }
export const rotationPlan = viewerPlan
export const swapFirst = partSchema.parse({ ...viewerPart, id: 'swap-first', name: 'First piece', lengthMm: 30, widthMm: 50, grainDirection: 'none' })
export const swapSecond = partSchema.parse({ ...viewerPart, id: 'swap-second', name: 'Second piece', lengthMm: 50, widthMm: 30, grainDirection: 'none' })
export const swapInput = { panel: supplierProductSchema.parse({ ...viewerPanel, lengthMm: 90, widthMm: 60, grainDirection: 'none' }), parts: [swapFirst, swapSecond], settings: { kerfMm: 0, edgeMarginMm: 5 } }
export const swapTree: CuttingTreeNode = {
  kind: 'cut', region: { xMm: 5, yMm: 5, lengthMm: 80, widthMm: 50 }, cut: { axis: 'length', offsetMm: 30 },
  first: { kind: 'part', region: { xMm: 5, yMm: 5, lengthMm: 30, widthMm: 50 }, partId: swapFirst.id, copyIndex: 0, orientation: 'normal' },
  second: { kind: 'cut', region: { xMm: 35, yMm: 5, lengthMm: 50, widthMm: 50 }, cut: { axis: 'width', offsetMm: 30 },
    first: { kind: 'part', region: { xMm: 35, yMm: 5, lengthMm: 50, widthMm: 30 }, partId: swapSecond.id, copyIndex: 0, orientation: 'normal' },
    second: { kind: 'waste', region: { xMm: 35, yMm: 35, lengthMm: 50, widthMm: 20 } } },
}
export const swapPlan: PanelCuttingPlan = { tree: swapTree, placements: [
  { partId: swapFirst.id, copyIndex: 0, orientation: 'normal', region: { xMm: 5, yMm: 5, lengthMm: 30, widthMm: 50 }, dimensions: { lengthMm: 30, widthMm: 50, thicknessMm: 18 } },
  { partId: swapSecond.id, copyIndex: 0, orientation: 'normal', region: { xMm: 35, yMm: 5, lengthMm: 50, widthMm: 30 }, dimensions: { lengthMm: 50, widthMm: 30, thicknessMm: 18 } },
], unplaced: [], metrics: { panelAreaMm2: 5400, usedAreaMm2: 3000, wasteAreaMm2: 2400, utilizationPercent: 3000 / 5400 * 100 } }
