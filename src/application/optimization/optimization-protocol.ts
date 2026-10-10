import { cuttingSettingsSchema } from '../../domain/model/cutting-settings'
import { partSchema } from '../../domain/model/part'
import { PLACEMENT_STRATEGIES } from '../../domain/optimizer/plan-with-strategy'
import type { OptimizePanelSelection } from '../../domain/optimizer/optimize-panel'
import type { OptimizePanelInput } from '../../domain/optimizer/plan-with-strategy'

/**
 * Messages exchanged with the optimization worker. Values cross the thread boundary by structured clone,
 * so they must stay plain data (no functions or class instances).
 */
export interface OptimizeRequest {
  readonly type: 'optimize'
  /** Positive safe integer, unique per service instance. */
  readonly requestId: number
  readonly input: OptimizePanelInput
}

export type OptimizationWorkerError =
  /** The optimizer threw (e.g. duplicate part IDs or out-of-range geometry input). */
  | { readonly kind: 'optimizerError'; readonly message: string }
  /** The worker received a message that is not an `OptimizeRequest`. */
  | { readonly kind: 'invalidRequest'; readonly message: string }

export type OptimizationResponse =
  /** The optimizer ran; `selection` may itself be a domain failure such as `noUsableArea`. */
  | { readonly type: 'result'; readonly requestId: number; readonly selection: OptimizePanelSelection }
  /** `requestId` is `null` only when the request was unreadable. */
  | { readonly type: 'error'; readonly requestId: number | null; readonly error: OptimizationWorkerError }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isRequestId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/** Check the optimizer's required fields without stripping catalog or stock metadata. */
function isPanelSpec(value: unknown): boolean {
  if (!isRecord(value)) return false
  const fields = partSchema.shape
  return fields.materialId.safeParse(value.materialId).success &&
    fields.lengthMm.safeParse(value.lengthMm).success &&
    fields.widthMm.safeParse(value.widthMm).success &&
    fields.thicknessMm.safeParse(value.thicknessMm).success &&
    fields.grainDirection.safeParse(value.grainDirection).success
}

export function isOptimizeRequest(data: unknown): data is OptimizeRequest {
  if (!isRecord(data) || data.type !== 'optimize' || !isRequestId(data.requestId) || !isRecord(data.input)) {
    return false
  }
  const { panel, parts, settings } = data.input
  return isPanelSpec(panel) && Array.isArray(parts) && parts.every((part: unknown) =>
    isRecord(part) && isPanelSpec(part) && partSchema.shape.id.safeParse(part.id).success &&
    partSchema.shape.quantity.safeParse(part.quantity).success && partSchema.shape.rotation.safeParse(part.rotation).success,
  ) && cuttingSettingsSchema.safeParse(settings).success
}

/** Check tree structure before calling the geometric validator, including cyclic cloned data. */
function hasTreeStructure(root: unknown): boolean {
  const remaining: unknown[] = [root]
  const visited = new Set<unknown>()
  while (remaining.length > 0) {
    const node = remaining.pop()
    if (visited.has(node)) continue
    visited.add(node)
    if (!isRecord(node) || !isRecord(node.region)) return false
    const region = node.region
    if (!['xMm', 'yMm', 'lengthMm', 'widthMm'].every((key) => typeof region[key] === 'number')) return false
    if (node.kind === 'cut') {
      if (!isRecord(node.cut) || (node.cut.axis !== 'length' && node.cut.axis !== 'width') || typeof node.cut.offsetMm !== 'number') return false
      remaining.push(node.first, node.second)
    } else if (node.kind === 'part') {
      if (!partSchema.shape.id.safeParse(node.partId).success || typeof node.copyIndex !== 'number' ||
        (node.orientation !== 'normal' && node.orientation !== 'rotated')) return false
    } else if (node.kind !== 'waste') return false
  }
  return true
}

/** Checks the message envelope; plans in successful results are re-validated by the service. */
export function isOptimizationResponse(data: unknown): data is OptimizationResponse {
  if (!isRecord(data)) {
    return false
  }
  if (data.type === 'result') {
    if (!isRequestId(data.requestId) || !isRecord(data.selection)) return false
    const selection = data.selection
    if (selection.ok === false) {
      return isRecord(selection.error) && (selection.error.kind === 'noUsableArea' ||
        (selection.error.kind === 'noValidCandidate' && Array.isArray(selection.error.comparison)))
    }
    return selection.ok === true && PLACEMENT_STRATEGIES.some((strategy) => strategy === selection.strategy) &&
      Array.isArray(selection.comparison) && isRecord(selection.plan) && hasTreeStructure(selection.plan.tree) &&
      Array.isArray(selection.plan.placements) && Array.isArray(selection.plan.unplaced) && isRecord(selection.plan.metrics)
  }
  return (
    data.type === 'error' &&
    (data.requestId === null || isRequestId(data.requestId)) &&
    isRecord(data.error) &&
    (data.error.kind === 'optimizerError' || data.error.kind === 'invalidRequest') &&
    typeof data.error.message === 'string'
  )
}
