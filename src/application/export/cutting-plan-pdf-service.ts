import { coverImageSchema, pdfSettingsSchema, type CoverImage } from '../../domain/model/pdf-settings'
import { supplierProductSchema, type SupplierProduct } from '../../domain/model/supplier-product'
import type { SavePlanInput } from '../plans/saved-plan-service'
import { savedPlanContext } from '../plans/saved-plan-codec'
import { validateProjectPlan } from '../../domain/optimizer/validate-project-plan'
import type { ProjectCuttingPlan } from '../../domain/optimizer/project-plan'
import { createCuttingPlanScene, type CuttingPlanScene } from '../optimization/cutting-plan-scene'
import type { CuttingSettings } from '../../domain/model/cutting-settings'
import type { Part } from '../../domain/model/part'
import { panelSnapshotSchema, type PanelSnapshot } from '../../domain/model/saved-cutting-plan'
import { resolveProjectPdfPricing, type PdfPricingRepositories } from './project-pdf-pricing'
import { computeAreaMetrics, type AreaMetrics, type PanelCuttingPlan, type UnplacedParts } from '../../domain/optimizer/plan-with-strategy'

export type PdfPageSize = 'A4' | 'A3'
export type PdfOrientation = 'portrait' | 'landscape'
export interface CuttingPlanPdfRequest {
  readonly plan: PanelCuttingPlan
  readonly panel: PanelSnapshot
  readonly parts: readonly Part[]
  readonly settings: CuttingSettings
  readonly projectName?: string
  readonly supplierName?: string
  readonly materialName: string
  readonly pageSize?: PdfPageSize
  readonly orientation: PdfOrientation
  readonly pricing?: (Pick<SupplierProduct, 'currency'> & { readonly price: number })
  readonly edited: boolean
}
export interface CuttingPlanPdfDocument extends Omit<CuttingPlanPdfRequest, 'plan'> {
  readonly scene: CuttingPlanScene
  readonly metrics: AreaMetrics
  readonly unplaced: readonly UnplacedParts[]
}
export interface ProjectCuttingPdfRequest extends SavePlanInput {
  readonly cover?: { readonly title?: string; readonly description?: string; readonly image?: CoverImage }
  /** Optional known export-time prices, never inferred from panel names or written to historical plans. */
  readonly panelPrices?: readonly (Pick<PanelSnapshot, 'id'> & Pick<SupplierProduct, 'currency'> & { readonly price: number })[]
  readonly pageSize?: PdfPageSize
  readonly orientation: PdfOrientation
  readonly title: string
}
export interface ProjectCuttingPdfDocument {
  readonly settings: CuttingSettings
  readonly cover?: { readonly title?: string; readonly description?: string; readonly image?: CoverImage }
  readonly title: string
  readonly pageSize?: PdfPageSize
  readonly orientation: PdfOrientation
  readonly metrics: ProjectCuttingPlan['metrics']
  readonly unplaced: ProjectCuttingPlan['unplaced']
  readonly parts: readonly Part[]
  readonly panels: readonly CuttingPlanPdfDocument[]
}
export interface CuttingPlanPdfPort {
  generate(document: CuttingPlanPdfDocument): Promise<Uint8Array<ArrayBuffer>>
  generateProject?(document: ProjectCuttingPdfDocument): Promise<Uint8Array<ArrayBuffer>>
}
export type CuttingPlanPdfResult =
  | { readonly ok: true; readonly bytes: Uint8Array<ArrayBuffer> }
  | { readonly ok: false; readonly error: { readonly kind: 'invalidPlan' | 'generationFailure'; readonly message: string } }

