import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { createMemoryHistory } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppRouter } from '../../../app/router'
import { createCatalogRepositories } from '../../../application/catalog/catalog-repositories'
import { createOptimizationService, type OptimizationWorkerPort } from '../../../application/optimization/optimization-service'
import type { OptimizeRequest } from '../../../application/optimization/optimization-protocol'
import { createProjectService } from '../../../application/projects/project-service'
import { cuttingProjectSchema } from '../../../domain/model/cutting-project'
import { partSchema } from '../../../domain/model/part'
import { supplierProductSchema } from '../../../domain/model/supplier-product'
import { validMaterialInput, validPartInput, validStockItemInput, validSupplierInput, validSupplierProductInput } from '../../../domain/model/__tests__/fixtures'
import { optimizePanel } from '../../../domain/optimizer/optimize-panel'
import { createLocalPersistence } from '../../../infrastructure/persistence/local-database'
import { materialRepositoryKey } from '../../materials/material-repository'
import { projectIdKey, projectServiceKey } from '../../projects/project-service'
import { supplierProductRepositoryKey, supplierRepositoryKey } from '../../suppliers/catalog-repositories'
import OptimizationView from '../OptimizationView.vue'
import { optimizationServiceFactoryKey } from '../optimization-service'

class FakeWorker implements OptimizationWorkerPort {
  onmessage: OptimizationWorkerPort['onmessage'] = null
  onerror: OptimizationWorkerPort['onerror'] = null
  onmessageerror: OptimizationWorkerPort['onmessageerror'] = null
  requests: OptimizeRequest[] = []
  terminate = vi.fn()
  postMessage(message: OptimizeRequest): void { this.requests.push(message) }
  get request(): OptimizeRequest {
    const request = this.requests.at(-1)
    if (request === undefined) throw new Error('No request')
    return request
  }
  complete(): void { this.onmessage?.(new MessageEvent('message', { data: { type: 'result', requestId: this.request.requestId, selection: optimizePanel(this.request.input) } })) }
}
const wrappers: VueWrapper[] = []
const connections: ReturnType<typeof createLocalPersistence>[] = []
afterEach(() => {
  wrappers.forEach(wrapper => { wrapper.unmount() })
  connections.forEach(connection => { connection.close() })
  wrappers.length = 0; connections.length = 0
})
async function setup() {
  const persistence = createLocalPersistence('optimization-ui', { indexedDB: new IDBFactory(), IDBKeyRange })
  connections.push(persistence)
  const catalog = createCatalogRepositories(persistence)
  const service = createProjectService(persistence)
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
  const router = createAppRouter(createMemoryHistory())
  await router.push('/')
  await router.isReady()
  const wrapper = mount(OptimizationView, {
    attachTo: document.body,
    global: { plugins: [router], provide: {
      [projectIdKey]: project.id, [projectServiceKey]: service,
      [materialRepositoryKey]: catalog.materials, [supplierRepositoryKey]: catalog.suppliers,
      [supplierProductRepositoryKey]: catalog.supplierProducts, [optimizationServiceFactoryKey]: factory,
    } },
  })
  wrappers.push(wrapper)
  await vi.waitFor(() => { expect(wrapper.text()).not.toContain('Loading project inputs') })
  async function start(): Promise<FakeWorker> {
    await wrapper.get('#optimization-panel').setValue(product.id)
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => { expect(workers.length).toBeGreaterThan(0) })
    const worker = workers.at(-1)
    if (worker === undefined) throw new Error('Missing worker')
    return worker
  }
  return { wrapper, persistence, catalog, service, project, other, product, part, workers, start }
}
describe('Project single-panel optimization', () => {
  it('loads only active-project parts and selected catalog products', async () => {
    const { wrapper, start, product, part } = await setup()
    expect(wrapper.get('select').text()).toContain(product.name)
    expect(wrapper.get('select').text()).not.toContain('Unselected panel')
    const worker = await start()
    expect(worker.request.input.parts).toEqual([part])
    expect(worker.request.input.panel).toEqual(product)
    expect(worker.request.input.settings).toEqual({ kerfMm: 3, edgeMarginMm: 0 })
    expect(wrapper.text()).toContain('Optimization running')
  })
  it('displays the validated strategy, utilization, waste, dimensions and quantities without modifying inventory or selections', async () => {
    const { wrapper, persistence, service, project, start } = await setup()
    const stock = await persistence.stockItems.list()
    const savedProject = await service.projects.get(project.id)
    const worker = await start(); worker.complete(); await flushPromises()
    expect(wrapper.text()).toContain('Validated single-panel plan')
    expect(wrapper.text()).toContain('2 copies placed · 0 copies unplaced')
    expect(wrapper.text()).toContain('largestAreaFirst')
    expect(wrapper.text()).toContain('Panel utilization')
    expect(wrapper.text()).toContain('Waste area')
    expect(wrapper.get('table').text()).toContain('720 × 560 × 18')
    expect(await persistence.stockItems.list()).toEqual(stock)
    expect(await service.projects.get(project.id)).toEqual(savedProject)
  })
  it('disables panels with a different material or even slightly different thickness', async () => {
    const { wrapper, catalog, service, project, product, workers } = await setup()
    await catalog.materials.create({ ...validMaterialInput, id: 'different-material' })
    const wrongMaterial = supplierProductSchema.parse({ ...product, id: 'wrong-material', materialId: 'different-material' })
    const wrongThickness = supplierProductSchema.parse({ ...product, id: 'wrong-thickness', thicknessMm: 18.000001 })
    await catalog.supplierProducts.create(wrongMaterial); await catalog.supplierProducts.create(wrongThickness)
    const saved = await service.projects.get(project.id)
    if (!saved.ok) throw new Error('Missing project')
    await service.projects.update(project.id, { ...saved.value, supplierProductIds: [product.id, wrongMaterial.id, wrongThickness.id] })
    await wrapper.get('button').trigger('click')
    await vi.waitFor(() => { expect(wrapper.findAll('option')).toHaveLength(4) })
    for (const id of [wrongMaterial.id, wrongThickness.id]) {
      expect(wrapper.get(`option[value="${id}"]`).attributes('disabled')).toBeDefined()
      await wrapper.get('select').setValue(id)
      await wrapper.get('form').trigger('submit')
      await vi.waitFor(() => { expect(wrapper.text()).toContain('No matching material and exact thickness') })
    }
    expect(workers).toHaveLength(0)
  })
  it('includes incompatible project parts as unplaced instead of silently filtering them', async () => {
    const { wrapper, service, project, part, start } = await setup()
    await service.parts(project.id).create({ ...part, id: 'thick-part', name: 'Thick part', thicknessMm: 19, quantity: 3 })
    const worker = await start()
    expect(worker.request.input.parts).toHaveLength(2)
    worker.complete(); await flushPromises()
    expect(wrapper.text()).toContain('3 copies unplaced')
    expect(wrapper.text()).toContain('Thick part · 3 copies · Exact thickness mismatch')
    expect(wrapper.text()).toContain('Additional panels or different inputs are needed')
  })
  it('reports oversized parts and grain with forbidden rotation as impossible placements', async () => {
    const { wrapper, service, project, part, start } = await setup()
    await service.parts(project.id).create({ ...part, id: 'huge-part', name: 'Oversized', lengthMm: 9000, widthMm: 9000 })
    await service.parts(project.id).create({ ...part, id: 'grain-part', name: 'Cross grain', grainDirection: 'width' })
    const worker = await start(); worker.complete(); await flushPromises()
    expect(wrapper.text()).toContain('Oversized · 2 copies · Exceeds usable panel size')
    expect(wrapper.text()).toContain('Cross grain · 2 copies · Grain requires forbidden rotation')
  })
  it('reports quantities that exceed the capacity of one panel', async () => {
    const { wrapper, service, project, part, start } = await setup()
    await service.parts(project.id).update(part.id, { ...part, quantity: 50 })
    const worker = await start(); worker.complete(); await flushPromises()
    expect(wrapper.text()).toContain('No space left on this panel')
    expect(wrapper.text()).toContain('Additional panels or different inputs are needed')
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
    lateReply?.(new MessageEvent('message', { data: { type: 'result', requestId: first.request.requestId, selection: optimizePanel(first.request.input) } }))
    await flushPromises()
    expect(wrapper.text()).not.toContain('Validated single-panel plan')
    workers[1]?.complete(); await flushPromises()
    expect(wrapper.text()).toContain('Validated single-panel plan')
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
    await wrapper.get('#optimization-kerf').setValue(4)
    expect(wrapper.text()).not.toContain('Validated single-panel plan')
  })
  it.each(['optimization-kerf', 'optimization-margin'])('validates empty and negative %s without starting a worker', async id => {
    const { wrapper, product, workers } = await setup()
    await wrapper.get('select').setValue(product.id)
    for (const value of ['', -1]) {
      await wrapper.get(`#${id}`).setValue(value)
      await wrapper.get('form').trigger('submit')
      expect(wrapper.get(`#${id}`).attributes('aria-invalid')).toBe('true')
    }
    expect(workers).toHaveLength(0)
  })
  it('surfaces no usable area as a failure, never a successful plan', async () => {
    const { wrapper, start } = await setup()
    await wrapper.get('#optimization-margin').setValue(2000)
    const worker = await start(); worker.complete(); await flushPromises()
    expect(wrapper.text()).toContain('Margins leave no usable panel area')
    expect(wrapper.text()).not.toContain('Validated single-panel plan')
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
    const selection = optimizePanel(worker.request.input)
    if (!selection.ok) throw new Error('Expected valid fixture')
    const invalid = { ...selection, plan: { ...selection.plan, tree: { ...selection.plan.tree, region: { ...selection.plan.tree.region, xMm: 10 } } } }
    worker.onmessage?.(new MessageEvent('message', { data: { type: 'result', requestId: worker.request.requestId, selection: invalid } }))
    await flushPromises()
    expect(wrapper.text()).toContain('failed independent validation')
    expect(wrapper.text()).not.toContain('Validated single-panel plan')
  })
  it('rereads project selections before running and refuses a removed product', async () => {
    const { wrapper, service, project, product, workers } = await setup()
    await wrapper.get('select').setValue(product.id)
    const saved = await service.projects.get(project.id)
    if (!saved.ok) throw new Error('Missing project')
    await service.projects.update(project.id, { ...saved.value, supplierProductIds: [] })
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => { expect(wrapper.text()).toContain('Select an existing panel from this project') })
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
    expect(wrapper.text()).toContain('No selected catalog panels')
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
    const { wrapper, service, project, product, workers } = await setup()
    const saved = await service.projects.get(project.id)
    let finish: () => void = () => { throw new Error('Not started') }
    vi.spyOn(service.projects, 'get').mockReturnValueOnce(new Promise(resolve => { finish = () => { resolve(saved) } }))
    await wrapper.get('select').setValue(product.id)
    await wrapper.get('form').trigger('submit')
    await wrapper.get('form button[type="button"]').trigger('click')
    finish(); await flushPromises()
    expect(workers).toHaveLength(0)
    expect(wrapper.text()).toContain('Optimization cancelled')
    expect(wrapper.text()).not.toContain('Validated single-panel plan')
  })
  it('ignores responses with the wrong request ID while the current request continues', async () => {
    const { wrapper, start } = await setup()
    const worker = await start()
    worker.onmessage?.(new MessageEvent('message', { data: { type: 'result', requestId: worker.request.requestId + 1, selection: optimizePanel(worker.request.input) } }))
    await flushPromises()
    expect(wrapper.text()).toContain('Optimization running')
    expect(wrapper.text()).not.toContain('Validated single-panel plan')
    worker.complete(); await flushPromises()
    expect(wrapper.text()).toContain('Validated single-panel plan')
  })
  it('reports a valid zero-placement plan without claiming parts were produced', async () => {
    const { wrapper, service, project, part, start } = await setup()
    await service.parts(project.id).update(part.id, { ...part, lengthMm: 9000, widthMm: 9000 })
    const worker = await start(); worker.complete(); await flushPromises()
    expect(wrapper.text()).toContain('0 copies placed · 2 copies unplaced')
    expect(wrapper.find('table').exists()).toBe(false)
    expect(wrapper.text()).toContain('Additional panels or different inputs are needed')
  })
  it('respects kerf feasibility rather than placing a part with an uncuttable remainder', async () => {
    const { wrapper, catalog, product, start } = await setup()
    await catalog.supplierProducts.update(product.id, { ...product, lengthMm: 723, widthMm: 560 })
    const worker = await start(); worker.complete(); await flushPromises()
    expect(wrapper.text()).toContain('Remainder cannot be cut with this kerf')
    expect(wrapper.text()).toContain('0 copies placed · 2 copies unplaced')
  })
  it('uses entered kerf and margins and clears the plan when choosing another panel', async () => {
    const { wrapper, start } = await setup()
    await wrapper.get('#optimization-kerf').setValue(4.5)
    await wrapper.get('#optimization-margin').setValue(10)
    const worker = await start()
    expect(worker.request.input.settings).toEqual({ kerfMm: 4.5, edgeMarginMm: 10 })
    worker.complete(); await flushPromises()
    expect(wrapper.text()).toContain('Kerf 4.5 mm · Edge margin 10 mm')
    await wrapper.get('select').setValue('')
    expect(wrapper.text()).not.toContain('Validated single-panel plan')
  })
  it('disables unavailable and broken catalog panels without repairing records', async () => {
    const { wrapper, catalog, persistence, product, workers } = await setup()
    await catalog.supplierProducts.update(product.id, { ...product, availability: 'unavailable' })
    await wrapper.get('button').trigger('click')
    await vi.waitFor(() => { expect(wrapper.get(`option[value="${product.id}"]`).text()).toContain('Unavailable') })
    expect(wrapper.get(`option[value="${product.id}"]`).attributes('disabled')).toBeDefined()
    await persistence.suppliers.delete(product.supplierId)
    await wrapper.get('button').trigger('click')
    await vi.waitFor(() => { expect(wrapper.get(`option[value="${product.id}"]`).text()).toContain('Missing catalog reference') })
    expect(wrapper.get(`option[value="${product.id}"]`).attributes('disabled')).toBeDefined()
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
