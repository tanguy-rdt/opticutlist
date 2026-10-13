import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { createLocalPersistence } from '../../../infrastructure/persistence/local-database'
import { createProjectStockService } from '../../../application/inventory/project-stock-service'
import { createCurrentResultService } from '../../../application/plans/current-result-service'
import { cuttingProjectSchema } from '../../../domain/model/cutting-project'
import { panelSnapshotSchema } from '../../../domain/model/saved-cutting-plan'
import { stockItemSchema } from '../../../domain/model/stock-item'
import StockPanelPreview from '../StockPanelPreview.vue'
import { projectPdfRequest, multiPanelPdfRequest } from '../../../application/export/__tests__/pdf-fixtures'
import { validMaterialInput, validStockItemInput } from '../../../domain/model/__tests__/fixtures'
import { projectIdKey } from '../project-service'
import { projectStockServiceKey } from '../project-stock-service'
import ProjectStockView from '../ProjectStockView.vue'

vi.mock('../../optimization/viewer/plan-canvas', () => ({ createPlanCanvas: () => ({ setKeptWaste: vi.fn(), setViewport: vi.fn(), setSelection: vi.fn(), setPalette: vi.fn(), resize: vi.fn(), destroy: vi.fn() }) }))
const connections: { close(): void }[] = []
const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => { wrapper.unmount() }); wrappers.length = 0; connections.forEach(connection => { connection.close() }); connections.length = 0; vi.restoreAllMocks() })
const project = cuttingProjectSchema.parse({ id: 'stock-ui-project', name: 'Workshop', partIds: [], materialIds: [], supplierProductIds: [] })
async function setup(plan = true, multiple = false) {
  const persistence = createLocalPersistence('project-stock-ui', { indexedDB: new IDBFactory(), IDBKeyRange }); connections.push(persistence)
  await persistence.projects.create(project); await persistence.materials.create(validMaterialInput)
  const request = multiple ? multiPanelPdfRequest() : projectPdfRequest()
  const rawSource = request.sources[0]?.product
  if (!rawSource) throw new Error('Missing source')
  const { id, name, materialId, lengthMm, widthMm, thicknessMm, grainDirection } = rawSource
  const source = panelSnapshotSchema.parse({ id, name, materialId, lengthMm, widthMm, thicknessMm, grainDirection })
  const stock = stockItemSchema.parse({ ...validStockItemInput, id: 'physical-ui-source', materialId: source.materialId, lengthMm: source.lengthMm, widthMm: source.widthMm, thicknessMm: source.thicknessMm, grainDirection: source.grainDirection, quantity: 1 })
  await persistence.stockItems.create(stock)
  if (plan) { const result = await createCurrentResultService(persistence).forProject(project.id).replace({ ...request, sources: [{ product: source, quantity: request.sources[0]?.quantity ?? 1, materialName: 'Birch', supplierName: 'Supplier' }] }); if (!result.ok) throw new Error(JSON.stringify(result.error)) }
  const service = createProjectStockService(persistence)
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: ProjectStockView }, { path: '/other', component: { template: '<p>Other</p>' } }] })
  await router.push('/'); await router.isReady()
  function mountView() { const wrapper = mount({ template: '<router-view />' }, { attachTo: document.body, global: { plugins: [router], provide: { [projectIdKey]: project.id, [projectStockServiceKey]: service } } }); wrappers.push(wrapper); return wrapper }
  return { persistence, service, stock, mountView, router }
}
describe('automatic project Stock workspace', () => {
  it('lists offcuts and synchronizes physical stock on checkbox changes without update controls', async () => {
    const { persistence, stock, mountView } = await setup()
    const wrapper = mountView()
    await vi.waitFor(() => { expect(wrapper.findAll('input[type=checkbox]')).toHaveLength(2) })
    expect(wrapper.text()).not.toContain('Update stock')
    expect(wrapper.find('dialog').exists()).toBe(false)
    expect(wrapper.find('select').exists()).toBe(false)
    await wrapper.findAll('input[type=checkbox]')[0]?.setValue(true)
    await vi.waitFor(() => { expect(wrapper.text()).toContain('Available') })
    const records = await persistence.stockItems.list()
    expect(records.ok && records.value).toHaveLength(2)
    expect(await persistence.stockItems.get(stock.id)).toEqual({ ok: true, value: stock })
    expect(wrapper.findComponent(StockPanelPreview).props('kept')).toEqual([0])
    await wrapper.findAll('input[type=checkbox]')[0]?.setValue(false)
    await vi.waitFor(() => { expect(wrapper.findComponent(StockPanelPreview).props('kept')).toEqual([]) })
    expect(await persistence.stockItems.list()).toEqual({ ok: true, value: [stock] })
  })
  it('restores checkboxes and preview highlighting on project reload', async () => {
    const { mountView } = await setup()
    const wrapper = mountView(); await vi.waitFor(() => { expect(wrapper.findAll('input[type=checkbox]')).toHaveLength(2) })
    await wrapper.findAll('input[type=checkbox]')[0]?.setValue(true)
    await vi.waitFor(() => { expect(wrapper.text()).toContain('Available') })
    wrapper.unmount()
    const reopened = mountView(); await vi.waitFor(() => { expect(reopened.findAll('input[type=checkbox]')).toHaveLength(2) })
    expect((reopened.findAll('input[type=checkbox]')[0]?.element as HTMLInputElement).checked).toBe(true)
    expect(reopened.findComponent(StockPanelPreview).props('kept')).toEqual([0])
  })
  it('switches current panel layouts while retaining independent kept-offcut highlights', async () => {
    const { service, mountView } = await setup(true, true)
    const wrapper = mountView(); await vi.waitFor(() => { expect(wrapper.findAll('input[type=checkbox]').length).toBeGreaterThan(1) })
    await wrapper.findAll('input[type=checkbox]')[0]?.setValue(true)
    await vi.waitFor(() => { expect(wrapper.findComponent(StockPanelPreview).props('kept')).toEqual([0]) })
    const panelTwo = wrapper.findAll('button').find(button => button.text().startsWith('Panel 2'))
    if (!panelTwo) throw new Error('Missing second panel')
    await panelTwo.trigger('click')
    expect(wrapper.findComponent(StockPanelPreview).props('kept')).toEqual([])
    const preview = await service.forProject(project.id).preview()
    if (!preview.ok || !preview.value.saved) throw new Error('Missing saved preview')
    expect(wrapper.findComponent(StockPanelPreview).props('plan')).toEqual(preview.value.saved.plan.panels[1]?.plan)
    await wrapper.findAll('button').find(button => button.text().startsWith('Panel 1'))?.trigger('click')
    expect(wrapper.findComponent(StockPanelPreview).props('kept')).toEqual([0])
  })
  it('shows an empty state when there is no current plan', async () => {
    const { mountView } = await setup(false)
    const wrapper = mountView(); await vi.waitFor(() => { expect(wrapper.text()).toContain('No cutting plan yet') })
    expect(wrapper.find('input').exists()).toBe(false)
  })
})
