import { partSchema } from '../../../domain/model/part'
import { supplierProductSchema } from '../../../domain/model/supplier-product'
import { panelSnapshotSchema } from '../../../domain/model/saved-cutting-plan'
import { validPartInput, validSupplierProductInput } from '../../../domain/model/__tests__/fixtures'
import { optimizeProject } from '../../../domain/optimizer/optimize-project'
import type { CuttingPlanPdfRequest, ProjectCuttingPdfRequest } from '../cutting-plan-pdf-service'
import { rotationInput, rotationPlan } from '../../../domain/cutting-tree/__tests__/editing-fixtures'

export const pdfRequest: CuttingPlanPdfRequest = { ...rotationInput, plan: rotationPlan, materialName: 'Birch plywood', orientation: 'landscape', edited: false }

/** Wrap a validated one-panel fixture in the existing project accounting model. */
export function projectPdfRequest(request: CuttingPlanPdfRequest = pdfRequest): ProjectCuttingPdfRequest {
  return {
    title: 'Workshop project', orientation: request.orientation,
    plan: { panels: [{ supplierProductId: request.panel.id, panelCopyIndex: 0, strategy: 'largestAreaFirst', plan: request.plan }], unplaced: [], metrics: { ...request.plan.metrics, placedCount: request.plan.placements.length, unplacedCount: 0, panelCount: 1 } },
    parts: [...request.parts], settings: request.settings,
    sources: [{ product: request.panel, quantity: 1, materialName: request.materialName, supplierName: 'Supplier' }],
    editedPanelIndices: request.edited ? [0] : [],
  }
}

export function multiPanelPdfRequest(incomplete = false): ProjectCuttingPdfRequest {
  const product = supplierProductSchema.parse({ ...validSupplierProductInput, name: 'Workshop panel', lengthMm: 210, widthMm: 110, grainDirection: 'none' })
  const part = partSchema.parse({ ...validPartInput, name: 'Workshop shelf', lengthMm: 90, widthMm: 80, grainDirection: 'none', rotation: 'forbidden', quantity: 4 })
  const parts = [part, ...(incomplete ? [partSchema.parse({ ...part, id: 'oversized-part', name: 'Oversized part', lengthMm: 900, quantity: 1 })] : [])]
  const settings = { kerfMm: 2, edgeMarginMm: 5 }
  const optimized = optimizeProject({ panels: [{ product, quantity: 2 }], parts, settings })
  if (!optimized.ok) throw new Error('Fixture optimization failed')
  const { id, name, materialId, lengthMm, widthMm, thicknessMm, grainDirection } = product
  return { title: 'Workshop project', orientation: 'landscape', plan: optimized.plan, parts, settings,
    sources: [{ product: panelSnapshotSchema.parse({ id, name, materialId, lengthMm, widthMm, thicknessMm, grainDirection }), quantity: 2, materialName: 'Birch plywood', supplierName: 'Supplier' }], editedPanelIndices: [] }
}
