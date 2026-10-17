import { ids, mapped, remapCatalog } from '../catalog/remap-catalog'
import type { CuttingProjectId, PartId, SavedCuttingPlanId } from '../../domain/model/ids'
import { cuttingProjectIdSchema, partIdSchema, savedCuttingPlanIdSchema } from '../../domain/model/ids'
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

export function remapProjectTransfer(file: ProjectTransfer, existing: ExistingIds): ProjectTransfer {
  const projectId = mapped(ids<CuttingProjectId>([file.project.id], existing.projects, value => cuttingProjectIdSchema.parse(value)), file.project.id)
  const { catalog, materialIds, productIds } = remapCatalog(file.catalog, existing, {
    materials: file.savedPlans.flatMap(plan => [...plan.contents.parts.map(part => part.materialId), ...plan.contents.sources.map(source => source.product.materialId)]),
    products: file.savedPlans.flatMap(plan => plan.contents.sources.filter(source => source.product.stockItemId === undefined).map(source => source.product.id))
  })
  const partIds = ids<PartId>([...file.parts.map(part => part.id), ...file.savedPlans.flatMap(plan => plan.contents.parts.map(part => part.id))], existing.parts, value => partIdSchema.parse(value))
  const planIds = ids<SavedCuttingPlanId>(file.savedPlans.map(plan => plan.summary.id), existing.plans, value => savedCuttingPlanIdSchema.parse(value))

  function tree(node: CompactTree): CompactTree {
    if (node.kind === 'cut') {
      return { ...node, first: tree(node.first), second: tree(node.second) }
    }
    return node.kind === 'part' ? { ...node, partId: mapped(partIds, node.partId) } : { ...node }
  }

  const part = (item: ProjectTransfer['parts'][number]) => ({ ...item, id: mapped(partIds, item.id), materialId: mapped(materialIds, item.materialId) })
  return {
    ...file,
    project: {
      ...file.project,
      id: projectId,
      partIds: file.project.partIds.map(id => mapped(partIds, id)),
      materialIds: file.project.materialIds.map(id => mapped(materialIds, id)),
      supplierProductIds: file.project.supplierProductIds.map(id => mapped(productIds, id)),
      ...(file.project.panelQuantities === undefined ? {} : { panelQuantities: file.project.panelQuantities.map(item => ({ ...item, supplierProductId: mapped(productIds, item.supplierProductId) })) })
    },
    ...(file.currentResultId === undefined ? {} : { currentResultId: mapped(planIds, file.currentResultId) }),
    parts: file.parts.map(part),
    catalog,
    savedPlans: file.savedPlans.map(plan => ({
      summary: { ...plan.summary, id: mapped(planIds, plan.summary.id), projectId },
      contents: {
        ...plan.contents,
        id: mapped(planIds, plan.contents.id),
        projectId,
        parts: plan.contents.parts.map(part),
        sources: plan.contents.sources.map(source => ({
          ...source,
          product: {
            ...source.product,
            id: source.product.stockItemId === undefined ? mapped(productIds, source.product.id) : source.product.id,
            materialId: mapped(materialIds, source.product.materialId)
          }
        })),
        panels: plan.contents.panels.map(panel => ({
          ...panel,
          supplierProductId: plan.contents.sources.some(source => source.product.id === panel.supplierProductId && source.product.stockItemId !== undefined) ? panel.supplierProductId : mapped(productIds, panel.supplierProductId),
          tree: tree(panel.tree),
          ...(panel.unplacedReasons === undefined ? {} : { unplacedReasons: panel.unplacedReasons.map(item => ({ ...item, partId: mapped(partIds, item.partId) })) })
        })),
        unplaced: plan.contents.unplaced.map(item => ({ ...item, partId: mapped(partIds, item.partId) })),
      }
    })),
  }
}
