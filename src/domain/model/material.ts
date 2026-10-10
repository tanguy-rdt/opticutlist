import { z } from 'zod'

import { nameSchema } from './common'
import { materialIdSchema } from './ids'

/**
 * Material type/specification (e.g. "Birch plywood BB/BB").
 * Thickness is not part of the material: it belongs to each physical item.
 * Two items share a material only if they reference the same material ID.
 */
export const materialSchema = z.strictObject({
  id: materialIdSchema,
  name: nameSchema,
  /** Grouping used for catalog navigation, e.g. "Plywood" or "MDF". */
  category: nameSchema,
})

export type Material = z.infer<typeof materialSchema>
