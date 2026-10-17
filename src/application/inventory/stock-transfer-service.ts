import type { LocalPersistence, PersistenceResult, Repositories } from '../persistence/repositories'
import type { ProjectJsonPort } from '../projects/project-transfer-format'
import type { StockItem } from '../../domain/model/stock-item'
import { invalidStockTransfer, validateStockTransfer, type StockTransfer } from './stock-transfer-format'

export interface StockImportPreview { file: StockTransfer; added: number; reused: number }

function conflict(message: string): Extract<PersistenceResult<never>, { ok: false }> {
  return { ok: false, error: { kind: 'referenceConflict', message } }
}

// Parsed schemas establish property order before structural comparison.
function identical(a: StockItem, b: StockItem): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

async function inspect(repositories: Repositories, file: StockTransfer): Promise<PersistenceResult<StockImportPreview>> {
  const materials = await repositories.materials.list();
  if (!materials.ok) {
    return materials
  }
  for (const material of file.materials) {
    const existing = materials.value.find(record => record.id === material.id)
    if (!existing) {
      return conflict(`Missing material "${material.name}" (${material.id}). Import its matching catalog first; stock import does not create materials.`)
    }
    if (JSON.stringify(existing) !== JSON.stringify(material)) {
      return conflict(`Material identity ${material.id} differs from this installation. Resolve the catalog conflict before importing stock.`)
    }
  }
  const stock = await repositories.stockItems.list();
  if (!stock.ok) {
    return stock
  }
  const projects = await repositories.projects.list();
  if (!projects.ok) {
    return projects
  }
  const ledgers = await repositories.projectStock.list();
  if (!ledgers.ok) {
    return ledgers
  }
  const receipts = await repositories.cuttingConfirmations.list();
  if (!receipts.ok) {
    return receipts
  }
  const products = await repositories.supplierProducts.list();
  if (!products.ok) {
    return products
  }
  const suppliers = await repositories.suppliers.list();
  if (!suppliers.ok) {
    return suppliers
  }
  const summaries = await repositories.savedPlanSummaries.list();
  if (!summaries.ok) {
    return summaries
  }
  const historicalIds = new Set<string>()
  for (const state of ledgers.value) {
    for (const entry of state.entries) {
      historicalIds.add(entry.id);
      if (entry.stock) {
        historicalIds.add(entry.stock.id)
      }
    }
    for (const movement of state.consumed) {
      historicalIds.add(movement.stock.id)
    }
    for (const movement of state.movements) {
      for (const item of [...movement.added, ...movement.removed, ...movement.consumed.map(value => value.stock), ...movement.restored.map(value => value.stock)]) {
        historicalIds.add(item.id)
      }
    }
  }
  for (const receipt of receipts.value) {
    for (const item of [...receipt.offcuts, ...receipt.consumed.map(value => value.stock)]) {
      historicalIds.add(item.id)
    }
  }
  for (const project of projects.value) {
    for (const id of project.stockItemIds ?? []) {
      historicalIds.add(id)
    }
  }
  // Missing identities in historical plans are dependencies, not unowned new stock.
  if (file.stockItems.some(item => !stock.value.some(existing => existing.id === item.id))) {
    const contents = await repositories.savedPlanContents.list();
    if (!contents.ok) {
      return contents
    }
    for (const plan of contents.value) {
      for (const source of plan.sources) {
        if (source.product.stockItemId) {
          historicalIds.add(source.product.stockItemId)
        }
      }
    }
  }
  if (file.stockOrders?.length) {
    const orders = await repositories.stockOrders.list();
    if (!orders.ok) {
      return orders
    }
    for (const imported of file.stockOrders) {
      const existing = orders.value.find(order => order.id === imported.id)
      const liveIds = existing?.stockItemIds.filter(id => stock.value.some(item => item.id === id && item.materialId === imported.id)) ?? []
      if (existing && JSON.stringify(liveIds) !== JSON.stringify(imported.stockItemIds)) {
        return conflict('Manual row order conflicts with this installation. Existing stock order will not be overwritten.')
      }
    }
  }
  let reused = 0
  for (const item of file.stockItems) {
    const existing = stock.value.find(record => record.id === item.id)
    if (existing && !identical(existing, item)) {
      return conflict(`Stock ${item.id} already exists with different data or quantity. Existing stock will not be overwritten or merged.`)
    }
    if (!existing && historicalIds.has(item.id)) {
      return conflict(`Stock ${item.id} is referenced by project inventory or cutting history. A stock-only file cannot restore this identity safely.`)
    }
    const provenance = item.provenance
    if (provenance.source === 'purchase') {
      const product = products.value.find(record => record.id === provenance.supplierProductId)
      if (
        !product
        || product.materialId !== item.materialId
        || !suppliers.value.some(supplier => supplier.id === product.supplierId)
      ) {
        return conflict(`Stock ${item.id} requires matching catalog product ${provenance.supplierProductId}. Import its catalog dependencies first.`)
      }
    }
    if (provenance.source === 'cutting') {
      if (!existing) {
        return conflict(`Offcut ${item.id} belongs to project ${provenance.projectId}. Missing project-generated stock cannot be recreated from a stock-only file; its original inventory history is required.`)
      }
      const ledger = ledgers.value.find(state => state.id === provenance.projectId)
      const originExists = projects.value.some(project => project.id === provenance.projectId) || ledger?.deletedProject !== undefined
      const planExists = summaries.value.some(plan => plan.id === provenance.savedPlanId && plan.projectId === provenance.projectId)
        || ledger?.movements.some(movement => movement.planId === provenance.savedPlanId && movement.added.some(snapshot => identical(snapshot, item)))
      const recorded = ledger?.movements.some(movement => movement.planId === provenance.savedPlanId && movement.added.some(snapshot => identical(snapshot, item)))
        || receipts.value.some(receipt => receipt.projectId === provenance.projectId && receipt.id === provenance.savedPlanId && receipt.offcuts.some(snapshot => identical(snapshot, item)))
      if (!originExists || !planExists || !recorded) {
        return conflict(`Offcut ${item.id} has missing or inconsistent project, cutting-plan or inventory history. Restore those dependencies separately; no stock was changed.`)
      }
    }
    if (existing) {
      reused++
    }
  }
  return { ok: true, value: { file, added: file.stockItems.length - reused, reused } }
}

