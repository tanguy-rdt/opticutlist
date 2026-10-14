import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PanelDimensionPreview from '../PanelDimensionPreview.vue'

const props = { lengthMm: 800, widthMm: 400.5 }
describe('shared technical dimension preview', () => {
  it('renders both dimensions, four arrowheads and edge-aligned extensions', () => {
    const before = structuredClone(props)
    const wrapper = mount(PanelDimensionPreview, { props })
    expect(wrapper.findAll('text').map(label => label.text())).toEqual(['800 mm', '400.5 mm'])
    expect(wrapper.findAll('[data-dimension-axis]')).toHaveLength(2)
    expect(wrapper.findAll('[data-dimension-arrow="length"]')).toHaveLength(2)
    expect(wrapper.findAll('[data-dimension-arrow="width"]')).toHaveLength(2)
    expect(wrapper.findAll('[data-dimension-extension]')).toHaveLength(4)
    expect(wrapper.get('svg').attributes('aria-label')).toContain('800 × 400.5 mm')
    expect(wrapper.findAll('text')[1]?.attributes('transform')).toContain('rotate(-90)')
    expect(props).toEqual(before)
    wrapper.unmount()
  })
  it.each(['none', 'length', 'width'] as const)('renders grain %s only when specified', grainDirection => {
    const wrapper = mount(PanelDimensionPreview, { props: { ...props, grainDirection } })
    expect(wrapper.find('[data-grain]').exists()).toBe(grainDirection !== 'none')
    if (grainDirection !== 'none') expect(wrapper.get('[data-grain]').attributes('data-grain')).toBe(grainDirection)
    wrapper.unmount()
  })
  it('clips the supplied flat texture without stretching it', () => {
    const wrapper = mount(PanelDimensionPreview, { props: { ...props, textureUrl: '/materials/textures/pin.webp' } })
    expect(wrapper.get('image').attributes('href')).toBe('/materials/textures/pin.webp')
    expect(wrapper.get('image').attributes('preserveAspectRatio')).toBe('xMidYMid slice')
    expect(wrapper.get('image').attributes('clip-path')).toContain(wrapper.get('clipPath').attributes('id'))
    const outline = wrapper.get('[data-panel-outline]')
    expect(Number(outline.attributes('width')) / Number(outline.attributes('height'))).toBeCloseTo(800 / 400.5)
    wrapper.unmount()
  })
  it('uses a neutral proportional fallback without a texture', () => {
    const wrapper = mount(PanelDimensionPreview, { props })
    expect(wrapper.find('image').exists()).toBe(false)
    expect(wrapper.get('[data-panel-outline]').attributes('fill')).toBe('currentColor')
    wrapper.unmount()
  })
  it('handles load failure, new selections and stale former image errors', async () => {
    const wrapper = mount(PanelDimensionPreview, { props: { ...props, textureUrl: '/old.webp' } })
    const previous = wrapper.get('image')
    await previous.trigger('error')
    expect(wrapper.find('image').exists()).toBe(false)
    await wrapper.setProps({ textureUrl: '/new.webp', lengthMm: 100, widthMm: 600 })
    await previous.trigger('error')
    expect(wrapper.get('image').attributes('href')).toBe('/new.webp')
    expect(wrapper.get('svg').attributes('aria-label')).toContain('100 × 600 mm')
    wrapper.unmount()
  })
  it.each(['light', 'dark'])('uses semantic colors in the %s theme and supports compact sizing', theme => {
    document.documentElement.dataset.theme = theme
    const wrapper = mount(PanelDimensionPreview, { props: { ...props, size: 'small' } })
    expect(wrapper.get('svg').classes()).toContain('text-muted')
    expect(wrapper.findAll('text').every(label => label.classes().includes('text-ink'))).toBe(true)
    expect(wrapper.get('svg').attributes('viewBox')).toBe('0 0 280 200')
    wrapper.unmount()
    delete document.documentElement.dataset.theme
  })
  it.each([0.0001, Number.MAX_VALUE])('reports an unsupported range without altering dimension %s', lengthMm => {
    const wrapper = mount(PanelDimensionPreview, { props: { ...props, lengthMm } })
    expect(wrapper.find('svg').exists()).toBe(false)
    expect(wrapper.text()).toContain('Preview unavailable')
    expect(wrapper.props('lengthMm')).toBe(lengthMm)
    wrapper.unmount()
  })
})
