import { z } from 'zod'

import { nameSchema, webUrlSchema } from './common'
import { supplierIdSchema } from './ids'

/** A store or supplier selling panels. */
export const supplierSchema = z.strictObject({
  id: supplierIdSchema,
  name: nameSchema,
  websiteUrl: webUrlSchema.optional(),
})

export type Supplier = z.infer<typeof supplierSchema>
