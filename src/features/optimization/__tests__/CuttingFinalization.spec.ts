import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import CuttingFinalization from '../CuttingFinalization.vue'
import { cuttingPlanPdfServiceKey } from '../pdf-export-service'
import { createCuttingPlanPdfService } from '../../../application/export/cutting-plan-pdf-service'
import { multiPanelPdfRequest } from '../../../application/export/__tests__/pdf-fixtures'
import { createCurrentResultService } from '../../../application/plans/current-result-service'
import { createCuttingConfirmationService } from '../../../application/inventory/cutting-confirmation-service'
import { createLocalPersistence } from '../../../infrastructure/persistence/local-database'
import { generateCuttingPlanPdf, generateProjectCuttingPdf } from '../../../infrastructure/pdf/cutting-plan-pdf'
import { cuttingProjectSchema } from '../../../domain/model/cutting-project'
import { validStockItemInput, validMaterialInput, validSupplierInput, validSupplierProductInput } from '../../../domain/model/__tests__/fixtures'

const wrappers: VueWrapper[] = []
const connections: ReturnType<typeof createLocalPersistence>[] = []
afterEach(() => {
  wrappers.forEach(wrapper => { wrapper.unmount() }); connections.forEach(connection => { connection.close() })
  wrappers.length = 0; connections.length = 0; vi.restoreAllMocks(); vi.unstubAllGlobals()
})
function button(wrapper: VueWrapper, text: string) {
  const found = wrapper.findAll('button').find(control => control.text() === text)
  if (!found) throw new Error(`Missing ${text}`)
  return found
}
async function setup(incomplete = false, ownedStock = true) {
  const persistence = createLocalPersistence('finalization-ui', { indexedDB: new IDBFactory(), IDBKeyRange }); connections.push(persistence)
  const project = cuttingProjectSchema.parse({ id: 'project-finalization', name: 'Workshop', partIds: [], materialIds: [], supplierProductIds: [] })
  await persistence.projects.create(project)
  await persistence.materials.create(validMaterialInput); await persistence.suppliers.create(validSupplierInput); await persistence.supplierProducts.create(validSupplierProductInput)
  const input = multiPanelPdfRequest(incomplete); const source = input.sources[0]; if (!source) throw new Error('Fixture')
  const stock = { ...validStockItemInput, lengthMm: source.product.lengthMm, widthMm: source.product.widthMm, thicknessMm: source.product.thicknessMm, grainDirection: source.product.grainDirection, quantity: 5 }
  if (ownedStock) await persistence.stockItems.create(stock)
  const saved = await createCurrentResultService(persistence).forProject(project.id).replace(input); if (!saved.ok) throw new Error('Fixture')
  const cutting = createCuttingConfirmationService(persistence).forProject(project.id)
  const generateProject = vi.fn(generateProjectCuttingPdf)
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:complete-plan'), revokeObjectURL: vi.fn() })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  const wrapper = mount(CuttingFinalization, { attachTo: document.body, props: { input, summary: saved.value.summary, cutting, inventoryProblem: '' }, global: { provide: { [cuttingPlanPdfServiceKey]: createCuttingPlanPdfService({ generate: generateCuttingPlanPdf, generateProject }) } } }); wrappers.push(wrapper)
  await vi.waitFor(() => { expect(wrapper.find('#cutting-stock-0').exists()).toBe(true) })
  return { wrapper, persistence, input, cutting, stock, saved: saved.value, generateProject }
}
describe('complete cutting finalization', () => {
  it('shows all panels and offcuts, with no defaults, and exports/previews without modifying stock or catalog', async () => {
    const { wrapper, persistence, generateProject, cutting } = await setup()
    const inventory = await persistence.stockItems.list(); const catalog = await persistence.supplierProducts.list()
    expect(wrapper.get('dialog').attributes('aria-labelledby')).toBe('finalization-title')
    expect(wrapper.text()).toContain('2 panels · 4 copies placed · 0 copies unplaced')
    expect(wrapper.text()).toContain('210 × 110 × 18 mm')
    expect(wrapper.text()).not.toContain('Validate Cutting')
    const checkboxes = wrapper.findAll<HTMLInputElement>('input[type="checkbox"]')
    expect(checkboxes.length).toBeGreaterThan(0)
    checkboxes.forEach(checkbox => { expect(checkbox.element.checked).toBe(false) })
    await button(wrapper, 'Preview PDF').trigger('click')
    await vi.waitFor(() => { expect(wrapper.find('object[type="application/pdf"]').exists()).toBe(true) })
    expect(generateProject.mock.calls[0]?.[0].panels).toHaveLength(2)
    await vi.waitFor(() => { expect(button(wrapper, 'Export PDF').attributes('disabled')).toBeUndefined() })
    await button(wrapper, 'Export PDF').trigger('click')
    await vi.waitFor(() => { expect(button(wrapper, 'Export PDF').attributes('disabled')).toBeUndefined() })
    expect(wrapper.text()).not.toContain('PDF download started')
    const generated = generateProject.mock.results[0]
    if (!generated || generated.type !== 'return') throw new Error('PDF generation did not complete')
    const pdf = await PDFDocument.load(await generated.value)
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(5)
    expect(await persistence.stockItems.list()).toEqual(inventory)
    expect(await persistence.supplierProducts.list()).toEqual(catalog)
    expect(await cutting.list()).toEqual({ ok: true, value: [] })
  })
  it.each([false, true])('confirms only reviewed stock and explicitly selected offcuts (keep one: %s)', async keepOne => {
    const { wrapper, persistence, cutting, stock, saved } = await setup()
    const catalog = await persistence.supplierProducts.list()
    await wrapper.get('#cutting-stock-0').setValue(stock.id); await wrapper.get('#cutting-stock-1').setValue(stock.id)
    const checkbox = wrapper.get<HTMLInputElement>('input[type="checkbox"]')
    if (keepOne) await checkbox.setValue(true)
    await button(wrapper, 'Review inventory changes').trigger('click')
    expect(wrapper.text()).toContain(keepOne ? 'Keep 1 selected offcuts' : 'No offcuts will be added')
    expect(await cutting.list()).toEqual({ ok: true, value: [] })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await button(wrapper, 'Confirm Cutting').trigger('click')
    await vi.waitFor(() => { expect(wrapper.text()).toContain('this plan cannot be confirmed again') })
    const receipt = await cutting.list(); if (!receipt.ok || !receipt.value[0]) throw new Error('Receipt')
    expect(receipt.value).toHaveLength(1)
    expect(receipt.value[0].consumed[0]?.quantity).toBe(2)
    expect(receipt.value[0].offcuts).toHaveLength(keepOne ? 1 : 0)
    if (keepOne) expect(receipt.value[0].offcuts[0]?.provenance).toMatchObject({ source: 'cutting', projectId: saved.summary.projectId, savedPlanId: saved.summary.id, sourceStockItemId: stock.id })
    const inventory = await persistence.stockItems.list()
    await cutting.confirm(saved.summary.id, { confirmed: true, assignments: [{ panelIndex: 0, stockItemId: stock.id }, { panelIndex: 1, stockItemId: stock.id }], offcuts: [] })
    expect(await persistence.stockItems.list()).toEqual(inventory)
    expect(await persistence.supplierProducts.list()).toEqual(catalog)
    expect(button(wrapper, 'Export PDF').attributes('disabled')).toBeUndefined()
  })
  it('explains missing owned stock and incomplete results while keeping complete PDF export available', async () => {
    const { wrapper, persistence } = await setup(true, false)
    expect(wrapper.text()).toContain('Incomplete optimization')
    expect(wrapper.text()).toContain('Oversized part · 1 copies')
    expect(wrapper.text()).toContain('No matching owned stock')
    expect(button(wrapper, 'Review inventory changes').attributes('disabled')).toBeDefined()
    await button(wrapper, 'Export PDF').trigger('click')
    await vi.waitFor(() => { expect(button(wrapper, 'Export PDF').attributes('disabled')).toBeUndefined() })
    expect(wrapper.text()).not.toContain('PDF download started')
    expect(await persistence.stockItems.list()).toEqual({ ok: true, value: [] })
  })
  it('refuses invalid layouts and supports keyboard closing with focus restoration', async () => {
    const opener = document.createElement('button'); document.body.append(opener); opener.focus()
    const { wrapper, input, cutting } = await setup()
    const preview = vi.spyOn(cutting, 'preview'); preview.mockClear()
    await wrapper.setProps({ input: { ...input, plan: { ...input.plan, metrics: { ...input.plan.metrics, placedCount: 900 } } } })
    await flushPromises()
    expect(wrapper.text()).toContain('invalid and cannot be finalized')
    expect(wrapper.find('#cutting-stock-0').exists()).toBe(false)
    expect(wrapper.findAll('button').map(control => control.text())).toEqual(['Close finalization'])
    expect(preview).not.toHaveBeenCalled()
    await wrapper.get('dialog').trigger('cancel')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})
