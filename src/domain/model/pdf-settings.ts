import { z } from 'zod'

export const MAX_COVER_IMAGE_BYTES = 2 * 1024 * 1024
export const coverImageSchema = z.strictObject({
  mimeType: z.enum(['image/png', 'image/jpeg']),
  // One bounded portable payload, not an object URL or a duplicated data URI.
  data: z.string().min(4).max(Math.ceil(MAX_COVER_IMAGE_BYTES / 3) * 4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
}).refine(image => image.data.length / 4 * 3 - (image.data.endsWith('==') ? 2 : image.data.endsWith('=') ? 1 : 0) <= MAX_COVER_IMAGE_BYTES, 'The cover image must be no larger than 2 MB.')
  .refine(image => image.mimeType === 'image/png' ? image.data.startsWith('iVBORw0KGgo') : image.data.startsWith('/9j/'), 'The image content must match its PNG or JPEG format.')
export const pdfSettingsSchema = z.strictObject({
  pageSize: z.enum(['A4', 'A3']).optional(),
  orientation: z.enum(['portrait', 'landscape']).optional(),
  titleOverride: z.string().trim().max(300).optional(),
  description: z.string().trim().max(2000).optional(),
  coverImage: coverImageSchema.optional(),
})
export type PdfSettings = z.infer<typeof pdfSettingsSchema>
export type CoverImage = z.infer<typeof coverImageSchema>
