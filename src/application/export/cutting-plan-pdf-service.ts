import { createCuttingPlanScene, type CuttingPlanScene } from '../optimization/cutting-plan-scene'
import type { CuttingSettings } from '../../domain/model/cutting-settings'
import type { Part } from '../../domain/model/part'
import type { PanelSnapshot } from '../../domain/model/saved-cutting-plan'
import { computeAreaMetrics, type AreaMetrics, type PanelCuttingPlan, type UnplacedParts } from '../../domain/optimizer/plan-with-strategy'

export type PdfOrientation = 'portrait' | 'landscape'
export interface CuttingPlanPdfRequest {
  readonly plan: PanelCuttingPlan
  readonly panel: PanelSnapshot
  readonly parts: readonly Part[]
  readonly settings: CuttingSettings
  readonly materialName: string
  readonly orientation: PdfOrientation
  readonly edited: boolean
}
export interface CuttingPlanPdfDocument extends Omit<CuttingPlanPdfRequest, 'plan'> {
  readonly scene: CuttingPlanScene
  readonly metrics: AreaMetrics
  readonly unplaced: readonly UnplacedParts[]
}
export interface CuttingPlanPdfPort {
  generate(document: CuttingPlanPdfDocument): Promise<Uint8Array<ArrayBuffer>>
}
export type CuttingPlanPdfResult =
  | { readonly ok: true; readonly bytes: Uint8Array<ArrayBuffer> }
  | { readonly ok: false; readonly error: { readonly kind: 'invalidPlan' | 'generationFailure'; readonly message: string } }

/** Independently validate a detached snapshot; adapters never receive unvalidated geometry. */
export function createCuttingPlanPdfService(port: CuttingPlanPdfPort) {
  return {
    async export(request: CuttingPlanPdfRequest): Promise<CuttingPlanPdfResult> {
      try {
        const snapshot = structuredClone(request)
        const projection = createCuttingPlanScene(snapshot.plan, snapshot)
        if (projection.status !== 'valid') return { ok: false, error: { kind: 'invalidPlan', message: projection.status === 'invalid' ? projection.message : 'No cutting plan to export.' } }
        const { plan, ...metadata } = snapshot
        const placements = projection.scene.parts.map(part => ({ partId: part.part.id, copyIndex: part.copyIndex, orientation: part.orientation, region: part.region, dimensions: part.dimensions }))
        const bytes = await port.generate({ ...metadata, scene: projection.scene, metrics: computeAreaMetrics(snapshot.panel, placements), unplaced: plan.unplaced })
        return { ok: true, bytes }
      } catch (cause) {
        return { ok: false, error: { kind: 'generationFailure', message: cause instanceof Error ? cause.message : 'Could not generate the cutting plan PDF.' } }
      }
    },
  }
}
export type CuttingPlanPdfService = ReturnType<typeof createCuttingPlanPdfService>
