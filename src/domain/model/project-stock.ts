import { z } from 'zod'
import { tryToMicrometres } from '../geometry/units'
import { cuttingProjectIdSchema, savedCuttingPlanIdSchema, stockItemIdSchema } from './ids'
import { panelSnapshotSchema } from './saved-cutting-plan'
import { stockItemSchema } from './stock-item'
import { dimensions3DSchema } from './dimensions'
import { nameSchema } from './common'

export const projectOffcutSchema = z.strictObject({
  id: stockItemIdSchema,
  planId: savedCuttingPlanIdSchema,
  panelIndex: z.number().int().nonnegative(),
  panelCopyIndex: z.number().int().nonnegative(),
  wasteIndex: z.number().int().nonnegative(),
  panel: panelSnapshotSchema,
  materialName: nameSchema,
  region: z.strictObject({
    xMm: z.number().nonnegative(),
    yMm: z.number().nonnegative(),
    lengthMm: dimensions3DSchema.shape.lengthMm,
    widthMm: dimensions3DSchema.shape.widthMm
  }),
  keep: z.boolean(),
  removed: z.boolean().default(false),
  stock: stockItemSchema.nullable(),
}).superRefine((entry, context) => {
  const x = tryToMicrometres(entry.region.xMm, 0)
  const y = tryToMicrometres(entry.region.yMm, 0)
  const length = tryToMicrometres(entry.region.lengthMm, 1)
  const width = tryToMicrometres(entry.region.widthMm, 1)
  const panelLength = tryToMicrometres(entry.panel.lengthMm, 1)
  const panelWidth = tryToMicrometres(entry.panel.widthMm, 1)
  if (x === null || y === null || length === null || width === null || panelLength === null || panelWidth === null || !Number.isSafeInteger(x + length)
    || !Number.isSafeInteger(y + width)
    || x + length > panelLength
    || y + width > panelWidth) context.addIssue({
      code: 'custom',
      path: ['region'],
      message: 'The offcut must lie within its physical source panel at supported geometry resolution.'
    })
  const stock = entry.stock
  if (!stock) return
  const provenance = stock.provenance
  if (stock.kind !== 'offcut' || stock.quantity !== 1 || stock.materialId !== entry.panel.materialId || stock.thicknessMm !== entry.panel.thicknessMm
    || stock.grainDirection !== entry.panel.grainDirection
    || tryToMicrometres(stock.lengthMm, 1) !== length
    || tryToMicrometres(stock.widthMm, 1) !== width
    || provenance.source !== 'cutting'
    || provenance.savedPlanId !== entry.planId
    || provenance.panelIndex !== entry.panelIndex
    || provenance.wasteIndex !== entry.wasteIndex
    || entry.panel.stockItemId !== undefined && provenance.sourceStockItemId !== entry.panel.stockItemId) context.addIssue({
      code: 'custom',
      path: ['stock'],
      message: 'The original offcut snapshot must match its geometry, material, grain and cutting provenance.'
    })
})
export type ProjectOffcut = z.infer<typeof projectOffcutSchema>
export const projectStockSchema = z.strictObject({
  id: cuttingProjectIdSchema,
  entries: z.array(projectOffcutSchema),
  deletedProject: z.strictObject({ name: nameSchema, deletedAt: z.iso.datetime(), stockHandling: z.enum(['keep', 'restore']) }).optional(),
  conflict: z.string().nullable().default(null),
  consumed: z.array(z.strictObject({ stock: stockItemSchema, quantity: z.number().int().positive() }).refine(movement => movement.quantity <= movement.stock.quantity, 'Movement quantity cannot exceed its source snapshot')).default([]),
  movements: z.array(z.strictObject({
    id: stockItemIdSchema,
    planId: savedCuttingPlanIdSchema,
    createdAt: z.iso.datetime(),
    added: z.array(stockItemSchema),
    removed: z.array(stockItemSchema),
    consumed: z.array(z.strictObject({ stock: stockItemSchema, quantity: z.number().int().positive() }).refine(movement => movement.quantity <= movement.stock.quantity, 'Movement quantity cannot exceed its source snapshot')).default([]),
    restored: z.array(z.strictObject({ stock: stockItemSchema, quantity: z.number().int().positive() }).refine(movement => movement.quantity <= movement.stock.quantity, 'Movement quantity cannot exceed its source snapshot')).default([]),
  })),
}).superRefine((value, context) => {
  if (new Set(value.entries.map(entry => entry.id)).size !== value.entries.length) context.addIssue({ code: 'custom', path: ['entries'], message: 'Offcut identities must be unique.' })
  if (new Set(value.entries.flatMap(entry => entry.stock ? [entry.stock.id] : [])).size !== value.entries.filter(entry => entry.stock).length) context.addIssue({ code: 'custom', path: ['entries'], message: 'Physical offcut identities must be unique.' })
  if (new Set(value.movements.map(movement => movement.id)).size !== value.movements.length) context.addIssue({ code: 'custom', path: ['movements'], message: 'Stock update identities must be unique.' })
  for (const movement of value.movements) for (const stock of [...movement.added, ...movement.removed]) if (stock.kind !== 'offcut' || stock.provenance.source !== 'cutting' || stock.provenance.projectId !== value.id) context.addIssue({ code: 'custom', path: ['movements'], message: 'Stock updates can only contain this project’s offcuts.' })
  for (const entry of value.entries) if (entry.stock && (entry.stock.provenance.source !== 'cutting' || entry.stock.provenance.projectId !== value.id)) context.addIssue({ code: 'custom', path: ['entries'], message: 'Offcuts must retain their project cutting provenance.' })
})
export type ProjectStock = z.infer<typeof projectStockSchema>
