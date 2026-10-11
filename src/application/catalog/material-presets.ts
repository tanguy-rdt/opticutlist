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
export const builtInMaterialPresets = manifestSchema.parse(manifest).materials.map(preset => ({ ...preset, category: categories[preset.category] }))
if (new Set(builtInMaterialPresets.map(preset => preset.id)).size !== builtInMaterialPresets.length) throw new Error('Duplicate material preset IDs')
export const materialPresetGroups = Object.values(categories)
