import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CuttingPlanViewer from '../CuttingPlanViewer.vue'
import { createPlanCanvas, type PlanCanvas } from '../viewer/plan-canvas'
import { freezeDeep, viewerPanel, viewerPart, viewerPlan, viewerSettings } from '../../../domain/cutting-tree/__tests__/viewer-fixtures'

vi.mock('../viewer/plan-canvas', () => ({ createPlanCanvas: vi.fn() }))
const wrappers: VueWrapper[] = []
function fakeCanvas() {
  return { setViewport: vi.fn(), setSelection: vi.fn(), setPalette: vi.fn(), resize: vi.fn(), destroy: vi.fn() } satisfies PlanCanvas
}
let canvas = fakeCanvas()
beforeEach(() => { vi.mocked(createPlanCanvas).mockReset(); canvas = fakeCanvas(); vi.mocked(createPlanCanvas).mockReturnValue(canvas) })
afterEach(() => { wrappers.forEach(wrapper => { wrapper.unmount() }); wrappers.length = 0; vi.unstubAllGlobals() })
function setup(plan = viewerPlan) {
  const props = { plan, panel: viewerPanel, parts: [viewerPart], settings: viewerSettings }
  const wrapper = mount(CuttingPlanViewer, { props, attachTo: document.body })
  wrappers.push(wrapper)
  return wrapper
}
function button(wrapper: VueWrapper, label: string) {
  const control = wrapper.findAll('button').find(item => item.text() === label)
  if (control === undefined) throw new Error(`Missing ${label}`)
  return control
}
describe('Cutting layout workspace', () => {
  it('synchronizes external sidebar selection with the canvas and reports canvas selection', async () => {
    const wrapper = setup()
    const call = vi.mocked(createPlanCanvas).mock.calls[0]
    const part = call?.[1].parts[0]
    if (!call || !part) throw new Error('Missing rendered part')
    await wrapper.setProps({ selectedCopyKey: part.key })
    expect(canvas.setSelection).toHaveBeenLastCalledWith(part.key)
    expect(wrapper.get('[aria-label="Selected part information"] dl').text()).toContain('Shelf / 1')
    call[4]('')
    await flushPromises()
    expect(wrapper.emitted('select-copy')?.at(-1)).toEqual([''])
    expect(wrapper.find('[aria-label="Selected part information"] dl').exists()).toBe(false)
  })
  it('keeps compact tools above a full-width solid-color canvas without material images', async () => {
    const wrapper = setup()
    await flushPromises()
    expect(vi.mocked(createPlanCanvas).mock.calls.at(-1)).toHaveLength(6)
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.get('.canvas-toolbar').find('[aria-label="Constrained plan editing"]').exists()).toBe(true)
    expect(wrapper.find('aside').exists()).toBe(false)
    expect(wrapper.find('#cutting-viewer-part').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Cutting layout · Select a placed part')
    expect(wrapper.find('.graph-paper').exists()).toBe(true)
    expect(wrapper.findAll('button').some(control => control.text().includes('Edit Mode'))).toBe(false)
    expect(wrapper.get('.canvas-toolbar').element.compareDocumentPosition(wrapper.get('figure').element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
  it('uses solid cutting tokens and updates them on theme changes without recreating the stage', async () => {
    const style = document.createElement('div').style
    const tokens = ['cutting-panel', 'cutting-part', 'cutting-waste', 'cutting-ink', 'cutting-line', 'cutting-kerf', 'cutting-selection']
    for (const token of tokens) style.setProperty(`--${token}`, `light-${token}`)
    const computedStyle = vi.spyOn(window, 'getComputedStyle').mockReturnValue(style)
    try {
      const wrapper = setup()
      expect(vi.mocked(createPlanCanvas).mock.calls[0]?.[3]).toEqual({ surface: 'light-cutting-panel', part: 'light-cutting-part', margin: 'light-cutting-waste', ink: 'light-cutting-ink', muted: 'light-cutting-line', partBorder: 'light-cutting-line', selected: 'light-cutting-selection', kerf: 'light-cutting-kerf' })
      for (const token of tokens) style.setProperty(`--${token}`, `dark-${token}`)
      document.documentElement.dataset.theme = 'dark'
      await flushPromises()
      expect(canvas.setPalette).toHaveBeenCalledWith(expect.objectContaining({ surface: 'dark-cutting-panel', part: 'dark-cutting-part', ink: 'dark-cutting-ink', kerf: 'dark-cutting-kerf' }))
      expect(createPlanCanvas).toHaveBeenCalledOnce()
      wrapper.unmount()
    } finally {
      computedStyle.mockRestore()
      document.documentElement.removeAttribute('data-theme')
    }
  })
  it('creates a validated scene and a readable summary alongside the canvas', async () => {
    const wrapper = setup()
    await flushPromises()
    expect(createPlanCanvas).toHaveBeenCalledOnce()
    expect(wrapper.get('[aria-label="Layout legend"]').text()).toContain('Shaded strips: saw kerf')
    expect(wrapper.get('[aria-label="Layout legend"]').text()).toContain('Arrows: grain')
    expect(wrapper.get('[role="region"]').attributes('tabindex')).toBe('0')
    expect(wrapper.get('output').text()).toBe('100% of fit')
  })
  it('selects a copy from the canvas and shows original and rotated dimensions and grain', async () => {
    const wrapper = setup()
    const call = vi.mocked(createPlanCanvas).mock.calls[0]
    if (call === undefined) throw new Error('Missing renderer')
    const selected = call[1].parts[0]
    if (selected === undefined) throw new Error('Missing part')
    call[4](selected.key)
    await flushPromises()
    expect(wrapper.get('[aria-label="Selected part information"] dl').text()).toContain('Shelf / 1')
    expect(wrapper.get('[aria-label="Selected part information"] dl').text()).toContain('50 × 30 × 18 mm')
    expect(wrapper.get('[aria-label="Selected part information"] dl').text()).toContain('30 × 50 × 18 mm')
    expect(wrapper.get('[aria-label="Selected part information"] dl').text()).toContain('Rotated 90°')
    expect(wrapper.get('[aria-label="Selected part information"] dl').text()).toContain('width')
    expect(canvas.setSelection).toHaveBeenCalledWith(selected.key)
  })
  it('preserves sidebar selection, keyboard zoom, pan, fit and reset without changing plans', async () => {
    const plan = structuredClone(viewerPlan)
    const original = structuredClone(plan)
    freezeDeep(plan)
    const wrapper = setup(plan)
    const key = JSON.stringify([viewerPart.id, 0])
    await wrapper.setProps({ selectedCopyKey: key })
    expect(wrapper.find('[aria-label="Selected part information"] dl').exists()).toBe(true)
    await button(wrapper, 'Zoom in').trigger('click')
    expect(wrapper.get('output').text()).toBe('125% of fit')
    await button(wrapper, 'Zoom out').trigger('click')
    expect(wrapper.get('output').text()).toBe('100% of fit')
    await wrapper.get('[role="region"]').trigger('keydown', { key: 'ArrowRight' })
    await wrapper.get('[role="region"]').trigger('keydown', { key: '+' })
    expect(wrapper.get('output').text()).toBe('125% of fit')
    await button(wrapper, 'Fit to view').trigger('click')
    expect(wrapper.get('output').text()).toBe('100% of fit')
    expect(wrapper.find('[aria-label="Selected part information"] dl').exists()).toBe(true)
    await button(wrapper, 'Reset view').trigger('click')
    expect(wrapper.find('[aria-label="Selected part information"] dl').exists()).toBe(false)
    expect(plan).toEqual(original)
  })
  it('tracks drag panning and permits keyboard reset without re-creating a stage', async () => {
    const wrapper = setup()
    const call = vi.mocked(createPlanCanvas).mock.calls[0]
    if (call === undefined) throw new Error('Missing renderer')
    call[5]({ scale: 2, x: 100, y: 50 })
    await wrapper.get('[role="region"]').trigger('keydown', { key: '0' })
    expect(wrapper.get('output').text()).toBe('100% of fit')
    expect(createPlanCanvas).toHaveBeenCalledOnce()
  })
  it('does not render invalid or unavailable plans and destroys a previous stage on invalidation', async () => {
    const wrapper = setup()
    const invalid = { ...viewerPlan, tree: { ...viewerPlan.tree, region: { xMm: 6, yMm: 5, lengthMm: 90, widthMm: 70 } } }
    await wrapper.setProps({ plan: invalid })
    expect(wrapper.get('[role="alert"]').text()).toContain('Independent validation failed')
    expect(canvas.destroy).toHaveBeenCalledOnce()
    expect(createPlanCanvas).toHaveBeenCalledOnce()
    await wrapper.setProps({ plan: null })
    expect(wrapper.text()).toContain('No cutting plan to display')
    expect(wrapper.find('[role="region"]').exists()).toBe(false)
    expect(wrapper.findAll('button').every(item => item.attributes('disabled') !== undefined)).toBe(true)
  })
  it('handles waste-only plans and graphics unavailable without hiding textual inspection', async () => {
    const waste = { ...viewerPlan, tree: { kind: 'waste' as const, region: { xMm: 5, yMm: 5, lengthMm: 90, widthMm: 70 } } }
    const wrapper = setup(waste)
    expect(wrapper.text()).toContain('No parts were placed')
    expect(wrapper.find('select').exists()).toBe(false)
    vi.mocked(createPlanCanvas).mockImplementationOnce(() => { throw new Error('Canvas unavailable') })
    const failed = setup()
    await flushPromises()
    expect(failed.text()).toContain('The graphical viewer is unavailable')
    expect(failed.find('select').exists()).toBe(false)
  })
  it('destroys a partially initialized canvas if viewport setup fails', async () => {
    canvas.setViewport.mockImplementationOnce(() => { throw new Error('Canvas failed') })
    const wrapper = setup()
    await flushPromises()
    expect(canvas.destroy).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('The graphical viewer is unavailable')
    expect(wrapper.get('[aria-label="Cutting layout view controls"]').findAll('button').every(item => item.attributes('disabled') !== undefined)).toBe(true)
  })
  it('updates theme colors without rebuilding and disconnects observers and media listeners on unmount', async () => {
    const disconnect = vi.fn()
    const observe = vi.fn()
    class TestResizeObserver { observe = observe; disconnect = disconnect }
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    const remove = vi.fn()
    const add = vi.fn()
    vi.stubGlobal('matchMedia', () => ({ addEventListener: add, removeEventListener: remove }))
    const wrapper = setup()
    document.documentElement.dataset.theme = 'dark'
    await flushPromises()
    expect(canvas.setPalette).toHaveBeenCalled()
    expect(createPlanCanvas).toHaveBeenCalledOnce()
    wrapper.unmount()
    expect(canvas.destroy).toHaveBeenCalledOnce()
    expect(disconnect).toHaveBeenCalled()
    expect(remove).toHaveBeenCalledWith('change', expect.any(Function))
    document.documentElement.removeAttribute('data-theme')
  })
})
