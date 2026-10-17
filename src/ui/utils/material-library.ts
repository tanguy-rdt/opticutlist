import { builtInMaterialPresets } from '@/application/catalog/material-presets'
export { materialPresetGroups } from '@/application/catalog/material-presets'

// The retained preview assets are compact perspective material samples.
export const materialPresets = builtInMaterialPresets.map(preset => ({
  id: preset.id, name: preset.name, category: preset.category,
  thumbnail: `${import.meta.env.BASE_URL}materials/${preset.preview}`,
}))
export type MaterialPreset = typeof materialPresets[number]

export function materialThumbnail(presetId: string | undefined): string | undefined {
  return materialPresets.find(preset => preset.id === presetId)?.thumbnail
}
