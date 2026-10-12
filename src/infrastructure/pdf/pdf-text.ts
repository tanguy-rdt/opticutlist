import type { PDFFont } from 'pdf-lib'

/** Wrap even long IDs, measure with the embedded font, and never silently drop unsupported glyphs. */
export function wrapPdfText(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split(/\r?\n/u)) {
    let line = ''
    for (const word of paragraph.split(/\s+/u).filter(Boolean)) {
      if (line && font.widthOfTextAtSize(`${line} ${word}`, size) <= width) { line += ` ${word}`; continue }
      if (line) { lines.push(line); line = '' }
      for (const character of word) {
        if (font.widthOfTextAtSize(character, size) > width) throw new Error('The PDF text area is too narrow.')
        if (line && font.widthOfTextAtSize(line + character, size) > width) { lines.push(line); line = '' }
        line += character
      }
    }
    lines.push(line)
  }
  return lines
}