/** Reuse the same scene, validation and metric projection for both internal panel and whole-result exports. */
function panelDocument(snapshot: CuttingPlanPdfRequest): CuttingPlanPdfDocument {
  if (snapshot.pricing) supplierProductSchema.pick({ price: true, currency: true }).required({ price: true }).parse(snapshot.pricing)
  const projection = createCuttingPlanScene(snapshot.plan, snapshot)
  if (projection.status !== 'valid') throw new Error(projection.status === 'invalid' ? projection.message : 'No cutting plan to export.')
  const { plan, ...metadata } = snapshot
  const placements = projection.scene.parts.map(part => ({
    partId: part.part.id,
    copyIndex: part.copyIndex,
    orientation: part.orientation,
    region: part.region,
    dimensions: part.dimensions
  }))
  return { ...metadata, scene: projection.scene, metrics: computeAreaMetrics(snapshot.panel, placements), unplaced: plan.unplaced }
}
export function prepareProjectPdfDocument(request: ProjectCuttingPdfRequest): { ok: true; document: ProjectCuttingPdfDocument } | { ok: false; error: { kind: 'invalidPlan'; message: string } } {
  try {
    const snapshot = structuredClone(request)
    if (snapshot.cover) {
      pdfSettingsSchema.pick({ titleOverride: true, description: true }).parse({
        ...(snapshot.cover.title === undefined ? {} : { titleOverride: snapshot.cover.title }),
        ...(snapshot.cover.description === undefined ? {} : { description: snapshot.cover.description }),
      })
      if (snapshot.cover.image) coverImageSchema.parse(snapshot.cover.image)
    }
    const validation = validateProjectPlan(snapshot.plan, savedPlanContext(snapshot))
    if (!validation.valid) throw new Error(validation.issues.map(issue => issue.message).join('; '))
    const prices = new Map(snapshot.panelPrices?.map(price => {
      const valid = supplierProductSchema.pick({ price: true, currency: true }).required({ price: true }).extend({ id: panelSnapshotSchema.shape.id }).parse(price)
      if (!snapshot.sources.some(source => source.product.id === valid.id)) throw new Error('Unknown panel pricing reference.')
      return [valid.id, valid] as const
    }))
    if (prices.size !== (snapshot.panelPrices?.length ?? 0)) throw new Error('Duplicate pricing reference.')
    const panels = snapshot.plan.panels.map((allocation, index) => {
      const source = snapshot.sources.find(source => source.product.id === allocation.supplierProductId)
      if (!source) throw new Error('Missing historical panel reference.')
      const pricing = prices.get(source.product.id)
      return panelDocument({
        ...(pricing ? { pricing: { price: pricing.price, currency: pricing.currency } } : {}),
        plan: allocation.plan,
        panel: source.product,
        parts: snapshot.parts,
        settings: snapshot.settings,
        materialName: source.materialName,
        projectName: snapshot.title,
        supplierName: source.supplierName,
        pageSize: snapshot.pageSize ?? 'A4',
        orientation: snapshot.orientation,
        edited: snapshot.editedPanelIndices.includes(index)
      })
    })
    return {
      ok: true,
      document: {
        settings: snapshot.settings,
        ...(snapshot.cover ? { cover: snapshot.cover } : {}),
        title: snapshot.title,
        pageSize: snapshot.pageSize ?? 'A4',
        orientation: snapshot.orientation,
        metrics: snapshot.plan.metrics,
        unplaced: snapshot.plan.unplaced,
        parts: snapshot.parts,
        panels
      }
    }
  } catch (cause) {
    return { ok: false, error: { kind: 'invalidPlan', message: cause instanceof Error ? cause.message : 'Invalid cutting result.' } }
  }
}

/** Independently validate a detached snapshot; adapters never receive unvalidated geometry. */
export function createCuttingPlanPdfService(port: CuttingPlanPdfPort, pricingRepositories?: PdfPricingRepositories) {
  return {
    async exportProject(request: ProjectCuttingPdfRequest): Promise<CuttingPlanPdfResult> {
      const prepared = prepareProjectPdfDocument(request)
      if (!prepared.ok) return prepared
      try {
        if (!port.generateProject) throw new Error('Complete cutting-result PDF export is unavailable.')
        const document = pricingRepositories ? await resolveProjectPdfPricing(prepared.document, pricingRepositories) : prepared.document
        return { ok: true, bytes: await port.generateProject(document) }
      } catch (cause) {
        return {
          ok: false,
          error: { kind: 'generationFailure', message: cause instanceof Error ? cause.message : 'Could not generate the cutting result PDF.' }
        }
      }
    },
    async export(request: CuttingPlanPdfRequest): Promise<CuttingPlanPdfResult> {
      try {
        const snapshot = structuredClone(request)
        let document: CuttingPlanPdfDocument
        try { document = panelDocument(snapshot) }
        catch (cause) {
          return { ok: false, error: { kind: 'invalidPlan', message: cause instanceof Error ? cause.message : 'Invalid cutting plan.' } }
        }
        const bytes = await port.generate(document)
        return { ok: true, bytes }
      } catch (cause) {
        return {
          ok: false,
          error: { kind: 'generationFailure', message: cause instanceof Error ? cause.message : 'Could not generate the cutting plan PDF.' }
        }
      }
    },
  }
}
export type CuttingPlanPdfService = ReturnType<typeof createCuttingPlanPdfService>
