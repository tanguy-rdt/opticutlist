import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MaterialThumbnail from '../MaterialThumbnail.vue'
import { materialPresets, materialPresetGroups, materialThumbnail } from '../material-library'

describe('supplied local material library', () => {
  it('uses exactly the supplied twenty distinct presets in four groups with local thumbnails', () => {
    expect(materialPresets).toHaveLength(20)
    expect(new Set(materialPresets.map(preset => preset.id)).size).toBe(20)
    expect(materialPresetGroups).toHaveLength(4)
    for (const preset of materialPresets) {
      expect(preset.thumbnail).toBeTruthy()
      expect(preset.thumbnail).not.toMatch(/^https?:/)
      expect(materialThumbnail(preset.id)).toBe(preset.thumbnail)
    }
  })
  it.each([undefined, 'unknown-future-preset'])('uses a neutral fallback for %s without guessing from a name', presetId => {
    const wrapper = mount(MaterialThumbnail, { props: { presetId } })
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('svg').exists()).toBe(true)
    wrapper.unmount()
  })
  it('falls back on image failure and resets when the preset changes', async () => {
    const wrapper = mount(MaterialThumbnail, { props: { presetId: 'pin' } })
    await wrapper.get('img').trigger('error'); expect(wrapper.find('img').exists()).toBe(false)
    await wrapper.setProps({ presetId: 'sapin' }); expect(wrapper.find('img').exists()).toBe(true)
    wrapper.unmount()
  })
})
