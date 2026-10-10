import { z } from 'zod'

import { nameSchema, webUrlSchema } from './common'
import { dimensions3DSchema } from './dimensions'
import { materialIdSchema, supplierIdSchema, supplierProductIdSchema } from './ids'
import { grainDirectionSchema } from './orientation'

/** ISO 4217 alphabetic currency code, e.g. "EUR". */
export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, { error: 'Currency must be an ISO 4217 code such as "EUR"' })

export const productAvailabilitySchema = z.enum(['available', 'unavailable', 'unknown'])
export type ProductAvailability = z.infer<typeof productAvailabilitySchema>

/**
 * A purchasable catalog panel. It is never owned stock: buying it creates separate `StockItem`s.
 * `price` is the price of one panel in `currency`; zero is allowed (e.g. free offers).
 */
export const supplierProductSchema = z.strictObject({
  id: supplierProductIdSchema,
  supplierId: supplierIdSchema,
  materialId: materialIdSchema,
  name: nameSchema,
  ...dimensions3DSchema.shape,
  grainDirection: grainDirectionSchema,
  price: z
    .number({ error: 'Price must be a finite number' })
    .nonnegative({ error: 'Price must not be negative' }),
  currency: currencyCodeSchema,
  productUrl: webUrlSchema.optional(),
  availability: productAvailabilitySchema,
})

export type SupplierProduct = z.infer<typeof supplierProductSchema>
