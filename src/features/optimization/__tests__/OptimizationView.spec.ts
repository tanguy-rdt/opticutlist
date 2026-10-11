import { createCurrentResultService } from '../../../application/plans/current-result-service'
import { currentResultServiceKey } from '../../../features/optimization/current-result-service'
import { panelSnapshotSchema } from '../../../domain/model/saved-cutting-plan'
import { createSavedPlanService } from '../../../application/plans/saved-plan-service'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { createMemoryHistory } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppRouter } from '../../../app/router'
import { createCatalogRepositories } from '../../../application/catalog/catalog-repositories'
import { createOptimizationService, type OptimizationWorkerPort } from '../../../application/optimization/optimization-service'
import type { OptimizationRequest } from '../../../application/optimization/optimization-protocol'
import { createProjectService } from '../../../application/projects/project-service'
import { cuttingProjectSchema } from '../../../domain/model/cutting-project'
import { partSchema } from '../../../domain/model/part'
import { supplierProductSchema } from '../../../domain/model/supplier-product'
import { validMaterialInput, validPartInput, validStockItemInput, validSupplierInput, validSupplierProductInput } from '../../../domain/model/__tests__/fixtures'
import { optimizeProject } from '../../../domain/optimizer/optimize-project'
import { handleOptimizationRequest } from '../../../workers/optimization/handle-optimization-request'
import { createLocalPersistence } from '../../../infrastructure/persistence/local-database'
import { materialRepositoryKey } from '../../materials/material-repository'
import { projectIdKey, projectServiceKey } from '../../projects/project-service'
import { supplierProductRepositoryKey, supplierRepositoryKey } from '../../suppliers/catalog-repositories'
import OptimizationView from '../OptimizationView.vue'
import { stockRepositoryKey } from '../../inventory/stock-repository'
import { createStockRepository } from '../../../application/inventory/stock-repository'
import { stockPanel } from '../../../domain/optimizer/panel-source'
import { stockItemSchema } from '../../../domain/model/stock-item'
import { optimizationServiceFactoryKey } from '../optimization-service'
import { createCuttingPlanPdfService, type ProjectCuttingPdfDocument } from '../../../application/export/cutting-plan-pdf-service'
import { cuttingPlanPdfServiceKey } from '../pdf-export-service'
import type * as PdfExportModule from '../pdf-export-service'
import { downloadCuttingPlanPdf } from '../pdf-export-service'

vi.mock('../viewer/plan-canvas', () => ({ createPlanCanvas: () => ({ setViewport: vi.fn(), setSelection: vi.fn(), setPalette: vi.fn(), resize: vi.fn(), destroy: vi.fn() }) }))
vi.mock('../pdf-export-service', async importOriginal => ({ ...await importOriginal<typeof PdfExportModule>(), downloadCuttingPlanPdf: vi.fn() }))

