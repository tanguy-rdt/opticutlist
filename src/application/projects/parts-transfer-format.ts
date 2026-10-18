import { z } from 'zod'
import { partSchema } from '../../domain/model/part'
import { nameSchema } from '../../domain/model/common'
import type { PersistenceResult } from '../persistence/repositories'

export const partsTransferSchema = z.strictObject({
  format: z.literal('opticutlist-parts'),
  version: z.literal(1),
  parts: z.array(z.strictObject({
    name: partSchema.shape.name,
    material: nameSchema.optional(),
    length: partSchema.shape.lengthMm,
    width: partSchema.shape.widthMm,
    thickness: partSchema.shape.thicknessMm,
    quantity: partSchema.shape.quantity,
    grainDirection: partSchema.shape.grainDirection.default('none'),
    rotation: partSchema.shape.rotation.default('allowed'),
  })),
})
export type PartsTransfer = z.infer<typeof partsTransferSchema>

export function validatePartsTransfer(input: unknown): PersistenceResult<PartsTransfer> {
  const result = partsTransferSchema.safeParse(input)
  return result.success ? { ok: true, value: result.data } : { ok: false, error: { kind: 'invalidRecord', issues: result.error.issues } }
}
