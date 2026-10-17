import { isStockEligibleForProject } from './stock-eligibility'
import type { CuttingProjectId, SavedCuttingPlanId } from '../../domain/model/ids'
import { stockItemIdSchema } from '../../domain/model/ids'
import { stockItemSchema, type StockItem } from '../../domain/model/stock-item'
import { projectStockSchema, type ProjectOffcut, type ProjectStock } from '../../domain/model/project-stock'
import { toNonNegativeUm } from '../../domain/geometry/units'
import type { LocalPersistence, PersistenceResult, Repositories } from '../persistence/repositories'
import { readSavedPlan, type OpenedSavedPlan } from '../plans/saved-plan-service'
import { cuttingOffcutCandidates, stockMatchesPanel, type OffcutCandidate } from './cutting-confirmation-service'

export interface ProjectOffcutRow {
  readonly key: string
  readonly candidate: OffcutCandidate
  readonly entry: ProjectOffcut | undefined
  readonly keep: boolean
  readonly status: 'Not added' | 'Available' | 'Consumed' | 'Outdated'
  readonly modified: boolean
}
export interface ProjectStockPreview {
  readonly saved: OpenedSavedPlan | null
  readonly rows: readonly ProjectOffcutRow[]
  readonly conflict: string | null
  readonly movements: ProjectStock['movements']
}

function conflict(message: string): Extract<PersistenceResult<never>, { ok: false }> {
  return { ok: false, error: { kind: 'referenceConflict', message } }
}

function sameStock(a: StockItem, b: StockItem): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function candidateKey(planId: SavedCuttingPlanId, candidate: OffcutCandidate): string {
  return `${planId}:${String(candidate.panelIndex)}:${String(candidate.wasteIndex)}`
}

function fingerprint(candidate: OffcutCandidate, copyIndex: number): string {
  const { panel, region } = candidate
  return JSON.stringify([panel.id, panel.stockItemId ?? null, copyIndex, panel.materialId, panel.thicknessMm, panel.grainDirection,
  ...[panel.lengthMm, panel.widthMm, region.xMm, region.yMm, region.lengthMm, region.widthMm].map(value => toNonNegativeUm(value))])
}

function entryFrom(
  candidate: OffcutCandidate,
  saved: OpenedSavedPlan,
  id: StockItem['id'],
  keep: boolean,
  stock: StockItem | null
): ProjectOffcut {
  const allocation = saved.plan.panels[candidate.panelIndex]
  if (!allocation) {
    throw new Error('The offcut source panel is missing.')
  }
  return {
    id,
    planId: saved.summary.id,
    panelIndex: candidate.panelIndex,
    panelCopyIndex: allocation.panelCopyIndex,
    wasteIndex: candidate.wasteIndex,
    panel: candidate.panel,
    region: candidate.region,
    materialName: candidate.materialName,
    keep,
    removed: false,
    stock
  }
}

function asCandidate(entry: ProjectOffcut): OffcutCandidate {
  return {
    panelIndex: entry.panelIndex,
    wasteIndex: entry.wasteIndex,
    panel: entry.panel,
    region: entry.region,
    materialName: entry.materialName
  }
}

