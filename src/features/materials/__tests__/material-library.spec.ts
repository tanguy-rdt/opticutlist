import { existsSync, readFileSync } from 'node:fs'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MaterialThumbnail from '../MaterialThumbnail.vue'
import { materialPresets, materialPresetGroups, materialThumbnail } from '../material-library'

describe('supplied local material library', () => {
  it('uses exactly the supplied twenty distinct presets in four groups with local thumbnails', () => {
    expect(materialPresets.map(preset => preset.id)).toEqual(['chene', 'hetre', 'frene', 'erable', 'noyer', 'merisier', 'bouleau', 'peuplier', 'pin', 'sapin', 'epicea', 'cedre', 'teck', 'acajou', 'iroko', 'wenge', 'contreplaque', 'mdf', 'osb', 'agglomere'])
    expect(new Set(materialPresets.map(preset => preset.id)).size).toBe(20)
    expect(materialPresetGroups).toHaveLength(4)
    for (const preset of materialPresets) {
      expect(preset.thumbnail).toBeTruthy()
      expect(preset.thumbnail).not.toMatch(/^https?:/)
      expect(materialThumbnail(preset.id)).toBe(preset.thumbnail)
      for (const [folder, width, height] of [['previews', 320, 280]] as const) {
        const bytes = readFileSync(`${process.cwd()}/public/materials/${folder}/${preset.id}.webp`)
        expect(bytes.toString('ascii', 0, 4)).toBe('RIFF')
        expect(bytes.toString('ascii', 8, 12)).toBe('WEBP')
        const extended = bytes.toString('ascii', 12, 16) === 'VP8X'
        expect(extended ? bytes.readUIntLE(24, 3) + 1 : bytes.readUInt16LE(26) & 0x3fff).toBe(width)
        expect(extended ? bytes.readUIntLE(27, 3) + 1 : bytes.readUInt16LE(28) & 0x3fff).toBe(height)
        expect(preset.thumbnail).toBe(`${import.meta.env.BASE_URL}materials/${folder}/${preset.id}.webp`)
      }
    }
  })
  it('contains perspective samples without cropping or distorting their intrinsic ratio', () => {
    const wrapper = mount(MaterialThumbnail, { props: { presetId: 'chene' } })
    const image = wrapper.get('img')
    expect(image.attributes('src')).toBe(materialThumbnail('chene'))
    expect(image.attributes('width')).toBe('320')
    expect(image.attributes('height')).toBe('280')
    expect(image.classes()).toContain('object-contain')
    expect(image.classes()).not.toContain('object-cover')
    wrapper.unmount()
  })
  it('does not ship unused flat textures or expose texture paths', () => {
    expect(existsSync(`${process.cwd()}/public/materials/textures`)).toBe(false)
    for (const preset of materialPresets) {
      expect(preset).not.toHaveProperty('preview')
      expect(preset).not.toHaveProperty('texture')
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
