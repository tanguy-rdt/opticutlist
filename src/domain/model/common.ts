import { z } from 'zod'

/** Human-readable label; surrounding whitespace is trimmed. */
export const nameSchema = z
  .string()
  .trim()
  .min(1, { error: 'Name must not be empty' })
  .max(200, { error: 'Name must be at most 200 characters' })

/** Number of identical items: a positive safe integer. */
export const quantitySchema = z
  .number({ error: 'Quantity must be a number' })
  .int({ error: 'Quantity must be a positive integer' })
  .positive({ error: 'Quantity must be a positive integer' })

/** Absolute http(s) URL. */
export const webUrlSchema = z.url({
  protocol: /^https?$/,
  error: 'Must be an absolute http(s) URL',
})