/** Project decisions and append-only movements are separate from the immutable cutting receipts. */
export function createProjectStockService(persistence: LocalPersistence) {
  function forProject(projectId: CuttingProjectId) {
    async function read(repositories: Repositories) {
      const project = await repositories.projects.get(projectId)
      if (!project.ok) {
        return project
      }
      const stored = await repositories.projectStock.find(projectId)
      if (!stored.ok) {
        return stored
      }
      const current = await repositories.currentCuttingResults.find(projectId)
      if (!current.ok) {
        return current
      }
      const state: ProjectStock = structuredClone(stored.value ?? { id: projectId, entries: [], movements: [], consumed: [], conflict: null })
      const stock = await repositories.stockItems.list()
      if (!stock.ok) {
        return stock
      }
      const receipts = await repositories.cuttingConfirmations.list()
      if (!receipts.ok) {
        return receipts
      }
      let saved: OpenedSavedPlan | null = null
      if (current.value) {
        const loaded = await readSavedPlan(repositories, projectId, current.value.planId)
        if (!loaded.ok) {
          return loaded
        }
        saved = loaded.value
      }
      // Bring preexisting finalized offcuts into the view without altering receipts or inventory.
      for (const receipt of receipts.value.filter(receipt => receipt.projectId === projectId)) {
        const missing = receipt.offcuts.filter(offcut => !state.entries.some(entry => entry.stock?.id === offcut.id))
        if (!missing.length) {
          continue
        }
        const historical = await readSavedPlan(repositories, projectId, receipt.id)
        if (!historical.ok) {
          return historical
        }
        const candidates = cuttingOffcutCandidates(historical.value)
        for (const offcut of missing) {
          const provenance = offcut.provenance
          const candidate = provenance.source === 'cutting' ? candidates.find(candidate => candidate.panelIndex === provenance.panelIndex && candidate.wasteIndex === provenance.wasteIndex) : undefined
          if (
            !candidate
            || provenance.source !== 'cutting'
            || provenance.savedPlanId !== receipt.id
            || provenance.projectId !== projectId
            || !stockMatchesPanel(offcut, { ...candidate.panel, lengthMm: candidate.region.lengthMm, widthMm: candidate.region.widthMm })
          ) {
            return conflict('A historical offcut has invalid source provenance or dimensions. No stock was changed.')
          }
          state.entries.push(entryFrom(candidate, historical.value, offcut.id, true, offcut))
        }
      }
      const candidates = saved ? cuttingOffcutCandidates(saved) : []
      const matched = new Map<string, ProjectOffcut>()
      const used = new Set<StockItem['id']>()
      for (const candidate of candidates) {
        if (!saved) {
          continue
        }
        const copy = saved.plan.panels[candidate.panelIndex]?.panelCopyIndex
        if (copy === undefined) {
          return conflict('The physical panel identity is missing.')
        }
        const identity = fingerprint(candidate, copy)
        const matches = state.entries.filter(entry => fingerprint(asCandidate(entry), entry.panelCopyIndex) === identity)
        // Never guess between two historical physical origins with identical dimensions.
        const exact = matches.filter(entry => entry.planId === saved.summary.id && entry.panelIndex === candidate.panelIndex && entry.wasteIndex === candidate.wasteIndex)
        const entry = exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : undefined
        if (entry && !used.has(entry.id)) {
          matched.set(candidateKey(saved.summary.id, candidate), entry);
          used.add(entry.id)
        }
      }
      const currentRows: ProjectOffcutRow[] = saved ? candidates.map(candidate => {
        const key = candidateKey(saved.summary.id, candidate)
        const entry = matched.get(key)
        const physical = entry?.stock ? stock.value.find(item => item.id === entry.stock?.id) : undefined
        const consumed = entry?.stock ? receipts.value.some(receipt => receipt.consumed.some(movement => movement.stock.id === entry.stock?.id)) : false
        return {
          key,
          candidate,
          entry,
          keep: entry?.keep ?? false,
          status: entry?.stock && !entry.removed ? physical ? 'Available' : 'Consumed' : 'Not added',
          modified: !!entry?.stock && (!!physical && !sameStock(physical, entry.stock) || consumed)
        }
      }) : []
      const outdated: ProjectOffcutRow[] = state.entries.filter(entry => !used.has(entry.id) && (entry.keep || entry.stock)).map(entry => {
        const physical = entry.stock ? stock.value.find(item => item.id === entry.stock?.id) : undefined
        const consumed = entry.stock ? receipts.value.some(receipt => receipt.consumed.some(movement => movement.stock.id === entry.stock?.id)) : false
        return {
          key: `outdated:${entry.id}`,
          candidate: asCandidate(entry),
          entry,
          keep: entry.keep,
          status: 'Outdated',
          modified: !!entry.stock && (!!physical && !sameStock(physical, entry.stock) || consumed)
        }
      })
      const rows = [...currentRows, ...outdated]
      const value: ProjectStockPreview = { saved, rows, movements: state.movements, conflict: state.conflict }
      return { ok: true as const, value: { preview: value, state, stored: stored.value } }
    }

    function transaction<T>(work: (repositories: Repositories) => Promise<PersistenceResult<T>>): Promise<PersistenceResult<T>> {
      return persistence.transaction(async repositories => {
        try {
          return await work(repositories)
        } catch (cause) {
          return {
            ok: false,
            error: {
              kind: 'invalidRecord',
              issues: [{ path: ['offcuts'], message: cause instanceof Error ? cause.message : 'The cutting plan is invalid.' }]
            }
          }
        }
      })
    }

    return {
      sync(): Promise<PersistenceResult<void>> {
        return transaction(async repositories => {
          const result = await read(repositories)
          if (!result.ok) {
            return result
          }
          const { preview, state, stored } = result.value
          if (!preview.saved) {
            return { ok: true, value: undefined }
          }
          const synced = await reconcileProjectStock(repositories, preview.saved, state)
          if (!synced.ok) {
            return synced
          }
          const written = stored ? await repositories.projectStock.update(projectId, state) : await repositories.projectStock.create(state)
          return written.ok ? { ok: true, value: undefined } : written
        })
      },
      preview(): Promise<PersistenceResult<ProjectStockPreview>> {
        return transaction(async repositories => {
          const result = await read(repositories);
          return result.ok ? { ok: true, value: result.value.preview } : result
        })
      },
      setKeep(key: string, keep: boolean): Promise<PersistenceResult<void>> {
        return transaction(async repositories => {
          const result = await read(repositories)
          if (!result.ok) {
            return result
          }
          const { preview, state, stored } = result.value
          const row = preview.rows.find(row => row.key === key)
          if (!row) {
            return conflict('The cutting result changed. Refresh the offcuts before selecting.')
          }
          if (row.entry) {
            row.entry.keep = keep
          } else if (keep && preview.saved) {
            state.entries.push(entryFrom(row.candidate, preview.saved, stockItemIdSchema.parse(crypto.randomUUID()), true, null))
          }
          if (!preview.saved) {
            return conflict('A current cutting result is required.')
          }
          const synced = await reconcileProjectStock(repositories, preview.saved, state)
          if (!synced.ok) {
            return synced
          }
          const record = stored ? await repositories.projectStock.update(projectId, state) : await repositories.projectStock.create(state)
          return record.ok ? { ok: true, value: undefined } : record
        })
      },

    }
  }

  return { forProject }
}

