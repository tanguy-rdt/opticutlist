import type { CuttingProjectId } from '../../domain/model/ids'
import { stockItemIdSchema } from '../../domain/model/ids'
import type { StockItem } from '../../domain/model/stock-item'
import type { ProjectStock } from '../../domain/model/project-stock'
import type { PersistenceResult, Repositories } from '../persistence/repositories'

export type ProjectStockHandling = 'keep' | 'restore'
export interface ProjectDeletionPreview { readonly restorationIssues: readonly string[] }
const conflict = (message: string): PersistenceResult<never> => ({ ok: false, error: { kind: 'referenceConflict', message } })
const same = (a: StockItem, b: StockItem): boolean => JSON.stringify(a) === JSON.stringify(b)

async function inspect(repositories: Repositories, id: CuttingProjectId) {
  const project = await repositories.projects.get(id)
  if (!project.ok) return project
  const stock = await repositories.stockItems.list()
  if (!stock.ok) return stock
  const ledgers = await repositories.projectStock.list()
  if (!ledgers.ok) return ledgers
  const receipts = await repositories.cuttingConfirmations.list()
  if (!receipts.ok) return receipts
  const projects = await repositories.projects.list()
  if (!projects.ok) return projects
  const ledger = ledgers.value.find(item => item.id === id)
  const issues: string[] = []
  const sources = new Map<StockItem['id'], { stock: StockItem; quantity: number }>()
  const offcuts = new Map<StockItem['id'], StockItem>()
  const events = [
    ...receipts.value.filter(item => item.projectId === id).map(item => ({ createdAt: item.confirmedAt, consumed: item.consumed, restored: [], added: item.offcuts, removed: [] })),
    ...(ledger?.movements ?? []),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  for (const event of events) {
    for (const movement of event.consumed) {
      const prior = sources.get(movement.stock.id)
      if (prior && !same({ ...prior.stock, quantity: movement.stock.quantity }, movement.stock)) issues.push('Recorded source snapshots disagree; restoration is ambiguous.')
      sources.set(movement.stock.id, { stock: prior?.stock ?? movement.stock, quantity: (prior?.quantity ?? 0) + movement.quantity })
    }
    for (const movement of event.restored) {
      const prior = sources.get(movement.stock.id)
      if (!prior) issues.push('A stock reversal has no recorded original deduction.')
      else {
        if (!same({ ...prior.stock, quantity: movement.stock.quantity }, movement.stock)) issues.push('A stock reversal has inconsistent source provenance.')
        prior.quantity -= movement.quantity
      }
    }
    for (const item of event.added) {
      if (item.provenance.source !== 'cutting' || item.provenance.projectId !== id || offcuts.has(item.id)) issues.push('Offcut creation history has missing or duplicate provenance.')
      offcuts.set(item.id, item)
    }
    for (const item of event.removed) {
      const original = offcuts.get(item.id)
      if (!original || !same(original, item)) issues.push('An offcut removal has no matching original creation snapshot.')
      offcuts.delete(item.id)
    }
  }
  for (const entry of ledger?.consumed ?? []) if (!sources.has(entry.stock.id)) issues.push('A consumed source has no complete movement history.')
  for (const entry of ledger?.entries ?? []) if (entry.stock && !entry.removed && !offcuts.has(entry.stock.id)) issues.push('An offcut lacks a complete recorded creation history.')
  const inventory = new Map(stock.value.map(item => [item.id, item]))
  const usedElsewhere = (stockId: StockItem['id']) => projects.value.some(project => project.id !== id && project.stockItemIds?.includes(stockId))
    || ledgers.value.some(other => other.id !== id && (other.consumed.some(item => item.stock.id === stockId) || other.movements.some(movement => movement.consumed.some(item => item.stock.id === stockId))))
    || receipts.value.some(receipt => receipt.projectId !== id && receipt.consumed.some(item => item.stock.id === stockId))
  for (const [stockId, source] of sources) {
    if (!Number.isSafeInteger(source.quantity) || source.quantity < 0 || source.quantity > source.stock.quantity) { issues.push('Recorded source quantities are inconsistent.'); continue }
    if (!source.quantity) continue
    const current = inventory.get(stockId)
    const remaining = source.stock.quantity - source.quantity
    if (remaining === 0 ? current !== undefined : !current || !same(current, { ...source.stock, quantity: remaining })) issues.push(`Source stock ${stockId} was modified or consumed elsewhere.`)
    if (usedElsewhere(stockId)) issues.push(`Source stock ${stockId} is referenced or consumed by another project.`)
  }
  for (const [stockId, offcut] of offcuts) {
    const current = inventory.get(stockId)
    if (!current || !same(current, offcut)) issues.push(`Generated offcut ${stockId} was consumed, removed or modified.`)
    if (usedElsewhere(stockId)) issues.push(`Generated offcut ${stockId} is referenced or consumed by another project.`)
  }
  for (const item of stock.value) if (item.provenance.source === 'cutting' && item.provenance.projectId === id && !offcuts.has(item.id)) issues.push(`Generated stock ${item.id} has missing or ambiguous movement history.`)
  return { ok: true as const, value: { project: project.value, ledger, sources, offcuts, issues: [...new Set(issues)], projects: projects.value, inventory, planId: ledger?.movements.at(-1)?.planId ?? receipts.value.filter(receipt => receipt.projectId === id).at(-1)?.id } }
}

export async function previewProjectDeletion(repositories: Repositories, id: CuttingProjectId): Promise<PersistenceResult<ProjectDeletionPreview>> {
  const result = await inspect(repositories, id)
  return result.ok ? { ok: true, value: { restorationIssues: result.value.issues } } : result
}

export async function deleteProjectData(repositories: Repositories, id: CuttingProjectId, handling: ProjectStockHandling): Promise<PersistenceResult<void>> {
  const inspected = await inspect(repositories, id)
  if (!inspected.ok) return inspected
  const { project, ledger, sources, offcuts, issues, projects, inventory, planId } = inspected.value
  if (handling === 'restore' && issues.length) return conflict(issues.join(' '))
  if (projects.some(other => other.id !== id && other.partIds.some(partId => project.partIds.includes(partId)))) return conflict('Part ownership conflicts with another project; no data was deleted.')
  const audit: ProjectStock = ledger ?? { id, entries: [], consumed: [], conflict: null, movements: [] }
  if (handling === 'restore') {
    for (const item of offcuts.values()) { const removed = await repositories.stockItems.delete(item.id); if (!removed.ok) return removed }
    for (const source of sources.values()) {
      if (!source.quantity) continue
      const result = inventory.has(source.stock.id) ? await repositories.stockItems.update(source.stock.id, source.stock) : await repositories.stockItems.create(source.stock)
      if (!result.ok) return result
    }
    const restored = [...sources.values()].filter(item => item.quantity > 0)
    if (offcuts.size || restored.length) {
      if (!planId) return conflict('Restoration requires a recorded cutting result identity.')
      audit.movements.push({ id: stockItemIdSchema.parse(crypto.randomUUID()), planId, createdAt: new Date().toISOString(), added: [], removed: [...offcuts.values()], consumed: [], restored })
    }
    audit.consumed = []
  }
  audit.entries = []
  audit.conflict = null
  audit.deletedProject = { name: project.name, deletedAt: new Date().toISOString(), stockHandling: handling }
  const archived = ledger ? await repositories.projectStock.update(id, audit) : await repositories.projectStock.create(audit)
  if (!archived.ok) return archived
  for (const partId of project.partIds) { const result = await repositories.parts.delete(partId); if (!result.ok) return result }
  const plans = await repositories.savedPlanSummaries.listForProject(id)
  if (!plans.ok) return plans
  for (const plan of plans.value) {
    const contents = await repositories.savedPlanContents.delete(plan.id)
    if (!contents.ok) return contents
    const summary = await repositories.savedPlanSummaries.delete(plan.id)
    if (!summary.ok) return summary
  }
  const current = await repositories.currentCuttingResults.find(id)
  if (!current.ok) return current
  if (current.value) { const result = await repositories.currentCuttingResults.delete(id); if (!result.ok) return result }
  return repositories.projects.delete(id)
}