class FakeWorker implements OptimizationWorkerPort {
  onmessage: OptimizationWorkerPort['onmessage'] = null
  onerror: OptimizationWorkerPort['onerror'] = null
  onmessageerror: OptimizationWorkerPort['onmessageerror'] = null
  requests: OptimizationRequest[] = []
  terminate = vi.fn()
  postMessage(message: OptimizationRequest): void { this.requests.push(message) }
  get request(): OptimizationRequest {
    const request = this.requests.at(-1)
    if (request === undefined) throw new Error('No request')
    return request
  }
  complete(): void { this.onmessage?.(new MessageEvent('message', { data: handleOptimizationRequest(this.request) })) }
}
const wrappers: VueWrapper[] = []
const connections: ReturnType<typeof createLocalPersistence>[] = []
afterEach(() => {
  vi.restoreAllMocks()
  wrappers.forEach(wrapper => { wrapper.unmount() })
  connections.forEach(connection => { connection.close() })
  wrappers.length = 0; connections.length = 0
})
async function setup() {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const indexedDB = new IDBFactory()
  const persistence = createLocalPersistence('optimization-ui', { indexedDB, IDBKeyRange })
  connections.push(persistence)
  const catalog = createCatalogRepositories(persistence)
  const service = createProjectService(persistence)
  const plans = createSavedPlanService(persistence).forProject(cuttingProjectSchema.shape.id.parse('project-one'))
  const current = createCurrentResultService(persistence).forProject(cuttingProjectSchema.shape.id.parse('project-one'))
  const product = supplierProductSchema.parse(validSupplierProductInput)
  const part = partSchema.parse(validPartInput)
  const project = cuttingProjectSchema.parse({ id: 'project-one', name: 'Cabinet', partIds: [], materialIds: [part.materialId], supplierProductIds: [product.id] })
  await catalog.materials.create(validMaterialInput)
  await catalog.suppliers.create(validSupplierInput)
  await catalog.supplierProducts.create(product)
  await service.projects.create(project)
  await service.parts(project.id).create(part)
  await persistence.stockItems.create(validStockItemInput)
  const other = cuttingProjectSchema.parse({ ...project, id: 'project-two', name: 'Another', supplierProductIds: [] })
  await service.projects.create(other)
  await service.parts(other.id).create({ ...part, id: 'other-part', name: 'Other project part' })
  await catalog.supplierProducts.create({ ...product, id: 'unselected-panel', name: 'Unselected panel' })
  const workers: FakeWorker[] = []
  const factory = () => createOptimizationService(() => { const worker = new FakeWorker(); workers.push(worker); return worker })
  const pdfGenerate = vi.fn<(document: ProjectCuttingPdfDocument) => Promise<Uint8Array<ArrayBuffer>>>().mockResolvedValue(new Uint8Array([1]))
  const router = createAppRouter(createMemoryHistory())
  await router.push('/')
  await router.isReady()
  const wrapper = mount(OptimizationView, {
    attachTo: document.body,
    global: { plugins: [router], provide: {
      [currentResultServiceKey]: { forProject: () => current }, [projectIdKey]: project.id, [projectServiceKey]: service,
      [stockRepositoryKey]: createStockRepository(persistence), [materialRepositoryKey]: catalog.materials, [supplierRepositoryKey]: catalog.suppliers,
      [supplierProductRepositoryKey]: catalog.supplierProducts, [optimizationServiceFactoryKey]: factory,
      [cuttingPlanPdfServiceKey]: createCuttingPlanPdfService({ generate: vi.fn(), generateProject: pdfGenerate }),
    } },
  })
  wrappers.push(wrapper)
  await vi.waitFor(() => { expect(wrapper.text()).not.toContain('Loading project inputs') })
  async function start(): Promise<FakeWorker> {
    const requestCount = workers.reduce((sum, worker) => sum + worker.requests.length, 0)
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => { expect(workers.reduce((sum, worker) => sum + worker.requests.length, 0)).toBeGreaterThan(requestCount) })
    const worker = workers.at(-1)
    if (worker === undefined) throw new Error('Missing worker')
    return worker
  }
  return { wrapper, persistence, catalog, service, project, other, product, part, workers, start, pdfGenerate, indexedDB, plans, current, router }
}
describe('Automatic project optimization', () => {
  it('starts with compact settings and an empty canvas workspace, then shows results directly', async () => {
    const { wrapper, start } = await setup()
    const settings = wrapper.get('form details')
    expect(settings.attributes('open')).toBeUndefined()
    expect(wrapper.find('[aria-label="Empty cutting workspace"]').exists()).toBe(true)
    expect(wrapper.findAll('button').filter(button => button.text() === 'Optimize')).toHaveLength(1)
    const worker = await start()
    worker.complete(); await flushPromises()
    expect(wrapper.find('[aria-label="Empty cutting workspace"]').exists()).toBe(false)
    expect(wrapper.findAll('[aria-label="Cutting statistics"]')).toHaveLength(1)
    expect(wrapper.get('[aria-label="Cutting statistics"]').findAll('dt').map(label => label.text())).toEqual(['Placed parts', 'Unplaced parts', 'Panels used', 'Overall utilization'])
    expect(wrapper.text()).not.toContain('Validated project cutting plan')
    expect(wrapper.text()).not.toContain('Validated panel plan')
    expect(wrapper.text()).not.toContain('Panel utilization')
    expect(wrapper.findAll('[aria-label="Cutting plan canvas"]')).toHaveLength(1)
    const selector = wrapper.get('#optimization-layout').element
    const canvas = wrapper.get('[aria-label="Cutting plan canvas"]').element
    expect(selector.compareDocumentPosition(canvas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(wrapper.find('[aria-label="Complete vector PDF export"]').exists()).toBe(false)
    expect(wrapper.get('[aria-label="Panel cutting workspace"] details').attributes('open')).toBeUndefined()
  })

  it('keeps collapsed settings functional and reveals validation errors automatically', async () => {
    const { wrapper, start, workers } = await setup()
    const settings = wrapper.get<HTMLDetailsElement>('form details')
    settings.element.open = true
    await settings.trigger('toggle')
    await wrapper.get('#optimization-kerf').setValue(4)
    await wrapper.get('#optimization-margin').setValue(5)
    await wrapper.get('[data-panel-id]').setValue(2)
    settings.element.open = false
    await settings.trigger('toggle')
    const worker = await start()
    expect(worker.request.input.settings).toEqual({ kerfMm: 4, edgeMarginMm: 5 })
    expect(worker.request.type === 'optimizeProject' && worker.request.input.panels[0]?.quantity).toBe(2)
    worker.complete(); await flushPromises()
    await vi.waitFor(() => { expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined() })
    await wrapper.get('#optimization-kerf').setValue(-1)
    await wrapper.get('form').trigger('submit')
    expect(settings.element.open).toBe(true)
    expect(wrapper.get('#optimization-kerf').attributes('aria-invalid')).toBe('true')
    expect(workers).toHaveLength(1)
  })

  it('uses selected owned stock with its real quantity and geometry without consuming inventory', async () => {
    const { wrapper, persistence, service, project, start, current } = await setup()
    const owner = await service.projects.get(project.id)
    if (!owner.ok) throw new Error('Missing project')
    const stock = stockItemSchema.parse({ ...validStockItemInput, lengthMm: 2500, widthMm: 1250, quantity: 2 })
    await persistence.stockItems.update(stock.id, stock)
    expect((await service.projects.update(project.id, { ...owner.value, supplierProductIds: [], stockItemIds: [stock.id] })).ok).toBe(true)
    const before = await persistence.stockItems.list()
    await wrapper.findAll('button').find(button => button.text() === 'Refresh inputs')?.trigger('click')
    await vi.waitFor(() => { expect(wrapper.find('form').exists()).toBe(true) })
    const worker = await start()
    const request = worker.request
    if (request.type !== 'optimizeProject') throw new Error('Wrong request')
    expect(request.input.panels).toEqual([{ product: stockPanel(stock), quantity: stock.quantity }])
    worker.complete()
    await vi.waitFor(() => { expect(wrapper.find('[aria-label="Cutting statistics"]').exists()).toBe(true) })
    expect(wrapper.get('[aria-label="Cutting results"]').text()).toContain('Stock · Owned stock')
    await vi.waitFor(async () => { const saved = await current.load(); expect(saved.ok && saved.value.result?.contents.sources[0]?.product.stockItemId).toBe(stock.id) })
    expect(await persistence.stockItems.list()).toEqual(before)
    expect(await persistence.cuttingConfirmations.list()).toEqual({ ok: true, value: [] })
    const saved = await current.load()
    expect(saved.ok && saved.value.result?.plan.metrics.placedCount).toBe(2)
  })

  it('edits and exports the displayed plan with undo/reset while leaving saved parts, selections and inventory unchanged', async () => {
    const { wrapper, persistence, service, project, workers, start, pdfGenerate } = await setup()
    const stock = await persistence.stockItems.list()
    const savedProject = await service.projects.get(project.id)
    const savedParts = await service.parts(project.id).list()
    const worker = await start()
    const input = structuredClone(worker.request.input)
    worker.complete(); await flushPromises()
    async function click(label: string): Promise<void> {
      const button = wrapper.findAll('button').find(button => button.text() === label)
      if (button === undefined) throw new Error(`Missing ${label}`)
      await button.trigger('click')
    }
    expect(wrapper.text()).not.toContain('Validate Cutting')
    expect(wrapper.find('[aria-label="Complete vector PDF export"]').exists()).toBe(false)
    expect(wrapper.findAll('button').filter(control => control.text() === 'Finalize cutting')).toHaveLength(1)
    const finalization = wrapper.get('[data-finalization-action]').element
    const layout = wrapper.get('[aria-label="Cutting plan canvas"]').element
    expect(layout.compareDocumentPosition(finalization) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await click('Finalize cutting');
    await click('Export PDF'); await flushPromises()
    await click('Close finalization')
    expect(pdfGenerate.mock.calls[0]?.[0].panels[0]).toMatchObject({ edited: false, materialName: validMaterialInput.name })
    expect(pdfGenerate.mock.calls[0]?.[0].panels[0]?.scene.parts[0]?.copyIndex).toBe(0)
    await wrapper.get('#cutting-viewer-part').setValue(wrapper.get('#cutting-viewer-part option:nth-child(2)').attributes('value'))
    await click('Enter Edit Mode')
    await wrapper.get('#cutting-viewer-swap').setValue(wrapper.get('#cutting-viewer-swap option:nth-child(2)').attributes('value'))
    await click('Swap selected copies')
    expect(wrapper.text()).toContain('Swap accepted and independently validated')
    expect(wrapper.text()).toContain('Accepted manual edits')
    expect(wrapper.text()).toContain('Optimizer baseline strategy')
    expect(wrapper.get('tbody tr:first-child').text()).toContain('Side panel / 2')
    await click('Finalize cutting')
    await wrapper.get('#pdf-page-orientation').setValue('portrait')
    await click('Export PDF'); await flushPromises()
    await click('Close finalization')
    expect(pdfGenerate.mock.calls[1]?.[0].panels[0]).toMatchObject({ edited: true, orientation: 'portrait' })
    expect(pdfGenerate.mock.calls[1]?.[0].panels[0]?.scene.parts[0]?.copyIndex).toBe(1)
    await click('Undo edit')
    expect(wrapper.find('[aria-label="Panel cutting workspace"]').exists()).toBe(true)
    expect(wrapper.get('tbody tr:first-child').text()).toContain('Side panel / 1')
    await click('Finalize cutting');
    await click('Export PDF'); await flushPromises()
    await click('Close finalization')
    expect(pdfGenerate.mock.calls[2]?.[0].panels[0]?.edited).toBe(false)
    expect(pdfGenerate.mock.calls[2]?.[0].panels[0]?.scene).toEqual(pdfGenerate.mock.calls[0]?.[0].panels[0]?.scene)
    await click('Redo edit')
    await click('Reset to Optimized Plan')
    expect(wrapper.get('tbody tr:first-child').text()).toContain('Side panel / 1')
    expect(worker.request.input).toEqual(input)
    expect(workers).toHaveLength(1)
    expect(await persistence.stockItems.list()).toEqual(stock)
    expect(await service.projects.get(project.id)).toEqual(savedProject)
    expect(await service.parts(project.id).list()).toEqual(savedParts)
  })
  it('loads only active-project parts and selected catalog products', async () => {
    const { wrapper, start, product, part } = await setup()
    expect(wrapper.text()).toContain(product.name)
    expect(wrapper.text()).not.toContain('Unselected panel')
    const worker = await start()
    expect(worker.request.input.parts).toEqual([part])
    expect(worker.request.type).toBe('optimizeProject')
    expect(worker.request.type === 'optimizeProject' && worker.request.input.panels).toEqual([{ product, quantity: 1 }])
    expect(worker.request.input.settings).toEqual({ kerfMm: 3, edgeMarginMm: 0 })
    expect(wrapper.text()).toContain('Optimization running')
  })
  it('displays the validated strategy, utilization, waste, dimensions and quantities without modifying inventory or selections', async () => {
    const { wrapper, persistence, service, project, start } = await setup()
    const stock = await persistence.stockItems.list()
    const savedProject = await service.projects.get(project.id)
    const worker = await start(); worker.complete(); await flushPromises()
    expect(wrapper.find('[aria-label="Panel cutting workspace"]').exists()).toBe(true)
    expect(wrapper.get('[aria-label="Cutting statistics"]').findAll('dd').slice(0, 2).map(value => value.text())).toEqual(['2', '0'])
    expect(wrapper.text()).toContain('largestAreaFirst')
    expect(wrapper.text()).toContain('Cutting layout')
    expect(wrapper.find('[aria-label="Cutting plan canvas"]').exists()).toBe(true)
    expect(wrapper.get('[aria-label="Cutting statistics"]').text()).toContain('Overall utilization')
    expect(wrapper.text()).toContain('Waste area')
    expect(wrapper.get('table').text()).toContain('720 × 560 × 18')
    expect(wrapper.get('[aria-label="Cutting results"]').text()).toContain('Catalog')
    const inputSnapshot = structuredClone(worker.request.input)
    const copy = wrapper.get('#cutting-viewer-part option:nth-child(2)').attributes('value')
    await wrapper.get('#cutting-viewer-part').setValue(copy)
    const zoom = wrapper.findAll('button').find(button => button.text() === 'Zoom in')
    if (zoom === undefined) throw new Error('Missing zoom control')
    await zoom.trigger('click')
    expect(wrapper.get('aside dl').text()).toContain('Side panel / 1')
    expect(worker.request.input).toEqual(inputSnapshot)
    expect(await persistence.stockItems.list()).toEqual(stock)
    expect(await service.projects.get(project.id)).toEqual(savedProject)
  })
  it('automatically skips references with a different material or even slightly different thickness', async () => {
    const { wrapper, catalog, service, project, product, start } = await setup()
    await catalog.materials.create({ ...validMaterialInput, id: 'different-material' })
    const wrongMaterial = supplierProductSchema.parse({ ...product, id: 'wrong-material', materialId: 'different-material' })
    const wrongThickness = supplierProductSchema.parse({ ...product, id: 'wrong-thickness', thicknessMm: 18.000001 })
    await catalog.supplierProducts.create(wrongMaterial); await catalog.supplierProducts.create(wrongThickness)
    const saved = await service.projects.get(project.id)
    if (!saved.ok) throw new Error('Missing project')
    await service.projects.update(project.id, { ...saved.value, supplierProductIds: [product.id, wrongMaterial.id, wrongThickness.id] })
    const worker = await start()
    expect(worker.request.type === 'optimizeProject' && worker.request.input.panels).toHaveLength(3)
    worker.complete(); await flushPromises()
    expect(wrapper.text()).toContain('No matching material and exact thickness')
    expect(wrapper.get('[aria-label="Cutting statistics"]').findAll('dd').slice(0, 2).map(value => value.text())).toEqual(['2', '0'])
    expect(wrapper.get('#optimization-layout').findAll('option')).toHaveLength(1)
    expect(wrapper.get('#optimization-layout').text()).toContain(product.name)
  })
  it('includes incompatible project parts as unplaced instead of silently filtering them', async () => {
    const { wrapper, service, project, part, start } = await setup()
    await service.parts(project.id).create({ ...part, id: 'thick-part', name: 'Thick part', thicknessMm: 19, quantity: 3 })
    const worker = await start()
    expect(worker.request.input.parts).toHaveLength(2)
    worker.complete(); await flushPromises()
    expect(wrapper.get('[aria-label="Cutting statistics"]').findAll('dd')[1]?.text()).toBe('3')
    expect(wrapper.text()).toContain('Thick part · 3 copies · No selected panel matches the material and exact thickness')
    expect(wrapper.text()).toContain('Incomplete cutting result — review unplaced parts')
  })
  it('reports oversized parts and grain with forbidden rotation as impossible placements', async () => {
    const { wrapper, service, project, part, start } = await setup()
    await service.parts(project.id).create({ ...part, id: 'huge-part', name: 'Oversized', lengthMm: 9000, widthMm: 9000 })
    await service.parts(project.id).create({ ...part, id: 'grain-part', name: 'Cross grain', grainDirection: 'width' })
    const worker = await start(); worker.complete(); await flushPromises()
    expect(wrapper.text()).toContain('Oversized · 2 copies · Dimensions, grain, rotation, kerf or margins prevent placement')
    expect(wrapper.text()).toContain('Cross grain · 2 copies · Dimensions, grain, rotation, kerf or margins prevent placement')
  })
  it('reports quantities that exceed the capacity of one panel', async () => {
    const { wrapper, service, project, part, start } = await setup()
    await service.parts(project.id).update(part.id, { ...part, quantity: 50 })
    const worker = await start(); worker.complete(); await flushPromises()
    expect(wrapper.text()).toContain('Available panel quantity or remaining usable space is insufficient')
    expect(wrapper.text()).toContain('Incomplete cutting result — review unplaced parts')
  })
  it('cancels and ignores a late reply before starting a newer request', async () => {
    const { wrapper, start, workers } = await setup()
    const first = await start()
    const lateReply = first.onmessage
    await wrapper.get('form button[type="button"]').trigger('click')
    expect(first.terminate).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('Optimization cancelled')
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => { expect(workers).toHaveLength(2) })
    lateReply?.(new MessageEvent('message', { data: handleOptimizationRequest(first.request) }))
    await flushPromises()
    expect(wrapper.find('[aria-label="Panel cutting workspace"]').exists()).toBe(false)
    workers[1]?.complete(); await flushPromises()
    expect(wrapper.find('[aria-label="Panel cutting workspace"]').exists()).toBe(true)
  })
  it('terminates the worker and removes handlers when leaving the project section', async () => {
    const { wrapper, start } = await setup()
    const worker = await start(); wrapper.unmount()
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(worker.onmessage).toBeNull()
    expect(worker.onerror).toBeNull()
  })
  it('clears old results after changing settings', async () => {
    const { wrapper, start } = await setup()
    const worker = await start(); worker.complete(); await flushPromises()
    await vi.waitFor(() => { expect(wrapper.get('#optimization-kerf').attributes('disabled')).toBeUndefined() })
    await wrapper.get('#optimization-kerf').setValue(4)
    expect(wrapper.find('[aria-label="Panel cutting workspace"]').exists()).toBe(false)
  })
  it.each(['optimization-kerf', 'optimization-margin'])('validates empty and negative %s without starting a worker', async id => {
    const { wrapper, workers } = await setup()
    for (const value of ['', -1]) {
      await wrapper.get(`#${id}`).setValue(value)
      await wrapper.get('form').trigger('submit')
      expect(wrapper.get(`#${id}`).attributes('aria-invalid')).toBe('true')
      expect(wrapper.get<HTMLDetailsElement>('form details').element.open).toBe(true)
    }
    expect(workers).toHaveLength(0)
  })
  it('reports margins that prevent placement without allocating an empty panel', async () => {
    const { wrapper, start } = await setup()
    await wrapper.get('#optimization-margin').setValue(2000)
    const worker = await start(); worker.complete(); await flushPromises()
    expect(wrapper.text()).toContain('Dimensions, grain, rotation, kerf or margins prevent placement')
    expect(wrapper.text()).toContain('No panels allocated')
  })
  it('surfaces worker errors with retry available', async () => {
    const { wrapper, start } = await setup()
    const worker = await start()
    worker.onerror?.(new ErrorEvent('error', { message: 'Worker crashed' })); await flushPromises()
    expect(wrapper.text()).toContain('Optimization failed: Worker crashed')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
  })
  it('rejects a worker plan that fails independent validation', async () => {
    const { wrapper, start } = await setup()
    const worker = await start()
    if (worker.request.type !== 'optimizeProject') throw new Error('Expected project request')
    const selection = optimizeProject(worker.request.input)
    if (!selection.ok) throw new Error('Expected valid fixture')
    const panel = selection.plan.panels[0]
    if (!panel) throw new Error('Expected panel')
    const invalid = { ...selection, plan: { ...selection.plan, panels: [{ ...panel, plan: { ...panel.plan, tree: { ...panel.plan.tree, region: { ...panel.plan.tree.region, xMm: 10 } } } }] } }
    worker.onmessage?.(new MessageEvent('message', { data: { type: 'projectResult', requestId: worker.request.requestId, selection: invalid } }))
    await flushPromises()
    expect(wrapper.text()).toContain('failed independent validation')
    expect(wrapper.find('[aria-label="Panel cutting workspace"]').exists()).toBe(false)
  })
  it('rereads project selections before running and refuses a removed product', async () => {
    const { wrapper, service, project, workers } = await setup()
    const saved = await service.projects.get(project.id)
    if (!saved.ok) throw new Error('Missing project')
    await service.projects.update(project.id, { ...saved.value, supplierProductIds: [] })
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => { expect(wrapper.text()).toContain('Select catalog or stock panels in this project') })
    expect(workers).toHaveLength(0)
  })
  it('handles storage failures and retry without showing previous inputs as a plan', async () => {
    const { wrapper, catalog } = await setup()
    const spy = vi.spyOn(catalog.supplierProducts, 'list').mockResolvedValueOnce({ ok: false, error: { kind: 'storageFailure', message: 'Disk unavailable' } })
    await wrapper.get('button').trigger('click')
    await vi.waitFor(() => { expect(wrapper.text()).toContain('Could not access local storage') })
    expect(wrapper.find('form').exists()).toBe(false)
    spy.mockRestore()
    await wrapper.get('button:last-child').trigger('click')
    await vi.waitFor(() => { expect(wrapper.find('form').exists()).toBe(true) })
  })
  it('shows empty scoped input states without exposing another project’s parts', async () => {
    const { wrapper, service, project, part } = await setup()
    await service.parts(project.id).delete(part.id)
    const saved = await service.projects.get(project.id)
    if (!saved.ok) throw new Error('Missing project')
    await service.projects.update(project.id, { ...saved.value, supplierProductIds: [] })
    await wrapper.get('button').trigger('click')
    await vi.waitFor(() => { expect(wrapper.text()).toContain('No parts in this project') })
    expect(wrapper.text()).toContain('No selected panels')
    expect(wrapper.text()).not.toContain('Other project part')
  })
  it('shows loading and disables controls while refreshing repository snapshots', async () => {
    const { wrapper, catalog } = await setup()
    const saved = await catalog.supplierProducts.list()
    let finish: () => void = () => { throw new Error('Not started') }
    vi.spyOn(catalog.supplierProducts, 'list').mockReturnValueOnce(new Promise(resolve => { finish = () => { resolve(saved) } }))
    await wrapper.get('button').trigger('click')
    expect(wrapper.text()).toContain('Loading project inputs')
    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
    finish()
    await vi.waitFor(() => { expect(wrapper.find('form').exists()).toBe(true) })
  })
  it('cancels input loading before a worker is created and ignores the late load', async () => {
    const { wrapper, service, project, workers } = await setup()
    const saved = await service.projects.get(project.id)
    let finish: () => void = () => { throw new Error('Not started') }
    vi.spyOn(service.projects, 'get').mockReturnValueOnce(new Promise(resolve => { finish = () => { resolve(saved) } }))
    await wrapper.get('form').trigger('submit')
    await wrapper.get('form button[type="button"]').trigger('click')
    finish(); await flushPromises()
    expect(workers).toHaveLength(0)
    expect(wrapper.text()).toContain('Optimization cancelled')
    expect(wrapper.find('[aria-label="Panel cutting workspace"]').exists()).toBe(false)
  })
  it('ignores responses with the wrong request ID while the current request continues', async () => {
    const { wrapper, start } = await setup()
    const worker = await start()
    worker.onmessage?.(new MessageEvent('message', { data: { ...handleOptimizationRequest(worker.request), requestId: worker.request.requestId + 1 } }))
    await flushPromises()
    expect(wrapper.text()).toContain('Optimization running')
    expect(wrapper.find('[aria-label="Panel cutting workspace"]').exists()).toBe(false)
    worker.complete(); await flushPromises()
    expect(wrapper.find('[aria-label="Panel cutting workspace"]').exists()).toBe(true)
  })
  it('reports a valid zero-placement plan without claiming parts were produced', async () => {
    const { wrapper, service, project, part, start } = await setup()
    await service.parts(project.id).update(part.id, { ...part, lengthMm: 9000, widthMm: 9000 })
    const worker = await start(); worker.complete(); await flushPromises()
    expect(wrapper.get('[aria-label="Cutting statistics"]').findAll('dd').slice(0, 2).map(value => value.text())).toEqual(['0', '2'])
    expect(wrapper.find('table').exists()).toBe(false)
    expect(wrapper.text()).toContain('Incomplete cutting result — review unplaced parts')
  })
  it('respects kerf feasibility rather than placing a part with an uncuttable remainder', async () => {
    const { wrapper, catalog, product, start } = await setup()
    await catalog.supplierProducts.update(product.id, { ...product, lengthMm: 723, widthMm: 560 })
    const worker = await start(); worker.complete(); await flushPromises()
    expect(wrapper.text()).toContain('Dimensions, grain, rotation, kerf or margins prevent placement')
    expect(wrapper.get('[aria-label="Cutting statistics"]').findAll('dd').slice(0, 2).map(value => value.text())).toEqual(['0', '2'])
  })
  it('uses entered kerf and margins and clears the plan when changing availability', async () => {
    const { wrapper, start } = await setup()
    await wrapper.get('#optimization-kerf').setValue(4.5)
    await wrapper.get('#optimization-margin').setValue(10)
    const worker = await start()
    expect(worker.request.input.settings).toEqual({ kerfMm: 4.5, edgeMarginMm: 10 })
    worker.complete(); await flushPromises()
    expect(wrapper.text()).toContain('Kerf 4.5 mm · Edge margin 10 mm')
    await vi.waitFor(() => { expect(wrapper.get('[data-panel-id]').attributes('disabled')).toBeUndefined() })
    await wrapper.get('[data-panel-id]').setValue(0)
    expect(wrapper.find('[aria-label="Panel cutting workspace"]').exists()).toBe(false)
  })
  it('disables unavailable and broken catalog panels without repairing records', async () => {
    const { wrapper, catalog, persistence, product, workers } = await setup()
    await catalog.supplierProducts.update(product.id, { ...product, availability: 'unavailable' })
    await wrapper.get('button').trigger('click')
    await vi.waitFor(() => { expect(wrapper.text()).toContain('Unavailable') })
    expect(wrapper.get('[data-panel-id]').attributes('disabled')).toBeDefined()
    await persistence.suppliers.delete(product.supplierId)
    await wrapper.get('button').trigger('click')
    await vi.waitFor(() => { expect(wrapper.text()).toContain('Missing catalog reference') })
    expect(wrapper.get('[data-panel-id]').attributes('disabled')).toBeDefined()
    expect(workers).toHaveLength(0)
    expect((await persistence.supplierProducts.get(product.id)).ok).toBe(true)
  })

  it('explicitly reports missing selected products without changing selections', async () => {
    const { wrapper, persistence, product, service, project } = await setup()
    await persistence.supplierProducts.delete(product.id)
    await wrapper.get('button').trigger('click')
    await vi.waitFor(() => { expect(wrapper.text()).toContain(`Missing selected products: ${product.id}`) })
    const saved = await service.projects.get(project.id)
    expect(saved.ok && saved.value.supplierProductIds).toEqual([product.id])
  })
})

describe('automatic workflow and per-panel integration', () => {
  it('offers one Optimize action without a panel picker or single/multi mode selector', async () => {
    const { wrapper, start } = await setup()
    expect(wrapper.find('#optimization-panel').exists()).toBe(false)
    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.findAll('button').filter(button => button.text() === 'Optimize')).toHaveLength(1)
    expect(wrapper.text()).not.toMatch(/single.panel|multi.panel/i)
    const worker = await start()
    worker.complete(); await flushPromises()
    expect(wrapper.get('#optimization-layout').findAll('option')).toHaveLength(1)
    expect(wrapper.get('[aria-label="Cutting statistics"]').findAll('dd').slice(0, 2).map(value => value.text())).toEqual(['2', '0'])
  })
  it.each(['', -1, 1.5, '9007199254740992'])('rejects invalid availability %s without starting a worker', async value => {
    const { wrapper, workers } = await setup()
    await wrapper.get('[data-panel-id]').setValue(value)
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => { expect(wrapper.get('[data-panel-id]').attributes('aria-invalid')).toBe('true') })
    expect(workers).toHaveLength(0)
  })
  it('persists quantities independently per project and reopens them without modifying legacy records or catalog data', async () => {
    const { wrapper, indexedDB, persistence, service, project, other, start, catalog } = await setup()
    const stock = await persistence.stockItems.list()
    const parts = await service.parts(project.id).list()
    const materials = await catalog.materials.list()
    const products = await catalog.supplierProducts.list()
    const untouched = await service.projects.get(other.id)
    await wrapper.get('[data-panel-id]').setValue(3)
    const worker = await start(); worker.complete(); await flushPromises()
    expect(worker.request.type === 'optimizeProject' && worker.request.input.panels[0]?.quantity).toBe(3)
    const reopened = createLocalPersistence('optimization-ui', { indexedDB, IDBKeyRange })
    connections.push(reopened)
    const saved = await reopened.projects.get(project.id)
    expect(saved.ok && saved.value.panelQuantities).toEqual([{ supplierProductId: validSupplierProductInput.id, quantity: 3 }])
    expect(await service.projects.get(other.id)).toEqual(untouched)
    expect(await persistence.stockItems.list()).toEqual(stock)
    expect(await service.parts(project.id).list()).toEqual(parts)
    expect(await catalog.materials.list()).toEqual(materials)
    expect(await catalog.supplierProducts.list()).toEqual(products)
    await wrapper.get('button').trigger('click')
    await vi.waitFor(() => { expect(wrapper.get('[data-panel-id]').element).toHaveProperty('value', '3') })
  })
  it('shows quantity persistence failures and preserves the draft for retry', async () => {
    const { wrapper, service, workers } = await setup()
    vi.spyOn(service.projects, 'update').mockResolvedValueOnce({ ok: false, error: { kind: 'storageFailure', message: 'Cannot save' } })
    await wrapper.get('[data-panel-id]').setValue(2)
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => { expect(wrapper.text()).toContain('Could not access local storage') })
    expect(workers).toHaveLength(0)
    expect(wrapper.get('[data-panel-id]').element).toHaveProperty('value', '2')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
  })
  it('navigates layouts and preserves independent edits, undo, viewport and complete-result PDF exports', async () => {
    const { wrapper, catalog, service, project, product, part, start, pdfGenerate, persistence } = await setup()
    await catalog.supplierProducts.update(product.id, { ...product, lengthMm: 1443, widthMm: 560 })
    await service.parts(project.id).update(part.id, { ...part, quantity: 4 })
    const stock = await persistence.stockItems.list()
    await wrapper.get('[data-panel-id]').setValue(2)
    const worker = await start()
    const snapshot = structuredClone(worker.request.input)
    worker.complete(); await flushPromises()
    expect(wrapper.get('[aria-label="Cutting statistics"]').findAll('dd').slice(0, 2).map(value => value.text())).toEqual(['4', '0'])
    expect(wrapper.get('#optimization-layout').findAll('option')).toHaveLength(2)
    async function click(label: string): Promise<void> {
      const button = wrapper.findAll('button').find(button => button.text() === label)
      if (!button) throw new Error(`Missing ${label}`)
      await button.trigger('click')
    }
    await wrapper.get('#cutting-viewer-part').setValue(wrapper.get('#cutting-viewer-part option:nth-child(2)').attributes('value'))
    await click('Enter Edit Mode')
    await wrapper.get('#cutting-viewer-swap').setValue(wrapper.get('#cutting-viewer-swap option:nth-child(2)').attributes('value'))
    await click('Swap selected copies')
    expect(wrapper.get('tbody tr:first-child').text()).toContain('Side panel / 2')
    await click('Zoom in')
    await click('Finalize cutting');
    await click('Export PDF'); await flushPromises()
    await click('Close finalization')
    expect(pdfGenerate.mock.calls[0]?.[0].panels[0]?.edited).toBe(true)
    expect(pdfGenerate.mock.calls[0]?.[0].panels[0]?.unplaced).toMatchObject([{ firstCopyIndex: 2, count: 2, reason: { kind: 'allocatedElsewhere' } }])
    await wrapper.get('#optimization-layout').setValue(1)
    expect(wrapper.get('tbody tr:first-child').text()).toContain('Side panel / 3')
    expect(wrapper.text()).not.toContain('Accepted manual edits')
    expect(wrapper.find('#cutting-viewer-swap').exists()).toBe(false)
    expect(wrapper.findAll('[aria-label="Cutting plan canvas"]')).toHaveLength(1)
    await click('Finalize cutting');
    await click('Export PDF'); await flushPromises()
    await click('Close finalization')
    expect(pdfGenerate.mock.calls[1]?.[0].panels[1]?.edited).toBe(false)
    expect(pdfGenerate.mock.calls[1]?.[0].panels[1]?.scene.parts[0]?.copyIndex).toBe(2)
    await wrapper.get('#optimization-layout').setValue(0)
    expect(wrapper.text()).toContain('Accepted manual edits')
    expect(wrapper.get('tbody tr:first-child').text()).toContain('Side panel / 2')
    await click('Undo edit')
    expect(wrapper.get('tbody tr:first-child').text()).toContain('Side panel / 1')
    const downloads = vi.mocked(downloadCuttingPlanPdf).mock.calls.length
    let finish: () => void = () => { throw new Error('Export has not started') }
    pdfGenerate.mockImplementationOnce(() => new Promise(resolve => { finish = () => { resolve(new Uint8Array([2])) } }))
    await click('Finalize cutting');
    await click('Export PDF'); await flushPromises()
    expect(wrapper.text()).toContain('Generating PDF')
    await click('Close finalization')
    await wrapper.get('#optimization-layout').setValue(1)
    finish(); await flushPromises()
    expect(vi.mocked(downloadCuttingPlanPdf).mock.calls).toHaveLength(downloads)
    expect(worker.request.input).toEqual(snapshot)
    expect(await persistence.stockItems.list()).toEqual(stock)
  })
  it('reports zero availability without allocating a panel or exposing an export action', async () => {
    const { wrapper, start } = await setup()
    await wrapper.get('[data-panel-id]').setValue(0)
    const worker = await start(); worker.complete(); await flushPromises()
    expect(wrapper.get('[aria-label="Cutting statistics"]').findAll('dd').slice(0, 2).map(value => value.text())).toEqual(['0', '2'])
    expect(wrapper.text()).toContain('No panels allocated')
    expect(wrapper.findAll('button').some(button => button.text() === 'Export PDF')).toBe(false)
  })
})

