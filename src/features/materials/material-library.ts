import { builtInMaterialPresets } from '../../application/catalog/material-presets'
export { materialPresetGroups } from '../../application/catalog/material-presets'

const textures = import.meta.glob<string>('../../../opticutlist-material-library/textures/*.webp', { eager: true, query: '?url', import: 'default' })
export const materialPresets = builtInMaterialPresets.map(preset => {
  const thumbnail = textures[`../../../opticutlist-material-library/${preset.texture}`]
  if (!thumbnail) throw new Error(`Missing material thumbnail: ${preset.id}`)
  return { id: preset.id, name: preset.name, category: preset.category, thumbnail }
})
export type MaterialPreset = typeof materialPresets[number]
export function materialThumbnail(presetId: string | undefined): string | undefined {
  return materialPresets.find(preset => preset.id === presetId)?.thumbnail
}
