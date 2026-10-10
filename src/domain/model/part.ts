import { z } from 'zod'

import { nameSchema, quantitySchema } from './common'
import { dimensions3DSchema } from './dimensions'
import { materialIdSchema, partIdSchema } from './ids'
import { grainDirectionSchema, rotationPolicySchema } from './orientation'

/** A requested piece to cut, possibly in several identical copies. */
export const partSchema = z.strictObject({
  id: partIdSchema,
  name: nameSchema,
  materialId: materialIdSchema,
  ...dimensions3DSchema.shape,
  quantity: quantitySchema,
  grainDirection: grainDirectionSchema,
  rotation: rotationPolicySchema,
})

export type Part = z.infer<typeof partSchema>
