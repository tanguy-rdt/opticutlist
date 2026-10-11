import type { Repositories } from '../persistence/repositories'
export async function readCatalogTransferRecords(repositories: Repositories) {
  const projects = await repositories.projects.list(); if (!projects.ok) return projects
  const parts = await repositories.parts.list(); if (!parts.ok) return parts
  const materials = await repositories.materials.list(); if (!materials.ok) return materials
  const suppliers = await repositories.suppliers.list(); if (!suppliers.ok) return suppliers
  const products = await repositories.supplierProducts.list(); if (!products.ok) return products
  const stock = await repositories.stockItems.list(); if (!stock.ok) return stock
  return { ok: true, value: { materialReferences: [...stock.value.map(item => item.materialId), ...parts.value.map(part => part.materialId), ...projects.value.flatMap(project => project.materialIds), ...products.value.map(product => product.materialId)], supplierReferences: products.value.map(product => product.supplierId), productReferences: [...projects.value.flatMap(project => project.supplierProductIds), ...stock.value.flatMap(item => item.provenance.source === 'purchase' ? [item.provenance.supplierProductId] : [])], projects: projects.value.map(project => project.id), parts: [...parts.value.map(part => part.id), ...projects.value.flatMap(project => project.partIds)], materials: [...materials.value], suppliers: [...suppliers.value], products: [...products.value] } } as const
}
export async function readTransferRecords(repositories: Repositories) {
  const records = await readCatalogTransferRecords(repositories); if (!records.ok) return records
  const plans = await repositories.savedPlanSummaries.list(); if (!plans.ok) return plans
  const confirmations = await repositories.cuttingConfirmations.list(); if (!confirmations.ok) return confirmations
  return { ok: true, value: { ...records.value, plans: [...plans.value.map(plan => plan.id), ...confirmations.value.map(receipt => receipt.id)] } } as const
}
