import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const css = readFileSync(`${process.cwd()}/src/ui/styles.css`, 'utf8')
function tokens(pattern: RegExp): Map<string, string> {
  const block = css.match(pattern)?.[1] ?? ''
  return new Map([...block.matchAll(/--([\w-]+):\s*(#[a-f\d]{6});/gi)].map(match => [match[1] ?? '', match[2] ?? '']))
}
function luminance(hex: string): number {
  const channels = [1, 3, 5].map(offset => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722
}
function contrast(colors: Map<string, string>, first: string, second: string): number {
  const a = colors.get(first); const b = colors.get(second)
  if (!a || !b) throw new Error(`Missing color tokens ${first}/${second}`)
  const firstValue = luminance(a); const secondValue = luminance(b)
  return (Math.max(firstValue, secondValue) + 0.05) / (Math.min(firstValue, secondValue) + 0.05)
}
describe('accessible theme palette', () => {
  it.each([
    ['light', /:root \{([\s\S]*?)\n\}/],
    ['dark', /:root\[data-theme='dark'\] \{([\s\S]*?)\n\}/],
  ] as const)('keeps text, selected states and action labels readable in %s', (_theme, pattern) => {
    const colors = tokens(pattern)
    for (const [first, second] of [['ink', 'canvas'], ['ink', 'surface'], ['muted', 'surface'], ['muted', 'canvas'], ['muted', 'sidebar'], ['muted', 'quiet-surface'], ['muted', 'subtle'], ['muted', 'hover'], ['ink', 'sidebar'], ['ink', 'quiet-surface'], ['accent', 'surface'], ['accent', 'subtle'], ['on-accent', 'accent'], ['on-accent', 'accent-hover'], ['danger', 'surface'], ['danger', 'danger-surface'], ['warning', 'warning-surface'], ['success', 'success-surface']]) {
      if (!first || !second) throw new Error('Missing contrast pair')
      expect(contrast(colors, first, second)).toBeGreaterThanOrEqual(4.5)
    }
    for (const background of ['surface', 'sidebar', 'canvas', 'quiet-surface']) {
      expect(contrast(colors, 'control-line', background)).toBeGreaterThanOrEqual(3)
      expect(contrast(colors, 'accent', background)).toBeGreaterThanOrEqual(3)
    }
  })
  it('keeps system dark tokens identical to the explicit dark theme', () => {
    const system = tokens(/:root:not\(\[data-theme\]\) \{([\s\S]*?)\n {2}\}/)
    const dark = tokens(/:root\[data-theme='dark'\] \{([\s\S]*?)\n\}/)
    expect([...system]).toEqual([...dark])
  })
  it('keeps wood, part, offcut, selection and cut inks stable across themes', () => {
    const root = tokens(/:root \{([\s\S]*?)\n\}/)
    const dark = tokens(/:root\[data-theme='dark'\] \{([\s\S]*?)\n\}/)
    const system = tokens(/:root:not\(\[data-theme\]\) \{([\s\S]*?)\n {2}\}/)
    for (const name of ['cutting-panel', 'cutting-part', 'cutting-waste', 'cutting-ink', 'cutting-line', 'cutting-selection', 'cutting-kerf', 'cutting-cut']) {
      expect(root.has(name)).toBe(true)
      expect(dark.has(name)).toBe(false)
      expect(system.has(name)).toBe(false)
    }
  })

  it('separates selected, hover, sidebar and card surfaces in both themes', () => {
    for (const pattern of [/:root \{([\s\S]*?)\n\}/, /:root\[data-theme='dark'\] \{([\s\S]*?)\n\}/]) {
      const colors = tokens(pattern)
      expect(new Set(['canvas', 'sidebar', 'surface', 'hover', 'subtle'].map(name => colors.get(name))).size).toBe(5)
    }
  })

})
