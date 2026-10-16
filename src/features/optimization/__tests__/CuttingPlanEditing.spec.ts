import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CuttingPlanViewer from '../CuttingPlanViewer.vue'
import { dimensionAnnotations } from '../viewer/dimensions'
import { createPlanCanvas } from '../viewer/plan-canvas'
import type { CuttingSettings } from '../../../domain/model/cutting-settings'
import type { Part } from '../../../domain/model/part'
import type { SupplierProduct } from '../../../domain/model/supplier-product'
import type { PanelCuttingPlan } from '../../../domain/optimizer/plan-with-strategy'
import { rotationInput, rotationPlan, swapInput, swapPlan } from '../../../domain/cutting-tree/__tests__/editing-fixtures'
import { freezeDeep } from '../../../domain/cutting-tree/__tests__/viewer-fixtures'

vi.mock('../viewer/plan-canvas', () => ({ createPlanCanvas: vi.fn(() => ({ setViewport: vi.fn(), setSelection: vi.fn(), setPalette: vi.fn(), resize: vi.fn(), destroy: vi.fn() })) }))
const wrappers: VueWrapper[] = []
beforeEach(() => { vi.mocked(createPlanCanvas).mockClear() })
afterEach(() => { wrappers.forEach(wrapper => { wrapper.unmount() }); wrappers.length = 0 })
function setup(plan: PanelCuttingPlan = rotationPlan, input: { panel: SupplierProduct; parts: readonly Part[]; settings: CuttingSettings } = rotationInput) {
  const wrapper = mount(CuttingPlanViewer, { props: { plan, ...input }, attachTo: document.body })
  wrappers.push(wrapper)
  return wrapper
}
function button(wrapper: VueWrapper, label: string) {
  const control = wrapper.findAll('button').find(button => button.text() === label)
  if (control === undefined) throw new Error(`Missing ${label}`)
  return control
}
async function selectFirst(wrapper: VueWrapper): Promise<void> {
  const first = vi.mocked(createPlanCanvas).mock.calls.at(-1)?.[1].parts[0]
  if (!first) throw new Error('Missing placed copy')
  await wrapper.setProps({ selectedCopyKey: first.key })
}
describe('Always available constrained editing', () => {
  it('offers only constrained edits immediately without a mode toggle or resize controls', () => {
    const wrapper = setup()
    expect(wrapper.text()).not.toContain('View Mode')
    expect(wrapper.find('[aria-label="Constrained plan editing"]').exists()).toBe(true)
    expect(button(wrapper, 'Rotate selected copy 90°').attributes('disabled')).toBeDefined()
    expect(wrapper.get('#edit-rotation-reason').text()).toContain('Select a placed copy')
    expect(button(wrapper, 'Undo edit').attributes('disabled')).toBeDefined()
    expect(button(wrapper, 'Redo edit').attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('button').some(control => control.text().includes('Edit Mode'))).toBe(false)
    expect(wrapper.find('input[type=number]').exists()).toBe(false)
  })
  it('rotates a rectangle safely while retaining selection, zoom, pan and the original plan', async () => {
    const plan = structuredClone(rotationPlan)
    const original = structuredClone(plan)
    freezeDeep(plan)
    const wrapper = setup(plan)
    await selectFirst(wrapper)
    await button(wrapper, 'Zoom in').trigger('click')
    await wrapper.get('[aria-label="Cutting plan canvas"]').trigger('keydown', { key: 'ArrowRight' })
    expect(button(wrapper, 'Rotate selected copy 90°').attributes('disabled')).toBeUndefined()
    await button(wrapper, 'Rotate selected copy 90°').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Rotation accepted and independently validated')
    expect(wrapper.get('[aria-label="Selected part information"] dl').text()).toContain('Normal')
    expect(wrapper.get('[aria-label="Selected part information"] dl').text()).toContain('50 × 30 × 18 mm')
    expect(wrapper.get('output').text()).toBe('125% of fit')
    expect(wrapper.find('[aria-label="Selected part information"]').exists()).toBe(true)
    const rendered = vi.mocked(createPlanCanvas).mock.calls.at(-1)
    expect(rendered?.[1].parts[0]?.region).toEqual({ xMm: 5, yMm: 5, lengthMm: 50, widthMm: 30 })
    expect(plan).toEqual(original)
    expect(wrapper.emitted('plan-change')?.[0]?.[1]).toBe(true)
    expect(wrapper.find('[aria-label="Constrained plan editing"]').exists()).toBe(true)
    expect(wrapper.emitted('plan-change')?.at(-1)?.[1]).toBe(true)
  })
  it('reprojects selected dimensions after rotation, undo and redo without altering the baseline', async () => {
    const wrapper = setup()
    await selectFirst(wrapper)
    await wrapper.get('[aria-label="Show dimensions"]').trigger('click')
    const key = vi.mocked(createPlanCanvas).mock.calls.at(-1)?.[1].parts[0]?.key ?? ''
    function labels() {
      const scene = vi.mocked(createPlanCanvas).mock.calls.at(-1)?.[1]
      if (!scene) throw new Error('Missing scene')
      return dimensionAnnotations(scene, { x: 100, y: 90, scale: 2 }, key, true).filter(item => item.id.startsWith('part-')).map(item => item.label)
    }
    expect(labels()).toEqual(['30 mm', '50 mm'])
    await button(wrapper, 'Rotate selected copy 90°').trigger('click')
    await flushPromises()
    expect(labels()).toEqual(['50 mm', '30 mm'])
    expect(wrapper.get('[aria-label="Hide dimensions"]').attributes('aria-pressed')).toBe('true')
    await button(wrapper, 'Undo edit').trigger('click')
    await flushPromises()
    expect(labels()).toEqual(['30 mm', '50 mm'])
    await button(wrapper, 'Redo edit').trigger('click')
    await flushPromises()
    expect(labels()).toEqual(['50 mm', '30 mm'])
  })
  it('supports exact undo/redo and explicit reset without undoing viewport controls', async () => {
    const wrapper = setup()
    await selectFirst(wrapper)
    await button(wrapper, 'Rotate selected copy 90°').trigger('click')
    await button(wrapper, 'Undo edit').trigger('click')
    expect(wrapper.get('[aria-label="Selected part information"] dl').text()).toContain('Rotated 90°')
    expect(wrapper.emitted('plan-change')?.at(-1)?.[1]).toBe(false)
    await button(wrapper, 'Redo edit').trigger('click')
    expect(wrapper.get('[aria-label="Selected part information"] dl').text()).toContain('Normal')
    await button(wrapper, 'Reset to Optimized Plan').trigger('click')
    expect(wrapper.get('[aria-label="Selected part information"] dl').text()).toContain('Rotated 90°')
    expect(wrapper.text()).toContain('Optimized plan restored. Edit history cleared')
    expect(button(wrapper, 'Undo edit').attributes('disabled')).toBeDefined()
    expect(button(wrapper, 'Redo edit').attributes('disabled')).toBeDefined()
    expect(wrapper.emitted('plan-change')?.at(-1)?.[0]).toEqual(rotationPlan)
  })
  it('swaps placed copies in exact leaf regions with permitted orientation changes', async () => {
    const original = structuredClone(swapPlan)
    const wrapper = mount(CuttingPlanViewer, { props: { plan: swapPlan, ...swapInput } })
    wrappers.push(wrapper)
    await selectFirst(wrapper)
    expect(wrapper.find('#cutting-viewer-swap').exists()).toBe(false)
    await button(wrapper, 'Choose swap target').trigger('click')
    await wrapper.get('#cutting-viewer-swap').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('#cutting-viewer-swap').exists()).toBe(false)
    await button(wrapper, 'Choose swap target').trigger('click')
    await wrapper.get('#cutting-viewer-swap').setValue(wrapper.get('#cutting-viewer-swap option:nth-child(2)').attributes('value'))
    expect(button(wrapper, 'Swap selected copies').attributes('disabled')).toBeUndefined()
    await button(wrapper, 'Swap selected copies').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Swap accepted and independently validated')
    expect(wrapper.find('#cutting-viewer-swap').exists()).toBe(false)
    expect(wrapper.get('[aria-label="Selected part information"] dl').text()).toContain('First piece')
    expect(wrapper.get('[aria-label="Selected part information"] dl').text()).toContain('35, 5 mm')
    const scene = vi.mocked(createPlanCanvas).mock.calls.at(-1)?.[1]
    expect(scene?.parts.map(part => part.part.name)).toEqual(['Second piece', 'First piece'])
    if (!scene) throw new Error('Missing swapped scene')
    const moved = scene.parts.find(part => part.part.name === 'First piece')
    expect(dimensionAnnotations(scene, { x: 0, y: 0, scale: 1 }, moved?.key ?? '', true).find(item => item.id === 'position-x')?.label).toBe('X 35 mm')
    expect(swapPlan).toEqual(original)
  })
  it('explains grain and region rejection while leaving the current plan and history intact', async () => {
    const wrapper = setup(rotationPlan, { ...rotationInput, panel: { ...rotationInput.panel, grainDirection: 'width' } })
    await selectFirst(wrapper)
    expect(wrapper.get('#edit-rotation-reason').text()).toContain('grain would not match')
    expect(button(wrapper, 'Rotate selected copy 90°').attributes('disabled')).toBeDefined()
    await button(wrapper, 'Rotate selected copy 90°').trigger('click')
    expect(wrapper.emitted('plan-change')).toBeUndefined()
    expect(button(wrapper, 'Undo edit').attributes('disabled')).toBeDefined()
    const incompatible = mount(CuttingPlanViewer, { props: { plan: swapPlan, ...swapInput, parts: swapInput.parts.map(part => ({ ...part, rotation: 'forbidden' as const })) } })
    wrappers.push(incompatible)
    await selectFirst(incompatible)
    expect(button(incompatible, 'Choose swap target').attributes('disabled')).toBeDefined()
    expect(incompatible.find('#cutting-viewer-swap').exists()).toBe(false)
    expect(button(incompatible, 'Choose swap target').attributes('title')).toContain('No compatible')
    expect(incompatible.emitted('plan-change')).toBeUndefined()
  })
  it('clears editing state and history when new optimizer inputs arrive', async () => {
    const wrapper = setup()
    await selectFirst(wrapper)
    await button(wrapper, 'Rotate selected copy 90°').trigger('click')
    await wrapper.setProps({ plan: structuredClone(rotationPlan) })
    expect(wrapper.text()).not.toContain('View Mode')
    expect(button(wrapper, 'Undo edit').attributes('disabled')).toBeDefined()
    expect(button(wrapper, 'Redo edit').attributes('disabled')).toBeDefined()
  })
  it('continues rendering only independently valid edit outcomes', async () => {
    const wrapper = setup()
    await selectFirst(wrapper)
    await button(wrapper, 'Rotate selected copy 90°').trigger('click')
    const scene = vi.mocked(createPlanCanvas).mock.calls.at(-1)?.[1]
    expect(scene?.parts).toHaveLength(1)
    await wrapper.setProps({ settings: { kerfMm: 40, edgeMarginMm: 5 } })
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  })
})
