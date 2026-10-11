import type { CuttingSettings } from '../model/cutting-settings'
import type { Part } from '../model/part'
import type { SupplierProduct } from '../model/supplier-product'
import type { PartId, SupplierProductId } from '../model/ids'
import type { AreaMetrics, PanelCuttingPlan, PlacementStrategy } from './plan-with-strategy'

export interface AvailablePanel { readonly product: SupplierProduct; readonly quantity: number }
export interface OptimizeProjectInput {
  readonly panels: readonly AvailablePanel[]
  readonly parts: readonly Part[]
  readonly settings: CuttingSettings
}
export interface AllocatedPanel {
  readonly supplierProductId: SupplierProductId
  readonly panelCopyIndex: number
  readonly strategy: PlacementStrategy
  readonly plan: PanelCuttingPlan
}
export interface ProjectUnplacedParts {
  readonly partId: PartId
  readonly firstCopyIndex: number
  readonly count: number
  readonly reason: 'noCompatiblePanel' | 'constraintsPreventPlacement' | 'panelLimitReached'
}
export interface ProjectCuttingPlan {
  readonly panels: readonly AllocatedPanel[]
  readonly unplaced: readonly ProjectUnplacedParts[]
  readonly metrics: AreaMetrics & { readonly placedCount: number; readonly unplacedCount: number; readonly panelCount: number }
}
export interface ProjectPlanIssue {
  readonly kind: 'invalidTree' | 'invalidPanel' | 'panelLimit' | 'emptyPanel' | 'invalidAccounting' | 'invalidMetrics'
  readonly panelIndex?: number
  readonly message: string
}
export type OptimizeProjectResult =
  | { readonly ok: true; readonly plan: ProjectCuttingPlan }
  | { readonly ok: false; readonly error: { readonly kind: 'invalidInput' | 'invalidPlan'; readonly message: string; readonly issues: readonly ProjectPlanIssue[] } }
