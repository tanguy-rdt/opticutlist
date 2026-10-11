import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { partSchema } from '../../../domain/model/part'
import { validPartInput } from '../../../domain/model/__tests__/fixtures'
import PartDiagram from '../PartDiagram.vue'
import { fitPartPreview } from '../part-preview'

describe('part proportions', () => {
  it('fits length horizontally and width vertically using one uniform scale', () => {
    expect(fitPartPreview(400, 200)).toEqual({ x: 40, y: 50, width: 220, height: 110 })
    expect(fitPartPreview(100, 400)).toEqual({ x: 133.75, y: 40, width: 32.5, height: 130 })
  })
  it('preserves extreme aspect ratios rather than enlarging the narrow axis', () => {
    const rect = fitPartPreview(10000, 1)
    expect(rect.width).toBe(220)
    expect(rect.height).toBeCloseTo(0.022)
    expect(rect.x).toBe(40)
  })
  it.each([0, -1, NaN, Infinity, 0.0001, Number.MAX_VALUE])('rejects unsupported dimensions %s', value => {
    expect(() => fitPartPreview(value, 100)).toThrow(RangeError)
    expect(() => fitPartPreview(100, value)).toThrow(RangeError)
  })
  it.each(['none', 'length', 'width'] as const)('labels dimensions and grain %s without mutating the part', grainDirection => {
    const part = partSchema.parse({ ...validPartInput, grainDirection })
    const before = structuredClone(part)
    const wrapper = mount(PartDiagram, { props: { part } })
    expect(wrapper.get('svg').attributes('viewBox')).toBe('0 0 300 210')
    expect(wrapper.text()).toContain('720 mm')
    expect(wrapper.text()).toContain('560 mm')
    expect(wrapper.text()).toContain('not a cutting layout')
    expect(wrapper.find('[data-grain]').exists()).toBe(grainDirection !== 'none')
    if (grainDirection !== 'none') expect(wrapper.get('[data-grain]').attributes('data-grain')).toBe(grainDirection)
    expect(part).toEqual(before)
    wrapper.unmount()
  })
  it('handles sub-resolution records explicitly without changing their dimensions', () => {
    const part = partSchema.parse({ ...validPartInput, lengthMm: 0.0001 })
    const wrapper = mount(PartDiagram, { props: { part } })
    expect(wrapper.find('svg').exists()).toBe(false)
    expect(wrapper.text()).toContain('Preview unavailable')
    expect(part.lengthMm).toBe(0.0001)
    wrapper.unmount()
  })
})
