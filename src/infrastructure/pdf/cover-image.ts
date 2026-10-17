import { PDFDocument } from 'pdf-lib'
import { coverImageSchema, MAX_COVER_IMAGE_BYTES, type CoverImage } from '../../domain/model/pdf-settings'

/** Decode the actual file before it can enter project settings. No object URLs are persisted. */
export async function prepareCoverImage(file: Blob): Promise<CoverImage> {
  if (!['image/png', 'image/jpeg'].includes(file.type)) {
    throw new Error('Choose a PNG or JPEG image.')
  }
  if (!file.size || file.size > MAX_COVER_IMAGE_BYTES) {
    throw new Error('Choose an image no larger than 2 MB.')
  }
  const buffer = await file.arrayBuffer()
  const pdf = await PDFDocument.create()
  try {
    const image = file.type === 'image/png' ? await pdf.embedPng(buffer) : await pdf.embedJpg(buffer)
    if (!image.width || !image.height || image.width * image.height > 40_000_000) {
      throw new Error('Image exceeds 40 megapixels.')
    }
  } catch {
    throw new Error('This image cannot be read. Choose a valid PNG or JPEG of at most 40 megapixels.')
  }
  let binary = ''
  for (const byte of new Uint8Array(buffer)) {
    binary += String.fromCharCode(byte)
  }
  return coverImageSchema.parse({ mimeType: file.type, data: btoa(binary) })
}
