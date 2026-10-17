import { describe, expect, it, vi } from 'vitest'
import { createCuttingPlanPdfService, type ProjectCuttingPdfDocument, type ProjectCuttingPdfRequest } from '../cutting-plan-pdf-service'
import { multiPanelPdfRequest } from './pdf-fixtures'
import type { PersistenceResult } from '../../persistence/repositories'
import type { SupplierProduct } from '../../../domain/model/supplier-product'
import type { StockItem } from '../../../domain/model/stock-item'
import { supplierProductSchema } from '../../../domain/model/supplier-product'
import { stockItemSchema } from '../../../domain/model/stock-item'
import { panelSnapshotSchema } from '../../../domain/model/saved-cutting-plan'
import { validStockItemInput, validSupplierProductInput } from '../../../domain/model/__tests__/fixtures'

function fixture() {
  const request = multiPanelPdfRequest()
  const source = request.sources[0]
  if (!source) throw new Error('Missing source')
  const product = supplierProductSchema.parse({ ...validSupplierProductInput, ...source.product, price: 19.95 })
  const products = vi.fn<(id: SupplierProduct['id']) => Promise<PersistenceResult<SupplierProduct>>>().mockResolvedValue({ ok: true, value: product })
  const stock = vi.fn<(id: StockItem['id']) => Promise<PersistenceResult<StockItem>>>().mockImplementation(id => Promise.resolve({ ok: false, error: { kind: 'notFound', id } }))
  const generate = vi.fn<(document: ProjectCuttingPdfDocument) => Promise<Uint8Array<ArrayBuffer>>>().mockResolvedValue(new Uint8Array([1]))
  const service = createCuttingPlanPdfService({ generate: vi.fn(), generateProject: generate }, { supplierProducts: { get: products }, stockItems: { get: stock } })
  const { materialId, lengthMm, widthMm, thicknessMm, grainDirection } = source.product
  const owned = stockItemSchema.parse({ ...validStockItemInput, id: 'owned-panel', materialId, lengthMm, widthMm, thicknessMm, grainDirection, kind: 'fullPanel', quantity: 2, provenance: { source: 'purchase', supplierProductId: product.id } })
  // Do not place the allocation-key ID in a physical stock record.
  const stockRequest = (item: StockItem): ProjectCuttingPdfRequest => {
    const panel = panelSnapshotSchema.parse({ ...source.product, id: `stock:${item.id}`, stockItemId: item.id })
    return { ...request, sources: [{ ...source, product: panel }], plan: { ...request.plan, panels: request.plan.panels.map(allocation => ({ ...allocation, supplierProductId: panel.id })) } }
  }
  return { source, request, product, products, stock, generate, service, owned, stockRequest }
}
describe('Export-time panel price resolution', () => {
  it('resolves catalog prices once by stable ID after reopening a price-free historical result', async () => {
    const f = fixture()
    const before = structuredClone(f.request)
    expect(await f.service.exportProject(f.request)).toMatchObject({ ok: true })
    expect(f.generate.mock.calls[0]?.[0].panels.map(panel => panel.pricing)).toEqual([{ price: 19.95, currency: 'EUR' }, { price: 19.95, currency: 'EUR' }])
    expect(f.products).toHaveBeenCalledExactlyOnceWith(f.product.id)
    expect(f.stock).not.toHaveBeenCalled()
    expect(f.request).toEqual(before)
  })
  it('resolves purchased StockItems through exact product provenance, even after their quantity is consumed', async () => {
    const f = fixture()
    f.stock.mockResolvedValue({ ok: true, value: { ...f.owned, quantity: 0 } })
    expect(await f.service.exportProject(f.stockRequest(f.owned))).toMatchObject({ ok: true })
    expect(f.stock).toHaveBeenCalledExactlyOnceWith(f.owned.id)
    expect(f.products).toHaveBeenCalledExactlyOnceWith(f.product.id)
    expect(f.generate.mock.calls[0]?.[0].panels.every(panel => panel.pricing?.price === 19.95)).toBe(true)
  })
  it.each(['manual', 'missing-stock', 'missing-product', 'missing-price'] as const)('keeps %s prices unknown without matching names or dimensions', async kind => {
    const f = fixture()
    const owned = kind === 'manual' ? stockItemSchema.parse({ ...f.owned, provenance: { source: 'manual' } }) : f.owned
    if (kind !== 'missing-stock') f.stock.mockResolvedValue({ ok: true, value: owned })
    if (kind === 'missing-product') f.products.mockResolvedValue({ ok: false, error: { kind: 'notFound', id: f.product.id } })
    if (kind === 'missing-price') { const withoutPrice = { ...f.product }; delete withoutPrice.price; f.products.mockResolvedValue({ ok: true, value: withoutPrice }) }
    expect(await f.service.exportProject(f.stockRequest(owned))).toMatchObject({ ok: true })
    expect(f.generate.mock.calls[0]?.[0].panels.every(panel => panel.pricing === undefined)).toBe(true)
    if (kind === 'manual' || kind === 'missing-stock') expect(f.products).not.toHaveBeenCalled()
  })
  it('follows recorded offcut source IDs and stops safely at cyclic provenance', async () => {
    const f = fixture()
    const child = stockItemSchema.parse({ ...f.owned, id: 'child-offcut', kind: 'offcut', provenance: { source: 'cutting', projectId: 'other-project', savedPlanId: 'other-plan', sourceStockItemId: f.owned.id, panelIndex: 0, wasteIndex: 0 } })
    f.stock.mockImplementation(id => Promise.resolve({ ok: true, value: id === child.id ? child : f.owned }))
    expect(await f.service.exportProject(f.stockRequest(child))).toMatchObject({ ok: true })
    expect(f.generate.mock.calls[0]?.[0].panels[0]?.pricing).toEqual({ price: 19.95, currency: 'EUR' })
    const cycle = stockItemSchema.parse({ ...child, provenance: { ...child.provenance, source: 'cutting', projectId: 'other-project', savedPlanId: 'other-plan', sourceStockItemId: child.id, panelIndex: 0, wasteIndex: 0 } })
    f.stock.mockResolvedValue({ ok: true, value: cycle }); f.generate.mockClear(); f.products.mockClear()
    expect(await f.service.exportProject(f.stockRequest(cycle))).toMatchObject({ ok: true })
    expect(f.generate.mock.calls[0]?.[0].panels[0]?.pricing).toBeUndefined()
    expect(f.products).not.toHaveBeenCalled()
  })
  it('keeps explicit zero prices and currencies, but reports failed repository reads rather than hiding them as N/A', async () => {
    const f = fixture()
    f.products.mockResolvedValueOnce({ ok: true, value: { ...f.product, price: 0, currency: 'USD' } })
    expect(await f.service.exportProject(f.request)).toMatchObject({ ok: true })
    expect(f.generate.mock.calls[0]?.[0].panels[0]?.pricing).toEqual({ price: 0, currency: 'USD' })
    f.generate.mockClear()
    f.products.mockResolvedValue({ ok: false, error: { kind: 'storageFailure', message: 'DB unavailable' } })
    expect(await f.service.exportProject(f.request)).toMatchObject({ ok: false, error: { kind: 'generationFailure' } })
    expect(f.generate).not.toHaveBeenCalled()
  })
})


