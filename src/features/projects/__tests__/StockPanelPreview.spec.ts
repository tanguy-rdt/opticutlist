import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import type { createPlanCanvas, PlanCanvas } from '@/ui/canvas/plan-canvas'
import { pdfRequest } from '../../../application/export/__tests__/pdf-fixtures'
import StockPanelPreview from '@/ui/components/projects/StockPanelPreview.vue'

const mock = vi.hoisted(() => ({ create: vi.fn<typeof createPlanCanvas>(), api: { setViewport: vi.fn<PlanCanvas['setViewport']>(), setSelection: vi.fn(), setKeptWaste: vi.fn(), setWasteInspection: vi.fn(), setPalette: vi.fn(), resize: vi.fn(), destroy: vi.fn() } }))
vi.mock('@/ui/canvas/plan-canvas', () => ({ createPlanCanvas: mock.create }))
const wrappers: VueWrapper[] = []
let resized = () => {}
const disconnect = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  mock.create.mockReturnValue(mock.api)
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback }
    observe() {}
    disconnect = disconnect
  })
})
afterEach(() => { wrappers.forEach(wrapper => { wrapper.unmount() }); wrappers.length = 0; vi.unstubAllGlobals() })
function setup() {
  const wrapper = mount(StockPanelPreview, { props: { plan: pdfRequest.plan, panel: pdfRequest.panel, parts: pdfRequest.parts, settings: pdfRequest.settings, kept: [], label: 'Panel 1 — Workshop panel', panelKey: 'allocation-0', offcuts: [{ index: 0, label: 'Offcut 1' }, { index: 1, label: 'Offcut 2' }], selectedWaste: null, hoveredWaste: null } })
  wrappers.push(wrapper)
  return wrapper
}
describe('Project Stock technical preview', () => {
  it('automatically fits and centers the panel without manual viewport controls', () => {
    const wrapper = setup()
    expect(wrapper.get('.stock-preview-toolbar').text()).toContain('Panel 1 — Workshop panel')
    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Fit to view')
    expect(mock.api.setViewport.mock.calls[0]?.[0].x).toBeCloseTo(75)
    expect(mock.api.setViewport.mock.calls[0]?.[0]).toMatchObject({ scale: 4.9, y: 24 })
    expect(mock.api.resize).toHaveBeenCalledWith({ width: 640, height: 440 })
  })
  it('refits distinct allocated panels even when all geometry is identical', async () => {
    const wrapper = setup()
    mock.api.setViewport.mockClear()
    await wrapper.setProps({ panelKey: 'allocation-1', label: 'Panel 2 — Workshop panel' })
    expect(mock.create).toHaveBeenCalledTimes(2)
    expect(mock.api.destroy).toHaveBeenCalledOnce()
    expect(mock.api.setViewport).toHaveBeenCalledOnce()
    expect(mock.api.setViewport.mock.calls[0]?.[0].x).toBeCloseTo(75)
    expect(mock.api.setViewport.mock.calls[0]?.[0]).toMatchObject({ scale: 4.9, y: 24 })
  })
  it('passes exact waste identities and updates inspection and kept styling without recreating or refitting', async () => {
    const wrapper = setup()
    const callbacks = mock.create.mock.calls[0]?.[6]
    expect(callbacks?.indices).toEqual([0, 1])
    expect([...callbacks?.labels ?? []]).toEqual([[0, 'Offcut 1'], [1, 'Offcut 2']])
    callbacks?.onHover(1); callbacks?.onSelect(0); callbacks?.onHover(null)
    expect(wrapper.emitted('hoverWaste')).toEqual([[1], [null]])
    expect(wrapper.emitted('selectWaste')).toEqual([[0]])
    mock.api.setViewport.mockClear()
    await wrapper.setProps({ selectedWaste: 0, hoveredWaste: 1, kept: [1] })
    expect(mock.api.setWasteInspection).toHaveBeenLastCalledWith(0, 1)
    expect(mock.api.setKeptWaste).toHaveBeenLastCalledWith([1])
    expect(mock.create).toHaveBeenCalledOnce()
    expect(mock.api.setViewport).not.toHaveBeenCalled()
  })
  it('fits real resized viewport bounds and cleans up its canvas and observer', () => {
    const wrapper = setup()
    const host = wrapper.get('[role="img"]').element
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 800 })
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 300 })
    resized()
    expect(mock.api.setViewport).toHaveBeenLastCalledWith({ scale: 3.15, x: 242.5, y: 24 })
    expect(mock.api.resize).toHaveBeenLastCalledWith({ width: 800, height: 300 })
    expect(mock.api.setViewport).toHaveBeenLastCalledWith({ scale: 3.15, x: 242.5, y: 24 })
    wrapper.unmount()
    expect(mock.api.destroy).toHaveBeenCalledOnce()
    expect(disconnect).toHaveBeenCalledOnce()
  })
})
