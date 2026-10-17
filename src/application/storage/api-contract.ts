import { z } from 'zod'
import { materialSchema } from '../../domain/model/material'
import { partSchema } from '../../domain/model/part'
import { supplierSchema } from '../../domain/model/supplier'
import { supplierProductSchema } from '../../domain/model/supplier-product'
import { stockItemSchema } from '../../domain/model/stock-item'
import { cuttingProjectSchema } from '../../domain/model/cutting-project'
import { savedPlanSummarySchema, savedPlanContentsSchema, panelSnapshotSchema } from '../../domain/model/saved-cutting-plan'
import { cuttingConfirmationSchema } from '../../domain/model/cutting-confirmation'
import { projectStockSchema, projectOffcutSchema } from '../../domain/model/project-stock'
import { cuttingProjectIdSchema, partIdSchema, materialIdSchema } from '../../domain/model/ids'
import { catalogOrderSchema } from '../catalog/catalog-order'
import { stockOrderSchema } from '../inventory/stock-order'
import { catalogTransferSchema } from '../catalog/catalog-transfer-format'
import { stockTransferSchema } from '../inventory/stock-transfer-format'
import { projectTransferSchema } from '../projects/project-transfer-format'
import { partsTransferSchema } from '../projects/parts-transfer-format'
import { restoreSavedPlan } from '../plans/saved-plan-codec'

export const persistenceErrorSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('invalidRecord'),
    issues: z.array(z.strictObject({ path: z.array(z.union([z.string(), z.number()])), message: z.string() }))
  }),
  z.strictObject({ kind: z.literal('duplicateId'), id: z.string() }),
  z.strictObject({ kind: z.literal('notFound'), id: z.string() }),
  z.strictObject({ kind: z.literal('storageFailure'), message: z.string() }),
  z.strictObject({ kind: z.literal('referenceConflict'), message: z.string() }),
])
export const responseEnvelope = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), value: z.unknown().optional() }),
  z.strictObject({ ok: z.literal(false), error: persistenceErrorSchema }),
])
// Compact contents are validated and the derived plan is reconstructed, not trusted from JSON.
const opened = z.strictObject({ summary: savedPlanSummarySchema, contents: savedPlanContentsSchema, plan: z.unknown() }).transform(value => {
  if (value.summary.id !== value.contents.id || value.summary.projectId !== value.contents.projectId) {
    throw new Error('Inconsistent server plan identity.')
  }
  return { summary: value.summary, contents: value.contents, plan: restoreSavedPlan(value.contents) }
})
const candidate = z.strictObject({
  panelIndex: z.number().int().nonnegative(),
  wasteIndex: z.number().int().nonnegative(),
  panel: panelSnapshotSchema,
  materialName: z.string(),
  region: z.strictObject({
    xMm: z.number().nonnegative(),
    yMm: z.number().nonnegative(),
    lengthMm: z.number().positive(),
    widthMm: z.number().positive()
  })
})
const projectStockPreview = z.strictObject({
  saved: opened.nullable(),
  conflict: z.string().nullable(),
  movements: projectStockSchema.shape.movements,
  rows: z.array(z.strictObject({
    key: z.string(),
    candidate,
    entry: projectOffcutSchema.optional(),
    keep: z.boolean(),
    status: z.enum(['Not added', 'Available', 'Consumed', 'Outdated']),
    modified: z.boolean()
  }).transform(row => ({ ...row, entry: row.entry })))
})
const confirmationPreview = z.strictObject({
  saved: opened,
  stock: z.array(stockItemSchema),
  offcuts: z.array(candidate),
  confirmation: cuttingConfirmationSchema.nullable()
})
const projectPreview = z.strictObject({
  file: projectTransferSchema,
  projectIdCollision: z.boolean(),
  catalogConflicts: z.number().int(),
  reusedCatalogRecords: z.number().int()
})
const catalogPreview = z.strictObject({ file: catalogTransferSchema, conflicts: z.number().int(), reused: z.number().int() })
const stockPreview = z.strictObject({ file: stockTransferSchema, added: z.number().int(), reused: z.number().int() })
const partsPreview = z.strictObject({
  file: partsTransferSchema,
  materials: z.array(materialSchema),
  materialIds: z.array(materialIdSchema.nullable())
})
const empty = z.null().transform(() => undefined)
function operation<A, T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', args: z.ZodType<A>, value: z.ZodType<T>) {
  return { method, args, value }
}

