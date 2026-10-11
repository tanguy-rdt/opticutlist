import type { CuttingProjectId, MaterialId, SupplierId, SupplierProductId, PartId, SavedCuttingPlanId } from '../../domain/model/ids'
import { cuttingProjectIdSchema, materialIdSchema, partIdSchema, savedCuttingPlanIdSchema, supplierIdSchema, supplierProductIdSchema } from '../../domain/model/ids'
import type { CompactTree } from '../../domain/model/saved-cutting-plan'
import type { ProjectTransfer } from './project-transfer-format'

interface ExistingIds {
  materialReferences: readonly string[]
  supplierReferences: readonly string[]
  productReferences: readonly string[]
  projects: readonly string[]
  parts: readonly string[]
  plans: readonly string[]
  materials: readonly ProjectTransfer['catalog']['materials'][number][]
  suppliers: readonly ProjectTransfer['catalog']['suppliers'][number][]
  products: readonly ProjectTransfer['catalog']['products'][number][]
}
/** Preserve identities unless occupied. Never equate distinct opaque material IDs by a name alone. */
function ids<T extends string>(incoming: readonly T[], existing: readonly string[], parseId: (id: string) => T): Map<T, T> {
  const used = new Set([...incoming, ...existing])
  return new Map([...new Set(incoming)].map(id => {
    if (!existing.includes(id)) return [id, id]
    for (let attempts = 0; attempts < 100; attempts += 1) {
      const fresh = parseId(crypto.randomUUID())
      if (!used.has(fresh)) { used.add(fresh); return [id, fresh] }
    }
    throw new Error('Could not allocate a unique imported entity ID.')
  }))
}
function mapped<T extends string>(map: ReadonlyMap<T, T>, id: NoInfer<T>): T {
  const result = map.get(id)
  if (result === undefined) throw new Error('An imported relationship has no ID mapping.')
  return result
}
function identical<T extends { id: string }>(first: T, second: T): boolean {
  return JSON.stringify(Object.entries(first).filter(([, value]: [string, unknown]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b))) === JSON.stringify(Object.entries(second).filter(([, value]: [string, unknown]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)))
}
export function remapProjectTransfer(file: ProjectTransfer, existing: ExistingIds): ProjectTransfer {
  const projectId = mapped(ids<CuttingProjectId>([file.project.id], existing.projects, value => cuttingProjectIdSchema.parse(value)), file.project.id)
  const materialIds = ids<MaterialId>([...file.catalog.materials.map(item => item.id), ...file.savedPlans.flatMap(plan => [...plan.contents.parts.map(part => part.materialId), ...plan.contents.sources.map(source => source.product.materialId)])], [...existing.materials.map(item => item.id), ...existing.materialReferences], value => materialIdSchema.parse(value))
  const supplierIds = ids<SupplierId>(file.catalog.suppliers.map(item => item.id), [...existing.suppliers.map(item => item.id), ...existing.supplierReferences], value => supplierIdSchema.parse(value))
  const productIds = ids<SupplierProductId>([...file.catalog.products.map(item => item.id), ...file.savedPlans.flatMap(plan => plan.contents.sources.map(source => source.product.id))], [...existing.products.map(item => item.id), ...existing.productReferences], value => supplierProductIdSchema.parse(value))
  for (const item of file.catalog.materials) if (existing.materials.some(record => record.id === item.id && identical(item, record))) materialIds.set(item.id, item.id)
  for (const item of file.catalog.suppliers) if (existing.suppliers.some(record => record.id === item.id && identical(item, record))) supplierIds.set(item.id, item.id)
  const materials = file.catalog.materials.map(item => ({ ...item, id: mapped(materialIds, item.id) }))
  const suppliers = file.catalog.suppliers.map(item => ({ ...item, id: mapped(supplierIds, item.id) }))
  const products = file.catalog.products.map(item => {
    const updated = { ...item, materialId: mapped(materialIds, item.materialId), supplierId: mapped(supplierIds, item.supplierId) }
    if (existing.products.some(record => record.id === item.id && identical(updated, record))) productIds.set(item.id, item.id)
    return { ...updated, id: mapped(productIds, item.id) }
  })
  const partIds = ids<PartId>([...file.parts.map(part => part.id), ...file.savedPlans.flatMap(plan => plan.contents.parts.map(part => part.id))], existing.parts, value => partIdSchema.parse(value))
  const planIds = ids<SavedCuttingPlanId>(file.savedPlans.map(plan => plan.summary.id), existing.plans, value => savedCuttingPlanIdSchema.parse(value))
  function tree(node: CompactTree): CompactTree {
    if (node.kind === 'cut') return { ...node, first: tree(node.first), second: tree(node.second) }
    return node.kind === 'part' ? { ...node, partId: mapped(partIds, node.partId) } : { ...node }
  }
  const part = (item: ProjectTransfer['parts'][number]) => ({ ...item, id: mapped(partIds, item.id), materialId: mapped(materialIds, item.materialId) })
  return { ...file, project: { ...file.project, id: projectId, partIds: file.project.partIds.map(id => mapped(partIds, id)), materialIds: file.project.materialIds.map(id => mapped(materialIds, id)), supplierProductIds: file.project.supplierProductIds.map(id => mapped(productIds, id)), ...(file.project.panelQuantities === undefined ? {} : { panelQuantities: file.project.panelQuantities.map(item => ({ ...item, supplierProductId: mapped(productIds, item.supplierProductId) })) }) },
    parts: file.parts.map(part), catalog: { materials, suppliers, products },
    savedPlans: file.savedPlans.map(plan => ({ summary: { ...plan.summary, id: mapped(planIds, plan.summary.id), projectId }, contents: { ...plan.contents, id: mapped(planIds, plan.contents.id), projectId,
      parts: plan.contents.parts.map(part), sources: plan.contents.sources.map(source => ({ ...source, product: { ...source.product, id: mapped(productIds, source.product.id), materialId: mapped(materialIds, source.product.materialId) } })),
      panels: plan.contents.panels.map(panel => ({ ...panel, supplierProductId: mapped(productIds, panel.supplierProductId), tree: tree(panel.tree), ...(panel.unplacedReasons === undefined ? {} : { unplacedReasons: panel.unplacedReasons.map(item => ({ ...item, partId: mapped(partIds, item.partId) })) }) })), unplaced: plan.contents.unplaced.map(item => ({ ...item, partId: mapped(partIds, item.partId) })),
    } })),
  }
}
