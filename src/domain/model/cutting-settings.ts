import { z } from 'zod'

const nonNegativeMillimetersSchema = z
  .number({ error: 'Must be a finite number in millimeters' })
  .nonnegative({ error: 'Must not be negative' })

/**
 * Machine and panel-preparation constraints shared by geometry checks.
 * - `kerfMm`: material removed by each saw cut between two pieces.
 * - `edgeMarginMm`: material trimmed from every panel edge before use; it includes the trim cut itself.
 */
export const cuttingSettingsSchema = z.strictObject({
  kerfMm: nonNegativeMillimetersSchema,
  edgeMarginMm: nonNegativeMillimetersSchema,
})

export type CuttingSettings = z.infer<typeof cuttingSettingsSchema>