export const operations = {
  'catalog.materials.list': operation('GET', z.tuple([]), z.array(materialSchema)),
  'catalog.materials.get': operation('GET', z.tuple([materialSchema.shape.id]), materialSchema),
  'catalog.materials.create': operation('POST', z.tuple([z.unknown()]), materialSchema),
  'catalog.materials.update': operation('PUT', z.tuple([materialSchema.shape.id, z.unknown()]), materialSchema),
  'catalog.materials.delete': operation('DELETE', z.tuple([materialSchema.shape.id]), empty),
  'catalog.suppliers.list': operation('GET', z.tuple([]), z.array(supplierSchema)),
  'catalog.suppliers.get': operation('GET', z.tuple([supplierSchema.shape.id]), supplierSchema),
  'catalog.suppliers.create': operation('POST', z.tuple([z.unknown()]), supplierSchema),
  'catalog.suppliers.update': operation('PUT', z.tuple([supplierSchema.shape.id, z.unknown()]), supplierSchema),
  'catalog.suppliers.delete': operation('DELETE', z.tuple([supplierSchema.shape.id]), empty),
  'catalog.products.list': operation('GET', z.tuple([]), z.array(supplierProductSchema)),
  'catalog.products.get': operation('GET', z.tuple([supplierProductSchema.shape.id]), supplierProductSchema),
  'catalog.products.create': operation('POST', z.tuple([z.unknown()]), supplierProductSchema),
  'catalog.products.update': operation('PUT', z.tuple([supplierProductSchema.shape.id, z.unknown()]), supplierProductSchema),
  'catalog.products.delete': operation('DELETE', z.tuple([supplierProductSchema.shape.id]), empty),
  'projects.records.list': operation('GET', z.tuple([]), z.array(cuttingProjectSchema)),
  'projects.records.get': operation('GET', z.tuple([cuttingProjectSchema.shape.id]), cuttingProjectSchema),
  'projects.records.create': operation('POST', z.tuple([z.unknown()]), cuttingProjectSchema),
  'projects.records.update': operation('PUT', z.tuple([cuttingProjectSchema.shape.id, z.unknown()]), cuttingProjectSchema),
  'projects.records.delete': operation('DELETE', z.tuple([cuttingProjectSchema.shape.id]), empty),
  'stock.list': operation('GET', z.tuple([]), z.array(stockItemSchema)),
  'stock.get': operation('GET', z.tuple([stockItemSchema.shape.id]), stockItemSchema),
  'stock.create': operation('POST', z.tuple([z.unknown()]), stockItemSchema),
  'stock.update': operation('PUT', z.tuple([stockItemSchema.shape.id, z.unknown(), stockItemSchema.optional()]), stockItemSchema),
  'stock.delete': operation('DELETE', z.tuple([stockItemSchema.shape.id, stockItemSchema.optional()]), empty),
  'parts.list': operation('GET', z.tuple([cuttingProjectIdSchema]), z.array(partSchema)),
  'parts.get': operation('GET', z.tuple([cuttingProjectIdSchema, partIdSchema]), partSchema),
  'parts.create': operation('POST', z.tuple([cuttingProjectIdSchema, z.unknown()]), partSchema),
  'parts.createMany': operation('POST', z.tuple([cuttingProjectIdSchema, z.array(z.unknown())]), z.array(partSchema)),
  'parts.update': operation('PUT', z.tuple([cuttingProjectIdSchema, partIdSchema, z.unknown()]), partSchema),
  'parts.delete': operation('DELETE', z.tuple([cuttingProjectIdSchema, partIdSchema]), empty),
  'projects.deletionPreview': operation('GET', z.tuple([cuttingProjectIdSchema]), z.strictObject({ restorationIssues: z.array(z.string()) })),
  'projects.delete': operation('DELETE', z.tuple([cuttingProjectIdSchema, z.enum(['keep', 'restore'])]), empty),
  'projects.legacyParts': operation('GET', z.tuple([]), z.array(partSchema)),
  'projects.adopt': operation('POST', z.tuple([cuttingProjectIdSchema, z.array(partIdSchema)]), empty),
  'catalog.products.ordering': operation('GET', z.tuple([]), z.array(catalogOrderSchema)),
  'catalog.products.move': operation('POST', z.tuple([supplierProductSchema.shape.id, supplierProductSchema.shape.id, z.enum(['before', 'after'])]), catalogOrderSchema),
  'catalog.products.saveWithPreset': operation('POST', z.tuple([z.unknown(), z.string(), supplierProductSchema.shape.id.optional()]), supplierProductSchema),
  'stock.ordering': operation('GET', z.tuple([]), z.array(stockOrderSchema)),
  'stock.move': operation('POST', z.tuple([stockItemSchema.shape.id, stockItemSchema.shape.id, z.enum(['before', 'after'])]), stockOrderSchema),
  'stock.addFromProduct': operation('POST', z.tuple([supplierProductSchema, z.unknown()]), z.array(stockItemSchema)),
  'stock.saveWithPreset': operation('POST', z.tuple([z.unknown(), z.string(), stockItemSchema.optional()]), stockItemSchema),
  'stock.selectionStock': operation('GET', z.tuple([cuttingProjectIdSchema]), z.array(stockItemSchema)),
  'stock.planningStock': operation('GET', z.tuple([cuttingProjectIdSchema]), z.array(stockItemSchema)),
  'stock.history': operation('GET', z.tuple([stockItemSchema.shape.id]), z.array(cuttingConfirmationSchema)),
  'current.load': operation('POST', z.tuple([cuttingProjectIdSchema]), z.strictObject({ result: opened.nullable(), ambiguousLegacyCount: z.number().int().nonnegative() })),
  'current.replace': operation('PUT', z.tuple([cuttingProjectIdSchema, savedPlanContentsSchema, z.array(z.number().int().nonnegative())]), opened),
  'projectStock.preview': operation('GET', z.tuple([cuttingProjectIdSchema]), projectStockPreview),
  'projectStock.sync': operation('POST', z.tuple([cuttingProjectIdSchema]), empty),
  'projectStock.setKeep': operation('POST', z.tuple([cuttingProjectIdSchema, z.string(), z.boolean()]), empty),
  'confirmations.list': operation('GET', z.tuple([cuttingProjectIdSchema]), z.array(cuttingConfirmationSchema)),
  'confirmations.preview': operation('GET', z.tuple([cuttingProjectIdSchema, savedPlanSummarySchema.shape.id]), confirmationPreview),
  'confirmations.confirm': operation('POST', z.tuple([cuttingProjectIdSchema, savedPlanSummarySchema.shape.id, z.unknown()]), cuttingConfirmationSchema),
  'catalogTransfer.export': operation('GET', z.tuple([]), z.string()),
  'catalogTransfer.preview': operation('POST', z.tuple([z.string()]), catalogPreview),
  'catalogTransfer.import': operation('POST', z.tuple([z.unknown(), z.boolean()]), catalogTransferSchema),
  'stockTransfer.export': operation('GET', z.tuple([]), z.string()),
  'stockTransfer.preview': operation('POST', z.tuple([z.string()]), stockPreview),
  'stockTransfer.import': operation('POST', z.tuple([z.unknown(), z.boolean()]), stockTransferSchema),
  'projectTransfer.export': operation('GET', z.tuple([cuttingProjectIdSchema]), z.strictObject({ text: z.string(), name: z.string() })),
  'projectTransfer.preview': operation('POST', z.tuple([z.string()]), projectPreview),
  'projectTransfer.import': operation('POST', z.tuple([z.unknown(), z.boolean()]), cuttingProjectSchema),
  'partsTransfer.preview': operation('POST', z.tuple([cuttingProjectIdSchema, z.string()]), partsPreview),
  'partsTransfer.import': operation('POST', z.tuple([cuttingProjectIdSchema, z.unknown(), z.array(materialIdSchema.nullable()), z.boolean()]), z.number().int().nonnegative()),
}
