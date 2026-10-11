import { builtInMaterialPresets } from '../../application/catalog/material-presets'
export { materialPresetGroups } from '../../application/catalog/material-presets'

export const materialPresets = builtInMaterialPresets.map(preset => ({
  id: preset.id, name: preset.name, category: preset.category,
  thumbnail: `${import.meta.env.BASE_URL}materials/${preset.texture}`,
  preview: `${import.meta.env.BASE_URL}materials/${preset.preview}`,
}))
export type MaterialPreset = typeof materialPresets[number]
export function materialThumbnail(presetId: string | undefined): string | undefined {
  return materialPresets.find(preset => preset.id === presetId)?.thumbnail
}
export function materialPreview(presetId: string | undefined): string | undefined {
  return materialPresets.find(preset => preset.id === presetId)?.preview
}