export function createStockTransferService(persistence: LocalPersistence, json: ProjectJsonPort) {
  return {
    export(): Promise<PersistenceResult<string>> {
      return persistence.transaction(async repositories => {
        const stock = await repositories.stockItems.list();
        if (!stock.ok) {
          return stock
        }
        const materials = await repositories.materials.list();
        if (!materials.ok) {
          return materials
        }
        const order = await repositories.stockOrders.list();
        if (!order.ok) {
          return order
        }
        const stockOrders = order.value.map(row => ({ ...row, stockItemIds: row.stockItemIds.filter(id => stock.value.some(item => item.id === id && item.materialId === row.id)) })).filter(row => row.stockItemIds.length)
        const file = validateStockTransfer({
          ...(stockOrders.length ? { stockOrders } : {}),
          format: 'opticutlist-stock',
          schemaVersion: 1,
          stockItems: stock.value,
          materials: materials.value.filter(material => stock.value.some(item => item.materialId === material.id))
        })
        return file.ok ? { ok: true, value: json.stringify(file.value) } : file
      })
    },
    preview(text: string): Promise<PersistenceResult<StockImportPreview>> {
      try {
        const file = validateStockTransfer(json.parse(text))
        return file.ok ? persistence.transaction(repositories => inspect(repositories, file.value)) : Promise.resolve(file)
      } catch (cause) {
        return Promise.resolve(invalidStockTransfer(cause instanceof Error ? cause.message : 'Could not read the stock file.'))
      }
    },
    import(input: unknown, confirmed: boolean): Promise<PersistenceResult<StockTransfer>> {
      if (!confirmed) {
        return Promise.resolve(invalidStockTransfer('Explicit confirmation is required before importing stock.'))
      }
      const file = validateStockTransfer(input);
      if (!file.ok) {
        return Promise.resolve(file)
      }
      return persistence.transaction(async repositories => {
        const checked = await inspect(repositories, file.value);
        if (!checked.ok) {
          return checked
        }
        const existing = await repositories.stockItems.list();
        if (!existing.ok) {
          return existing
        }
        for (const item of file.value.stockItems) {
          if (!existing.value.some(record => record.id === item.id)) {
            const created = await repositories.stockItems.create(item);
            if (!created.ok) {
              return created
            }
          }
        }
        if (file.value.stockOrders?.length) {
          const orders = await repositories.stockOrders.list();
          if (!orders.ok) {
            return orders
          }
          for (const row of file.value.stockOrders) {
            if (!orders.value.some(existing => existing.id === row.id)) {
              const created = await repositories.stockOrders.create(row);
              if (!created.ok) {
                return created
              }
            }
          }
        }
        return file
      })
    },
  }
}

export type StockTransferService = ReturnType<typeof createStockTransferService>
