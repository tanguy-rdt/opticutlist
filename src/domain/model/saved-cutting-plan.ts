import { z } from 'zod'
import { cuttingProjectIdSchema, partIdSchema, savedCuttingPlanIdSchema, stockItemIdSchema, supplierProductIdSchema } from './ids'
import { nameSchema } from './common'
import { partSchema } from './part'
import { supplierProductSchema } from './supplier-product'
import { cuttingSettingsSchema } from './cutting-settings'
import { panelQuantitySchema } from './cutting-project'
import { PLACEMENT_STRATEGIES } from '../optimizer/plan-with-strategy'

/** Historical geometry/identity only: no price, currency, URL or catalog availability. */
export const panelSnapshotSchema = supplierProductSchema.pick({ id: true, name: true, materialId: true, lengthMm: true, widthMm: true, thicknessMm: true, grainDirection: true }).extend({
  // Allocation keys are not catalog records; stock keys retain their distinct origin.
  id: z.string().min(1).max(134).regex(/^\S+$/).brand<'SupplierProductId'>(),
  stockItemId: stockItemIdSchema.optional(),
}).refine(panel => panel.stockItemId === undefined ? supplierProductIdSchema.safeParse(panel.id).success : panel.id === `stock:${panel.stockItemId}`, 'Invalid panel source identity')
export type PanelSnapshot = z.infer<typeof panelSnapshotSchema>
const compactTreeShape = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('cut'),
    cut: z.strictObject({ axis: z.enum(['length', 'width']), offsetMm: z.number().positive() }),
    get first() {
      return compactTreeShape
    },
    get second() {
      return compactTreeShape
    },
  }),
  z.strictObject({
    kind: z.literal('part'),
    partId: partIdSchema,
    copyIndex: z.number().int().nonnegative(),
    orientation: z.enum(['normal', 'rotated'])
  }),
  z.strictObject({ kind: z.literal('waste') }),
])
// IndexedDB structured clones can retain cycles; reject them before recursive Zod parsing.
export const compactTreeSchema = z.unknown().superRefine((root, context) => {
  const visited = new Set<object>()
  const pending: unknown[] = [root]
  while (pending.length) {
    const node = pending.pop()
    if (typeof node !== 'object' || node === null) {
      continue
    }
    if (visited.has(node)) {
      context.addIssue({ code: 'custom', message: 'A saved cutting tree contains a cyclic or reused node.' });
      return
    }
    visited.add(node)
    if ('kind' in node && node.kind === 'cut') {
      if ('first' in node) {
        pending.push(node.first)
      }
      if ('second' in node) {
        pending.push(node.second)
      }
    }
  }
}).pipe(compactTreeShape)
export type CompactTree = z.infer<typeof compactTreeSchema>
export const savedPlanSummarySchema = z.strictObject({
  id: savedCuttingPlanIdSchema,
  projectId: cuttingProjectIdSchema,
  name: nameSchema,
  createdAt: z.iso.datetime(),
})
export type SavedPlanSummary = z.infer<typeof savedPlanSummarySchema>
export const savedPlanContentsSchema = z.strictObject({
  id: savedCuttingPlanIdSchema,
  projectId: cuttingProjectIdSchema,
  formatVersion: z.literal(1),
  settings: cuttingSettingsSchema,
  parts: z.array(partSchema),
  sources: z.array(z.strictObject({ product: panelSnapshotSchema, quantity: panelQuantitySchema, materialName: nameSchema, supplierName: nameSchema })),
  panels: z.array(z.strictObject({
    supplierProductId: panelSnapshotSchema.shape.id,
    panelCopyIndex: z.number().int().nonnegative(),
    strategy: z.enum(PLACEMENT_STRATEGIES),
    edited: z.boolean(),
    tree: compactTreeSchema,
    unplacedReasons: z.array(z.strictObject({ partId: partIdSchema, kind: z.enum(['cannotFitPanel', 'remainderNarrowerThanKerf']) })).optional()
  })),
  unplaced: z.array(z.strictObject({
    partId: partIdSchema,
    firstCopyIndex: z.number().int().nonnegative(),
    count: z.number().int().positive(),
    reason: z.enum(['noCompatiblePanel', 'constraintsPreventPlacement', 'panelLimitReached'])
  })),
  metrics: z.strictObject({
    panelAreaMm2: z.number().nonnegative(),
    usedAreaMm2: z.number().nonnegative(),
    wasteAreaMm2: z.number().nonnegative(),
    utilizationPercent: z.number().min(0).max(100),
    placedCount: z.number().int().nonnegative(),
    unplacedCount: z.number().int().nonnegative(),
    panelCount: z.number().int().nonnegative()
  }),
})
export type SavedPlanContents = z.infer<typeof savedPlanContentsSchema>
