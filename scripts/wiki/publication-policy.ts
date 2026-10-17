import { extname } from 'node:path'

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

/** Publication allowlist, not an image decoder or metadata/secret scanner.
 * Check familiar file signatures and end markers; leave image decoding to viewers.
 */
export function validateImage(name: string, data: Buffer): void {
  const extension = extname(name).toLowerCase()
  if (extension === '.svg') throw new Error('SVG is not supported. Export a PNG, JPEG or WebP instead.')
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) throw new Error('Only referenced PNG, JPEG and WebP documentation images are allowed.')
  if (!data.length || data.length > 5 * 1024 * 1024) throw new Error('Image must be nonempty and at most 5 MiB.')

  let matches: boolean
  if (extension === '.png') {
    matches = data.length >= 45
      && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      && data.subarray(-12).equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]))
  } else if (extension === '.webp') {
    matches = data.length >= 20
      && data.subarray(0, 4).equals(Buffer.from('RIFF'))
      && data.subarray(8, 12).equals(Buffer.from('WEBP'))
      && data.readUInt32LE(4) === data.length - 8
  } else {
    matches = data.length >= 4
      && data.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
      && data.subarray(-2).equals(Buffer.from([255, 217]))
  }
  if (!matches) throw new Error('Image content does not match its PNG, JPEG or WebP format; re-export the image.')
}
