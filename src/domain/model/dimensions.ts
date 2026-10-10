import { z } from 'zod'

// Zod rejects NaN and ±Infinity for z.number(), so `positive()` yields finite, strictly positive values.
const millimetersSchema = z
  .number({ error: 'Dimension must be a finite number in millimeters' })
  .positive({ error: 'Dimension must be strictly positive' })

/**
 * Physical size of a rectangular item, in millimeters.
 * `lengthMm` and `widthMm` describe the 2D face; `widthMm` is not required to be the smaller side.
 * Grain direction is expressed relative to these axes (see `GrainDirection`).
 */
export const dimensions3DSchema = z.strictObject({
  lengthMm: millimetersSchema,
  widthMm: millimetersSchema,
  thicknessMm: millimetersSchema,
})

export type Dimensions3D = z.infer<typeof dimensions3DSchema>
