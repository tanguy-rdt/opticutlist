import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CuttingConfirmation from '../CuttingConfirmation.vue'
import SavedPlans from '../../optimization/SavedPlans.vue'
import { cuttingConfirmationServiceKey } from '../cutting-confirmation-service'
import type { CuttingPreview, CuttingConfirmationService } from '../../../application/inventory/cutting-confirmation-service'
import type { PersistenceResult } from '../../../application/persistence/repositories'
import type { SavedPlanService } from '../../../application/plans/saved-plan-service'
import { cuttingConfirmationSchema, type CuttingConfirmation as Receipt } from '../../../domain/model/cutting-confirmation'
import { stockItemSchema } from '../../../domain/model/stock-item'
import { savedPlanSummarySchema, panelSnapshotSchema, savedPlanContentsSchema } from '../../../domain/model/saved-cutting-plan'
import { optimizeProject } from '../../../domain/optimizer/optimize-project'
import { partSchema } from '../../../domain/model/part'
import { supplierProductSchema } from '../../../domain/model/supplier-product'
import { compactTree } from '../../../application/plans/saved-plan-codec'
import { validPartInput, validSupplierProductInput, validStockItemInput } from '../../../domain/model/__tests__/fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => { wrapper.unmount() }); wrappers.length = 0; vi.restoreAllMocks() })
const summary = savedPlanSummarySchema.parse({ id: 'plan-ui', projectId: 'project-ui', name: 'Workshop cuts', createdAt: '2026-10-11T12:00:00.000Z' })
function fixture(): CuttingPreview {
  const product = supplierProductSchema.parse({ ...validSupplierProductInput, lengthMm: 200, widthMm: 100, grainDirection: 'none' })
  const part = partSchema.parse({ ...validPartInput, lengthMm: 100, widthMm: 100, grainDirection: 'none', quantity: 2 })
  const settings = { kerfMm: 3, edgeMarginMm: 0 }
  const optimized = optimizeProject({ panels: [{ product, quantity: 2 }], parts: [part], settings })
  if (!optimized.ok) throw new Error('Fixture')
  const snapshot = panelSnapshotSchema.parse({ id: product.id, name: product.name, materialId: product.materialId, lengthMm: product.lengthMm, widthMm: product.widthMm, thicknessMm: product.thicknessMm, grainDirection: product.grainDirection })
  const contents = savedPlanContentsSchema.parse({ id: summary.id, projectId: summary.projectId, formatVersion: 1, parts: [part], settings, sources: [{ product: snapshot, quantity: 2, materialName: 'Birch', supplierName: 'Supplier' }], panels: optimized.plan.panels.map(panel => ({ supplierProductId: product.id, panelCopyIndex: panel.panelCopyIndex, strategy: panel.strategy, edited: false, tree: compactTree(panel.plan.tree) })), unplaced: optimized.plan.unplaced, metrics: optimized.plan.metrics })
  return { saved: { summary, contents, plan: optimized.plan }, stock: [stockItemSchema.parse({ ...validStockItemInput, lengthMm: 200, widthMm: 100, grainDirection: 'none', quantity: 2 })], offcuts: [0, 1].map(panelIndex => ({ panelIndex, wasteIndex: 0, panel: snapshot, materialName: 'Birch', region: { xMm: 103, yMm: 0, lengthMm: 97, widthMm: 100 } })), confirmation: null }
}
function setup(value = fixture()) {
  const stock = value.stock[0]; if (!stock) throw new Error('Fixture')
  const receipt = cuttingConfirmationSchema.parse({ id: summary.id, projectId: summary.projectId, confirmedAt: '2026-10-11T12:00:00.000Z', consumed: [{ stock, quantity: 2, panelIndices: [0, 1] }], offcuts: [] })
  const service = { preview: vi.fn<() => Promise<PersistenceResult<CuttingPreview>>>().mockResolvedValue({ ok: true, value }), confirm: vi.fn<ReturnType<CuttingConfirmationService['forProject']>['confirm']>().mockResolvedValue({ ok: true, value: receipt }), list: vi.fn<() => Promise<PersistenceResult<readonly Receipt[]>>>().mockResolvedValue({ ok: true, value: [] }) }
  const wrapper = mount(CuttingConfirmation, { props: { service, summary } }); wrappers.push(wrapper)
  return { wrapper, service, receipt, stock }
}
async function assign(wrapper: VueWrapper, id: string) { await wrapper.get('#cutting-stock-0').setValue(id); await wrapper.get('#cutting-stock-1').setValue(id) }
function button(wrapper: VueWrapper, name: string) {
  const found = wrapper.findAll('button').find(button => button.text() === name)
  if (!found) throw new Error(`Missing ${name}`)
  return found
}
describe('cutting confirmation review', () => {
  it('shows all panels/candidates with none selected and requires review plus explicit consent with no offcuts', async () => {
    const { wrapper, service, stock } = setup(); await flushPromises()
    expect(wrapper.findAll('select')).toHaveLength(2)
    for (const checkbox of wrapper.findAll<HTMLInputElement>('input[type="checkbox"]')) expect(checkbox.element.checked).toBe(false)
    expect(wrapper.text()).toContain('97 × 100 × 18 mm')
    expect(button(wrapper, 'Review inventory changes').attributes('disabled')).toBeDefined()
    await assign(wrapper, stock.id)
    await button(wrapper, 'Review inventory changes').trigger('click')
    expect(wrapper.text()).toContain('Consume 2'); expect(wrapper.text()).toContain('No offcuts will be added.')
    expect(service.confirm).not.toHaveBeenCalled()
    const consent = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await button(wrapper, 'Confirm Cutting').trigger('click'); expect(service.confirm).not.toHaveBeenCalled()
    consent.mockReturnValue(true)
    await button(wrapper, 'Confirm Cutting').trigger('click'); await flushPromises()
    expect(service.confirm).toHaveBeenCalledExactlyOnceWith(summary.id, { confirmed: true, assignments: [{ panelIndex: 0, stockItemId: stock.id }, { panelIndex: 1, stockItemId: stock.id }], offcuts: [] })
    expect(wrapper.text()).toContain('Cutting confirmed on'); expect(wrapper.findAll('select')).toHaveLength(0)
    expect(wrapper.emitted('confirmed')).toHaveLength(1)
  })
  it('submits only individually selected offcuts and allows returning to selection', async () => {
    const { wrapper, service, stock } = setup(); await flushPromises(); await assign(wrapper, stock.id)
    await wrapper.get('input[value="1:0"]').setValue(true)
    await button(wrapper, 'Review inventory changes').trigger('click'); expect(wrapper.text()).toContain('Keep 1 selected offcuts')
    await button(wrapper, 'Back to selection').trigger('click'); await button(wrapper, 'Review inventory changes').trigger('click')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await button(wrapper, 'Confirm Cutting').trigger('click'); await flushPromises()
    expect(service.confirm).toHaveBeenCalledWith(summary.id, expect.objectContaining({ offcuts: [{ panelIndex: 1, wasteIndex: 0 }] }))
  })
  it('prevents exceeding quantities and excludes incompatible stock options', async () => {
    const value = fixture(); const stock = value.stock[0]; if (!stock) throw new Error('Fixture')
    const { wrapper } = setup({ ...value, stock: [{ ...stock, quantity: 1 }, stockItemSchema.parse({ ...stock, id: 'wrong-thickness', thicknessMm: 19 })] })
    await flushPromises(); await assign(wrapper, stock.id)
    expect(wrapper.find('option[value="wrong-thickness"]').exists()).toBe(false)
    expect(button(wrapper, 'Review inventory changes').attributes('disabled')).toBeDefined()
  })
  it('retains selections and displays transaction errors without reporting success', async () => {
    const { wrapper, service, stock } = setup(); await flushPromises(); await assign(wrapper, stock.id)
    service.confirm.mockResolvedValueOnce({ ok: false, error: { kind: 'referenceConflict', message: 'Insufficient stock quantity. No inventory changes were made.' } })
    await wrapper.get('input[value="0:0"]').setValue(true); await button(wrapper, 'Review inventory changes').trigger('click')
    vi.spyOn(window, 'confirm').mockReturnValue(true); await button(wrapper, 'Confirm Cutting').trigger('click'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Insufficient stock')
    expect(wrapper.get<HTMLInputElement>('input[value="0:0"]').element.checked).toBe(true)
    expect(wrapper.emitted('confirmed')).toBeUndefined()
  })
  it('handles loading, invalid plan errors, retry and cleanup during a pending read', async () => {
    const { wrapper, service } = setup()
    expect(wrapper.get('[role="status"]').text()).toContain('Loading')
    await flushPromises()
    service.preview.mockResolvedValue({ ok: false, error: { kind: 'invalidRecord', issues: [{ path: ['plan'], message: 'Invalid cutting tree' }] } })
    const another = mount(CuttingConfirmation, { props: { service, summary } }); wrappers.push(another); await flushPromises()
    expect(another.get('[role="alert"]').text()).toContain('Invalid cutting tree')
    expect(another.findAll('select')).toHaveLength(0)
    service.preview.mockResolvedValue({ ok: true, value: fixture() })
    await button(another, 'Retry confirmation').trigger('click'); await flushPromises(); expect(another.findAll('select')).toHaveLength(2)
    let resolve: ((value: PersistenceResult<CuttingPreview>) => void) | undefined
    service.preview.mockImplementation(() => new Promise(done => { resolve = done }))
    const pending = mount(CuttingConfirmation, { props: { service, summary } }); wrappers.push(pending)
    pending.unmount(); resolve?.({ ok: true, value: fixture() }); await flushPromises(); expect(pending.emitted('confirmed')).toBeUndefined()
  })
  it('lists confirmation status without reading cutting trees and disables repeated confirmation/deletion', async () => {
    const { service, receipt } = setup(); await flushPromises()
    service.list.mockResolvedValue({ ok: true, value: [receipt] })
    const value = fixture()
    const get = vi.fn().mockResolvedValue({ ok: true, value: value.saved })
    const plans: ReturnType<SavedPlanService['forProject']> = { list: vi.fn().mockResolvedValue({ ok: true, value: [summary] }), get, save: vi.fn().mockResolvedValue({ ok: true, value: value.saved }), rename: vi.fn().mockResolvedValue({ ok: true, value: summary }), delete: vi.fn().mockResolvedValue({ ok: true, value: undefined }) }
    const wrapper = mount(SavedPlans, { props: { plans, disabled: false }, global: { provide: { [cuttingConfirmationServiceKey]: { forProject: () => service } } } }); wrappers.push(wrapper); await flushPromises()
    expect(wrapper.text()).toContain('Cutting confirmed · Inventory movements recorded')
    expect(wrapper.get('[aria-label="Confirm cutting Workshop cuts"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[aria-label="Delete plan Workshop cuts"]').attributes('disabled')).toBeDefined()
    expect(get).not.toHaveBeenCalled(); expect(service.preview).toHaveBeenCalledTimes(1)
  })
})
