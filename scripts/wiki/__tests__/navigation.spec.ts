// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, relative, dirname } from 'node:path'
import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Nodes } from 'mdast'
import { describe, expect, it } from 'vitest'
import { buildWiki, pageName } from '../publish.ts'
import { WIKI_NAVIGATION } from '../navigation.ts'

const source = process.cwd()
const docs = resolve(source, 'docs')
const output = () => buildWiki({ source, destination: '', repository: 'example/opticutlist', branch: 'master' })
function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? markdownFiles(resolve(directory, entry.name))
    : /\.(md|markdown)$/i.test(entry.name) ? [resolve(directory, entry.name)] : [])
}
function visit(node: Nodes, callback: (node: Nodes) => void): void {
  callback(node)
  if ('children' in node) for (const child of node.children) visit(child, callback)
}
function anchors(markdown: string): Set<string> {
  const result = new Set<string>()
  const counts = new Map<string, number>()
  visit(fromMarkdown(markdown), node => {
    if (node.type !== 'heading') return
    let text = ''
    visit(node, child => { if (child.type === 'text' || child.type === 'inlineCode') text += child.value })
    const slug = text.toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/g, '-')
    const index = counts.get(slug) ?? 0
    counts.set(slug, index + 1)
    result.add(index ? `${slug}-${String(index)}` : slug)
  })
  return result
}

describe('Wiki documentation portal', () => {
  it('lists every documentation page exactly once in the curated sidebar', () => {
    const sidebar = output().get('_Sidebar.md')?.toString() ?? ''
    const paths = WIKI_NAVIGATION.flatMap(group => group.pages.map(([path]) => path))
    expect(new Set(paths).size).toBe(paths.length)
    const pages = markdownFiles(docs).map(path => relative(docs, path)).filter(path => path !== 'README.md')
    expect([...paths].sort()).toEqual(pages.sort())
    for (const path of pages) expect(sidebar.split(`/wiki/${pageName(path)})`)).toHaveLength(2)
    let position = -1
    for (const group of WIKI_NAVIGATION) {
      const next = sidebar.indexOf(`### ${group.title}`)
      expect(next).toBeGreaterThan(position)
      position = next
    }
    expect(sidebar).not.toContain('More reference')
  })

  it('keeps only the homepage at docs root and publishes both nested guides', () => {
    const wiki = output()
    const home = wiki.get('Home.md')?.toString() ?? ''
    expect(home).toContain('## User Guide')
    expect(home).toContain('## Developer Guide')
    expect(home).toContain('/wiki/Docs-user-guide--README')
    expect(home).toContain('/wiki/Docs-developer-guide--README)')
    expect(readdirSync(docs).sort()).toEqual(['README.md', 'developer-guide', 'user-guide'])
    expect(home).not.toContain('```')
    expect(home.match(/^# /gm)).toHaveLength(1)
    expect(WIKI_NAVIGATION.map(group => group.title)).toEqual(['User Guide', 'Developer Guide'])
    for (const path of ['architecture', 'storage', 'getting-started', 'optimization', 'pdf-generation']) {
      expect(wiki.has(`Docs-developer-guide--${path}.md`)).toBe(true)
    }
    const storage = wiki.get('Docs-developer-guide--storage.md')?.toString() ?? ''
    expect(storage).toContain('### Standalone archive')
    expect(storage).toContain('/wiki/Docs-developer-guide--deployment#standalone-archive')
    expect(wiki.get('Docs-developer-guide--deployment.md')?.toString()).toContain('/wiki/Docs-user-guide--installation#standalone-download')
    expect(wiki.get('Docs-developer-guide--getting-started.md')?.toString()).toContain('npm run build:self-hosted')
    expect(wiki.get('Docs-user-guide--installation.md')?.toString()).toContain('node start.mjs')
  })

  it('resolves documentation and source links, including heading fragments', () => {
    const anchorsByFile = new Map<string, Set<string>>()
    for (const file of markdownFiles(docs)) {
      const markdown = readFileSync(file, 'utf8')
      visit(fromMarkdown(markdown), node => {
        if (node.type !== 'link' && node.type !== 'definition' && node.type !== 'image') return
        if (/^[a-z][a-z0-9+.-]*:/i.test(node.url)) return
        const url = new URL(node.url, 'https://local.invalid/')
        const name = decodeURIComponent(node.url.split(/[?#]/)[0] ?? '')
        const target = name ? resolve(dirname(file), name) : file
        // Generation itself validates target existence and safe asset boundaries.
        if (target.endsWith('.md') && url.hash) {
          let targetAnchors = anchorsByFile.get(target)
          if (targetAnchors === undefined) {
            targetAnchors = anchors(readFileSync(target, 'utf8'))
            anchorsByFile.set(target, targetAnchors)
          }
          expect(targetAnchors, `${relative(source, file)} → ${node.url}`).toContain(decodeURIComponent(url.hash.slice(1)))
        }
      })
    }
    expect(output().has('Home.md')).toBe(true)
  })

  it('preserves Mermaid code blocks verbatim and offers a route back from every guide', () => {
    const wiki = output()
    for (const file of markdownFiles(docs)) {
      const path = relative(docs, file)
      const markdown = readFileSync(file, 'utf8')
      const generated = wiki.get(`${pageName(path)}.md`)?.toString() ?? ''
      for (const match of markdown.matchAll(/```mermaid\n[\s\S]*?\n```/g)) expect(generated).toContain(match[0])
      if (path !== 'README.md') {
        expect(generated).toContain('[Documentation home](https://github.com/example/opticutlist/wiki/Home)')
        expect(generated).toContain('**Continue exploring:**')
      }
    }
  })
})