describe('automatic current result in the optimization workspace', () => {
  async function click(wrapper: VueWrapper, text: string): Promise<void> {
    const button = wrapper.findAll('button').find(button => button.text() === text)
    if (!button) throw new Error(`Missing ${text}`)
    await button.trigger('click')
  }
  async function editSwap(wrapper: VueWrapper): Promise<void> {
    await wrapper.get('#cutting-viewer-part').setValue(wrapper.get('#cutting-viewer-part option:nth-child(2)').attributes('value'))
    await click(wrapper, 'Enter Edit Mode')
    await wrapper.get('#cutting-viewer-swap').setValue(wrapper.get('#cutting-viewer-swap option:nth-child(2)').attributes('value'))
    await click(wrapper, 'Swap selected copies')
  }
  async function persisted(current: ReturnType<ReturnType<typeof createCurrentResultService>['forProject']>, copies?: readonly number[]) {
    await vi.waitFor(async () => {
      const loaded = await current.load()
      expect(loaded.ok && loaded.value.result).toBeTruthy()
      if (copies) expect(loaded.ok && loaded.value.result?.plan.panels.map(panel => panel.plan.placements[0]?.copyIndex)).toEqual(copies)
    })
  }
  it('automatically persists edits on all panels, restores them and reuses viewing and PDF export', async () => {
    const { wrapper, catalog, service, project, product, part, current, start, pdfGenerate, persistence } = await setup()
    await catalog.supplierProducts.update(product.id, { ...product, lengthMm: 1443, widthMm: 560 })
    await service.parts(project.id).update(part.id, { ...part, quantity: 4 })
    const stock = await persistence.stockItems.list()
    await wrapper.get('[data-panel-id]').setValue(2)
    const worker = await start(); worker.complete(); await flushPromises()
    await persisted(current)
    for (const text of ['Save Plan', 'Open Plan', 'Validate Plan', 'Saved plans', 'Unsaved result']) expect(wrapper.text()).not.toContain(text)
    await editSwap(wrapper)
    await wrapper.get('#optimization-layout').setValue(1)
    await editSwap(wrapper)
    await persisted(current, [1, 3])
    const saved = await current.load()
    expect(saved.ok && saved.value.result?.contents.panels.map(panel => panel.edited)).toEqual([true, true])
    // Refresh exercises restoration without an explicit Open or Save action.
    await vi.waitFor(() => { expect(wrapper.get('button').attributes('disabled')).toBeUndefined() })
    await click(wrapper, 'Refresh inputs')
    await vi.waitFor(() => { expect(wrapper.find('#cutting-viewer-part').exists()).toBe(true) })
    expect(wrapper.get('tbody tr:first-child').text()).toContain('Side panel / 2')
    await click(wrapper, 'Finalize cutting');
    await click(wrapper, 'Export PDF'); await flushPromises()
    await click(wrapper, 'Close finalization')
    expect(pdfGenerate.mock.calls[0]?.[0].panels[0]?.edited).toBe(true)
    expect(pdfGenerate.mock.calls[0]?.[0].panels[0]?.scene.parts[0]?.copyIndex).toBe(1)
    await wrapper.get('#optimization-layout').setValue(1)
    expect(wrapper.get('tbody tr:first-child').text()).toContain('Side panel / 4')
    await click(wrapper, 'Enter Edit Mode')
    expect(wrapper.findAll('button').some(button => button.text() === 'Reset to Saved Plan')).toBe(true)
    expect(await persistence.stockItems.list()).toEqual(stock)
    const list = await persistence.savedPlanSummaries.listForProject(project.id)
    expect(list.ok && list.value).toHaveLength(1)
  })
  it('warns before discarding edits when automatic persistence fails and restores rejected inputs', async () => {
    const { wrapper, current, start } = await setup()
    const worker = await start(); worker.complete(); await persisted(current)
    vi.spyOn(current, 'replace').mockResolvedValue({ ok: false, error: { kind: 'storageFailure', message: 'Disk unavailable' } })
    await editSwap(wrapper)
    await vi.waitFor(() => { expect(wrapper.text()).toContain('Could not access local storage') })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await wrapper.get('#optimization-kerf').setValue(7)
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Discard unsaved manual'))
    expect(wrapper.get('#optimization-kerf').element).toHaveProperty('value', '3')
    expect(wrapper.text()).toContain('Accepted manual edits')
    await wrapper.get('[data-panel-id]').setValue(3)
    expect(wrapper.get('[data-panel-id]').element).toHaveProperty('value', '1')
    await click(wrapper, 'Reset to Optimized Plan')
    expect(wrapper.text()).toContain('Accepted manual edits')
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)
  })
  it('replaces the previous result after reoptimization without keeping a run history', async () => {
    const { wrapper, current, persistence, project, start } = await setup()
    let worker = await start(); worker.complete(); await persisted(current)
    const first = await current.load()
    await vi.waitFor(() => { expect(wrapper.get('button').attributes('disabled')).toBeUndefined() })
    worker = await start(); worker.complete(); await persisted(current)
    await vi.waitFor(async () => { const loaded = await current.load(); expect(loaded.ok && loaded.value.result?.summary.id).not.toBe(first.ok && first.value.result?.summary.id) })
    const second = await current.load()
    expect(second.ok && second.value.result?.summary.id).not.toBe(first.ok && first.value.result?.summary.id)
    expect(await persistence.currentCuttingResults.list()).toMatchObject({ ok: true, value: [{ id: project.id }] })
    const list = await persistence.savedPlanSummaries.listForProject(project.id)
    expect(list.ok && list.value).toHaveLength(1)
  })
  it('reports ambiguous legacy plans without exposing a saved-plan list or choosing a result', async () => {
    const { wrapper, plans, current, start } = await setup()
    const worker = await start()
    const request = worker.request
    if (request.type !== 'optimizeProject') throw new Error('Fixture')
    const selection = optimizeProject(request.input); if (!selection.ok) throw new Error('Fixture')
    await click(wrapper, 'Cancel optimization')
    const source = request.input.panels[0]; if (!source) throw new Error('Fixture')
    const { id, name, materialId, lengthMm, widthMm, thicknessMm, grainDirection } = source.product
    const input = { plan: selection.plan, parts: [...request.input.parts], settings: request.input.settings, sources: [{ product: panelSnapshotSchema.parse({ id, name, materialId, lengthMm, widthMm, thicknessMm, grainDirection }), quantity: source.quantity, materialName: 'Material', supplierName: 'Supplier' }], editedPanelIndices: [] }
    const metadata = { id: 'legacy-one', projectId: 'project-one', name: 'Legacy', createdAt: '2026-10-11T12:00:00.000Z' }
    await plans.save(metadata, input); await plans.save({ ...metadata, id: 'legacy-two' }, input)
    await click(wrapper, 'Refresh inputs')
    await vi.waitFor(() => { expect(wrapper.text()).toContain('2 legacy saved plans were preserved') })
    expect(wrapper.find('[aria-label="Cutting statistics"]').exists()).toBe(false)
    expect(wrapper.findAll('button').some(button => ['Save Plan', 'Open Plan', 'Validate Plan'].includes(button.text()))).toBe(false)
    expect(await current.load()).toMatchObject({ ok: true, value: { result: null, ambiguousLegacyCount: 2 } })
  })
  it('refuses corrupted stored geometry and restores valid historical context even if current inputs fail', async () => {
    const { wrapper, current, persistence, catalog, start } = await setup()
    const worker = await start(); worker.complete(); await persisted(current)
    const saved = await current.load()
    if (!saved.ok || !saved.value.result) throw new Error('Missing result')
    const body = saved.value.result.contents
    await persistence.savedPlanContents.update(body.id, { ...body, metrics: { ...body.metrics, placedCount: 900 } })
    await click(wrapper, 'Refresh inputs')
    await vi.waitFor(() => { expect(wrapper.text()).toContain('failed independent validation') })
    expect(wrapper.find('#cutting-viewer-part').exists()).toBe(false)
    await persistence.savedPlanContents.update(body.id, body)
    vi.spyOn(catalog.supplierProducts, 'list').mockResolvedValueOnce({ ok: false, error: { kind: 'storageFailure', message: 'Disk unavailable' } })
    await click(wrapper, 'Refresh inputs')
    await vi.waitFor(() => { expect(wrapper.find('#cutting-viewer-part').exists()).toBe(true) })
    expect(wrapper.text()).toContain('Could not access local storage')
  })
})