it('prices mixed catalog and owned sources once per actual allocated panel, using one shared product lookup', async () => {
  const f = fixture()
  f.stock.mockResolvedValue({ ok: true, value: f.owned })
  const stockSource = f.stockRequest(f.owned).sources[0]
  const first = f.request.plan.panels[0]
  const second = f.request.plan.panels[1]
  if (!stockSource || !first || !second) throw new Error('Missing mixed source fixture')
  const request = { ...f.request, sources: [{ ...f.source, quantity: 1 }, { ...stockSource, quantity: 1 }], plan: { ...f.request.plan, panels: [first, { ...second, supplierProductId: stockSource.product.id, panelCopyIndex: 0 }] } }
  const before = structuredClone(request)
  expect(await f.service.exportProject(request)).toMatchObject({ ok: true })
  const panels = f.generate.mock.calls[0]?.[0].panels
  expect(panels).toHaveLength(2)
  expect(panels?.map(panel => ({ source: panel.panel.id, price: panel.pricing?.price }))).toEqual([{ source: f.source.product.id, price: 19.95 }, { source: stockSource.product.id, price: 19.95 }])
  expect(f.products).toHaveBeenCalledExactlyOnceWith(f.product.id)
  expect(request).toEqual(before)
})

it('uses a direct catalog link on a generated offcut without matching dimensions or remapping its source', async () => {
  const f = fixture()
  const offcut = stockItemSchema.parse({ ...f.owned, kind: 'offcut', provenance: { source: 'cutting', projectId: 'other-project', savedPlanId: 'other-plan', supplierProductId: f.product.id, panelIndex: 0, wasteIndex: 0 } })
  f.stock.mockResolvedValue({ ok: true, value: offcut })
  expect(await f.service.exportProject(f.stockRequest(offcut))).toMatchObject({ ok: true })
  expect(f.generate.mock.calls[0]?.[0].panels[0]?.pricing).toEqual({ price: 19.95, currency: 'EUR' })
  expect(f.products).toHaveBeenCalledExactlyOnceWith(f.product.id)
})
