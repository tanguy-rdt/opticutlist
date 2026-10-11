import { readFileSync } from 'node:fs'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MaterialThumbnail from '../MaterialThumbnail.vue'
import { materialPresets, materialPresetGroups, materialThumbnail, materialPreview } from '../material-library'

describe('supplied local material library', () => {
  it('uses exactly the supplied twenty distinct presets in four groups with local thumbnails', () => {
    expect(materialPresets.map(preset => preset.id)).toEqual(['chene', 'hetre', 'frene', 'erable', 'noyer', 'merisier', 'bouleau', 'peuplier', 'pin', 'sapin', 'epicea', 'cedre', 'teck', 'acajou', 'iroko', 'wenge', 'contreplaque', 'mdf', 'osb', 'agglomere'])
    expect(new Set(materialPresets.map(preset => preset.id)).size).toBe(20)
    expect(materialPresetGroups).toHaveLength(4)
    for (const preset of materialPresets) {
      expect(preset.thumbnail).toBeTruthy()
      expect(preset.thumbnail).not.toMatch(/^https?:/)
      expect(materialThumbnail(preset.id)).toBe(preset.thumbnail)
      expect(materialPreview(preset.id)).toBe(preset.preview)
      for (const [folder, width, height] of [['textures', 96, 64], ['previews', 768, 512]] as const) {
        const bytes = readFileSync(`${process.cwd()}/public/materials/${folder}/${preset.id}.webp`)
        expect(bytes.toString('ascii', 0, 4)).toBe('RIFF')
        expect(bytes.toString('ascii', 8, 16)).toBe('WEBPVP8 ')
        expect(bytes.readUInt16LE(26) & 0x3fff).toBe(width)
        expect(bytes.readUInt16LE(28) & 0x3fff).toBe(height)
        expect(folder === 'textures' ? preset.thumbnail : preset.preview).toBe(`${import.meta.env.BASE_URL}materials/${folder}/${preset.id}.webp`)
      }
    }
  })
  it('uses separate full-size previews and intrinsic dimensions, never an enlarged thumbnail', () => {
    const wrapper = mount(MaterialThumbnail, { props: { presetId: 'pin', variant: 'preview' } })
    const image = wrapper.get('img')
    expect(image.attributes('src')).toBe(materialPreview('pin'))
    expect(image.attributes('src')).not.toBe(materialThumbnail('pin'))
    expect(image.attributes('width')).toBe('768')
    expect(image.attributes('height')).toBe('512')
    wrapper.unmount()
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
