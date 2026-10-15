import { z } from 'zod'

/**
 * Direction of the wood grain relative to an item's own axes.
 * - `none`: no grain constraint (e.g. MDF, or the user does not care).
 * - `length`: grain runs parallel to `lengthMm`.
 * - `width`: grain runs parallel to `widthMm`.
 */
export const grainDirectionSchema = z.enum(['none', 'length', 'width'])
export type GrainDirection = z.infer<typeof grainDirectionSchema>

/**
 * Whether a part may be rotated by 90° in the panel plane during placement.
 * Used when grain does not determine orientation; explicit part/panel grain alignment takes precedence.
 */
export const rotationPolicySchema = z.enum(['allowed', 'forbidden'])
export type RotationPolicy = z.infer<typeof rotationPolicySchema>