export type ProjectStockService = ReturnType<typeof createProjectStockService>

/** All preconditions are checked before writes. Business conflicts preserve physical stock and history. */
export async function reconcileProjectStock(repositories: Repositories, saved: OpenedSavedPlan, supplied?: ProjectStock): Promise<PersistenceResult<ProjectStock>> {
  const projectId = saved.summary.projectId
  const stored = await repositories.projectStock.find(projectId)
  if (!stored.ok) {
    return stored
  }
  const state = supplied ?? structuredClone(stored.value ?? { id: projectId, entries: [], movements: [], consumed: [], conflict: null })
  const inventory = await repositories.stockItems.list()
  if (!inventory.ok) {
    return inventory
  }
  const states = await repositories.projectStock.list()
  if (!states.ok) {
    return states
  }
  const receipts = await repositories.cuttingConfirmations.list()
  if (!receipts.ok) {
    return receipts
  }
  const stock = new Map(inventory.value.map(item => [item.id, item]))
  const candidates = cuttingOffcutCandidates(saved)
  const desired = new Map<StockItem['id'], number>()
  for (const panel of saved.plan.panels) {
    const source = saved.contents.sources.find(source => source.product.id === panel.supplierProductId)?.product
    if (!source) {
      return conflict('A source panel is missing.')
    }
    if (source.stockItemId) {
      desired.set(source.stockItemId, (desired.get(source.stockItemId) ?? 0) + 1)
    }
  }
  const priorReceipt = receipts.value.find(receipt => receipt.id === saved.summary.id)
  if (!state.consumed.length && priorReceipt) {
    state.consumed = priorReceipt.consumed.filter(movement => desired.has(movement.stock.id)).map(movement => ({ stock: movement.stock, quantity: movement.quantity }))
  }
  const fail = (message: string): Promise<PersistenceResult<ProjectStock>> => {
    state.conflict = message
    if (supplied) {
      return Promise.resolve({ ok: true, value: state })
    }
    return stored.value ? repositories.projectStock.update(projectId, state) : repositories.projectStock.create(state)
  }
  const consumed: ProjectStock['consumed'] = []
  const restored: ProjectStock['consumed'] = []
  const nextConsumption: ProjectStock['consumed'] = []
  for (const id of new Set([...desired.keys(), ...state.consumed.map(item => item.stock.id)])) {
    const previous = state.consumed.find(item => item.stock.id === id)
    const count = desired.get(id) ?? 0
    const before = stock.get(id)
    const origin = previous?.stock ?? before
    if (count > 0 && origin && !isStockEligibleForProject(origin, projectId)) {
      return fail('This cutting plan uses an offcut generated by its own project. Remove the circular stock selection in Materials and optimize again; inventory was preserved.')
    }
    if (previous && count === previous.quantity) {
      const panel = saved.contents.sources.find(source => source.product.stockItemId === id)?.product
      if (!panel || !stockMatchesPanel(previous.stock, panel)) {
        return fail('The recorded physical source geometry or material changed. Inventory was preserved.')
      }
      nextConsumption.push(previous);
      continue
    }
    if (previous) {
      if (
        count < previous.quantity
        && receipts.value.some(receipt => receipt.consumed.some(movement => movement.stock.id === id))
      ) {
        return fail('This source has immutable physical-cutting history and cannot safely be restored automatically.')
      }
      const remaining = previous.stock.quantity - previous.quantity
      if (remaining === 0 ? before !== undefined : !before || !sameStock(before, { ...previous.stock, quantity: remaining })) {
        return fail('Source stock was modified elsewhere. Automatic reversal is unsafe; inventory was preserved.')
      }
      if (
        states.value.some(other => other.id !== projectId && other.consumed.some(item => item.stock.id === id))
        || receipts.value.some(receipt => receipt.projectId !== projectId && receipt.consumed.some(item => item.stock.id === id))
      ) {
        return fail('Source stock was consumed by another project. Inventory history was preserved.')
      }
    }
    const original = previous?.stock ?? before
    if (!original || count > original.quantity) {
      return fail('The exact source StockItem is missing or has insufficient available quantity.')
    }
    if (count > 0) {
      const panel = saved.contents.sources.find(source => source.product.stockItemId === id)?.product
      if (!panel || !stockMatchesPanel(original, panel)) {
        return fail('Source stock no longer matches the recorded material, thickness, dimensions or grain.')
      }
      nextConsumption.push({ stock: original, quantity: count })
    }
    const change = count - (previous?.quantity ?? 0)
    if (change > 0) {
      consumed.push({ stock: original, quantity: change })
    }
    if (change < 0) {
      restored.push({ stock: original, quantity: -change })
    }
  }
  const active = new Set<StockItem['id']>()
  for (const candidate of candidates) {
    const copy = saved.plan.panels[candidate.panelIndex]?.panelCopyIndex ?? 0
    const matches = state.entries.filter(entry => fingerprint(asCandidate(entry), entry.panelCopyIndex) === fingerprint(candidate, copy))
    if (matches.length === 1 && matches[0]) {
      active.add(matches[0].id)
    }
  }
  const removed: StockItem[] = []
  const added: StockItem[] = []
  for (const entry of state.entries) {
    if (!entry.stock || entry.removed || entry.keep && active.has(entry.id)) {
      continue
    }
    const physical = stock.get(entry.stock.id)
    const usedElsewhere = states.value.some(other => other.id !== projectId && other.consumed.some(item => item.stock.id === entry.stock?.id))
      || receipts.value.some(receipt => receipt.consumed.some(item => item.stock.id === entry.stock?.id))
    if (!physical || !sameStock(physical, entry.stock) || usedElsewhere || desired.has(entry.stock.id)) {
      return fail('A generated offcut was consumed or modified. It cannot safely be removed or replaced; existing stock and history were preserved.')
    }
    removed.push(physical)
  }
  // Restoring a physical panel is unsafe while one of its retained offcuts survives or was consumed.
  for (const movement of restored) {
    for (const entry of state.entries) {
      if (
        !entry.stock
        || entry.removed
        || entry.stock.provenance.source !== 'cutting'
        || entry.stock.provenance.sourceStockItemId !== movement.stock.id
      ) {
        continue
      }
      if (entry.panelCopyIndex < (desired.get(movement.stock.id) ?? 0)) {
        continue
      }
      if (!removed.some(item => item.id === entry.stock?.id)) {
        return fail('Retained offcuts prevent restoring their source panel. Inventory was preserved.')
      }
    }
  }
  for (const entry of state.entries) {
    if (!entry.keep || !active.has(entry.id) || entry.stock && !entry.removed) {
      continue
    }
    const candidate = candidates.find(item => fingerprint(item, saved.plan.panels[item.panelIndex]?.panelCopyIndex ?? 0) === fingerprint(asCandidate(entry), entry.panelCopyIndex))
    if (!candidate) {
      continue
    }
    const material = await repositories.materials.get(candidate.panel.materialId)
    if (!material.ok) {
      return material
    }
    const provenance = {
      source: 'cutting' as const, projectId, savedPlanId: saved.summary.id, panelIndex: candidate.panelIndex, wasteIndex: candidate.wasteIndex,
      ...(candidate.panel.stockItemId ? { sourceStockItemId: candidate.panel.stockItemId } : { supplierProductId: candidate.panel.id })
    }
    const item = stockItemSchema.parse({
      id: stockItemIdSchema.parse(crypto.randomUUID()),
      kind: 'offcut',
      materialId: candidate.panel.materialId,
      lengthMm: candidate.region.lengthMm,
      widthMm: candidate.region.widthMm,
      thicknessMm: candidate.panel.thicknessMm,
      grainDirection: candidate.panel.grainDirection,
      quantity: 1,
      provenance
    })
    added.push(item)
  }
  // No domain or storage calls after this point may escape the surrounding atomic transaction.
  for (const movement of [...consumed, ...restored]) {
    const desiredCount = desired.get(movement.stock.id) ?? 0
    const quantity = movement.stock.quantity - desiredCount
    const before = stock.get(movement.stock.id)
    let write: PersistenceResult<StockItem> | PersistenceResult<void>
    if (quantity === 0) {
      write = await repositories.stockItems.delete(movement.stock.id)
    } else if (before) {
      write = await repositories.stockItems.update(movement.stock.id, { ...movement.stock, quantity })
    } else {
      write = await repositories.stockItems.create({ ...movement.stock, quantity })
    }
    if (!write.ok) {
      return write
    }
  }
  for (const item of removed) {
    const deleted = await repositories.stockItems.delete(item.id)
    if (!deleted.ok) {
      return deleted
    }
    const entry = state.entries.find(entry => entry.stock?.id === item.id)
    if (entry) {
      entry.removed = true
    }
  }
  for (const item of added) {
    const created = await repositories.stockItems.create(item)
    if (!created.ok) {
      return created
    }
    const provenance = item.provenance
    const candidate = provenance.source === 'cutting' ? candidates.find(candidate => candidate.panelIndex === provenance.panelIndex && candidate.wasteIndex === provenance.wasteIndex) : undefined
    const entry = candidate ? state.entries.find(entry => fingerprint(asCandidate(entry), entry.panelCopyIndex) === fingerprint(candidate, saved.plan.panels[candidate.panelIndex]?.panelCopyIndex ?? 0)) : undefined
    if (entry && candidate) {
      Object.assign(entry, entryFrom(candidate, saved, entry.id, true, item))
    }
  }
  state.consumed = nextConsumption
  state.conflict = null
  if (added.length || removed.length || consumed.length || restored.length) {
    state.movements.push({
      id: stockItemIdSchema.parse(crypto.randomUUID()),
      planId: saved.summary.id,
      createdAt: new Date().toISOString(),
      added,
      removed,
      consumed,
      restored
    })
  }
  const validated = projectStockSchema.parse(state)
  if (supplied) {
    return { ok: true, value: validated }
  }
  return stored.value ? repositories.projectStock.update(projectId, validated) : repositories.projectStock.create(validated)
}
