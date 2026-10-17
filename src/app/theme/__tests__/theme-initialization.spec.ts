// @vitest-environment node
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const html = readFileSync(`${process.cwd()}/index.html`, 'utf8')
const script = html.match(/<script id="theme-init">([\s\S]*?)<\/script>/)?.[1]
if (!script) throw new Error('Missing early theme initialization')
function initialize(saved: string | null, blocked = false): Record<string, string> {
  const dataset: Record<string, string> = {}
  runInNewContext(script ?? '', {
    document: { documentElement: { dataset } },
    localStorage: { getItem: () => { if (blocked) throw new Error('Storage blocked'); return saved } },
  })
  return dataset
}
describe('theme before application initialization', () => {
  it.each(['light', 'dark'])('restores explicit %s before the Vue entry point', theme => {
    expect(initialize(theme)).toEqual({ theme })
    expect(html.indexOf('id="theme-init"')).toBeLessThan(html.indexOf('src="/src/main.ts"'))
  })
  it.each([null, 'system', 'invalid'])('leaves CSS system fallback in control for %s', preference => {
    expect(initialize(preference)).toEqual({})
  })
  it('does not block startup when localStorage is unavailable', () => {
    expect(initialize(null, true)).toEqual({})
  })
})
