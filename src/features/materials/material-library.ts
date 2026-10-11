import { z } from 'zod'
import { materialPresetIdSchema } from '../../domain/model/ids'
import manifest from '../../../opticutlist-material-library/materials.json'

const categories = { feuillus: 'Hardwoods', resineux: 'Softwoods', exotiques: 'Exotic woods', derives: 'Engineered wood panels' } as const
const manifestSchema = z.strictObject({
  version: z.literal(1),
  materials: z.array(z.strictObject({
    id: materialPresetIdSchema,
    name: z.string().min(1),
    category: z.enum(['feuillus', 'resineux', 'exotiques', 'derives']),
    texture: z.string().regex(/^textures\/[a-z]+\.webp$/),
  })),
})
const textures = import.meta.glob<string>('../../../opticutlist-material-library/textures/*.webp', { eager: true, query: '?url', import: 'default' })
export const materialPresets = manifestSchema.parse(manifest).materials.map(preset => {
  const thumbnail = textures[`../../../opticutlist-material-library/${preset.texture}`]
  if (!thumbnail) throw new Error(`Missing material thumbnail: ${preset.id}`)
  return { id: preset.id, name: preset.name, category: categories[preset.category], thumbnail }
})
if (new Set(materialPresets.map(preset => preset.id)).size !== materialPresets.length) throw new Error('Duplicate material preset IDs')
export type MaterialPreset = typeof materialPresets[number]
export const materialPresetGroups = Object.values(categories)
export function materialThumbnail(presetId: string | undefined): string | undefined {
  return materialPresets.find(preset => preset.id === presetId)?.thumbnail
}
