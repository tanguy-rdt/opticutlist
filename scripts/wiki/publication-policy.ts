import { extname } from 'node:path'
import { crc32 } from 'node:zlib'

export function hasControlCharacters(value: string): boolean {
  for (const character of value) if (character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) return true
  return false
}

/** Publication is not a backup mechanism. Keep names deliberately unambiguous. */
export function validateName(name: string): void {
  for (const part of name.split('/')) {
    if (!part || part.startsWith('.') || /[\\:%]/.test(part) || hasControlCharacters(part)) throw new Error('Hidden or unsafe source path.')
    if (/(?:^|[._ -])(?:env|config|credentials?|authentication|secrets?|tokens?|passwords?|id_rsa|id_ed25519|id_ecdsa|id_dsa|backup|dump|debug|export)(?:[._ -]|$)/i.test(part)) throw new Error('Sensitive or local-configuration filename.')
  }
  const leaf = name.split('/').at(-1) ?? ''
  if (/\.(?:env|key|pem|crt|cer|p12|pfx|der|jks|keystore|db|sqlite|sqlite3|sql|dump|bak|backup|log|zip|gz|tar|cocl|pocl|oclproject|oclparts|oclstock)$/i.test(leaf)) throw new Error('Sensitive file type is forbidden.')
  if (leaf.slice(0, -extname(leaf).length).includes('.')) throw new Error('Double extensions are not allowed.')
}

export function validateMarkdown(data: Buffer): void {
  // Fatal decoding rejects binary payloads disguised as documentation.
  new TextDecoder('utf-8', { fatal: true }).decode(data)
  if (data.includes(0)) throw new Error('Binary content is not Markdown.')
  if (/-----BEGIN (?:[A-Z ]*PRIVATE KEY|CERTIFICATE)-----|SQLite format 3|^-- (?:MySQL|PostgreSQL).*dump/im.test(data.toString('utf8'))) throw new Error('Sensitive content is not documentation.')
}

/** Structural signatures and bounded containers, not an extension-only decision.
 * Metadata chunks are rejected: re-export documentation images without metadata.
 * This is not a steganography detector or a complete image decoder.
 */
export function validateImage(name: string, data: Buffer): void {
  const extension = extname(name).toLowerCase()
  if (extension === '.svg') throw new Error('SVG is not supported. Export a PNG, JPEG or WebP instead.')
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) throw new Error('Only referenced PNG, JPEG and WebP documentation images are allowed.')
  if (!data.length || data.length > 5 * 1024 * 1024) throw new Error('Image must be nonempty and at most 5 MiB.')
  function invalid(): never { throw new Error('Image content does not match a safe supported image container; re-export without metadata.') }
  if (extension === '.png') {
    if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) invalid()
    let offset = 8; let header = false; let pixels = false
    while (offset + 12 <= data.length) {
      const length = data.readUInt32BE(offset)
      const type = data.toString('ascii', offset + 4, offset + 8)
      if (offset + 12 + length > data.length || !['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS'].includes(type)) invalid()
      if (crc32(data.subarray(offset + 4, offset + 8 + length)) !== data.readUInt32BE(offset + 8 + length)) invalid()
      if (!header && (type !== 'IHDR' || length !== 13)) invalid()
      if (type === 'IHDR') {
        if (header || length !== 13 || !data.readUInt32BE(offset + 8) || !data.readUInt32BE(offset + 12)) invalid()
        header = true
      }
      if (type === 'IDAT') pixels = true
      offset += length + 12
      if (type === 'IEND') { if (length || offset !== data.length || !pixels) invalid(); return }
    }
    invalid()
  } else if (extension === '.webp') {
    if (data.length < 20 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WEBP' || data.readUInt32LE(4) + 8 !== data.length) invalid()
    let offset = 12; let pixels = false
    while (offset + 8 <= data.length) {
      const type = data.toString('ascii', offset, offset + 4)
      const length = data.readUInt32LE(offset + 4)
      if (!['VP8 ', 'VP8L', 'VP8X', 'ALPH'].includes(type) || !length) invalid()
      if (type === 'VP8 ' || type === 'VP8L') pixels = true
      offset += 8 + length + length % 2
      if (offset > data.length) invalid()
    }
    if (!pixels || offset !== data.length) invalid()
  } else {
    if (data[0] !== 255 || data[1] !== 216) invalid()
    let offset = 2; let frame = false; let scan = false
    while (offset < data.length) {
      if (data[offset++] !== 255) invalid()
      while (data[offset] === 255) offset++
      const marker = data.at(offset++)
      if (marker === 217) { if (!frame || !scan || offset !== data.length) invalid(); return }
      if (marker === undefined || marker === 0 || marker === 216 || marker >= 208 && marker <= 215 || offset + 2 > data.length) invalid()
      const length = data.readUInt16BE(offset)
      if (length < 2 || offset + length > data.length || marker === 254 || marker >= 225 && marker <= 239) invalid()
      if (marker === 224 && (length < 16 || data.toString('ascii', offset + 2, offset + 7) !== 'JFIF\0' || length !== 16 + 3 * (data[offset + 14] ?? 0) * (data[offset + 15] ?? 0))) invalid()
      if ([192, 193, 194].includes(marker)) { if (length < 8 || !data.readUInt16BE(offset + 3) || !data.readUInt16BE(offset + 5)) invalid(); frame = true }
      offset += length
      if (marker === 218) {
        scan = true
        while (offset < data.length) {
          if (data[offset] !== 255) { offset++; continue }
          const next = data.at(offset + 1)
          if (next === 0 || next !== undefined && next >= 208 && next <= 215) { offset += 2; continue }
          break
        }
      }
    }
    invalid()
  }
}
