// @vitest-environment node
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildWiki, MANIFEST, pageName, syncWiki, type WikiOptions } from '../publish.ts'

const temporary: string[] = []
function fixture(): WikiOptions {
  const root = mkdtempSync(join(tmpdir(), 'opticutlist-wiki-test-'))
  temporary.push(root)
  const source = join(root, 'source')
  mkdirSync(join(source, 'docs'), { recursive: true })
  writeFileSync(join(source, 'docs/README.md'), '# Developer guide\n\n[Architecture](architecture.md)\n')
  writeFileSync(join(source, 'docs/architecture.md'), '# Architecture\n')
  return { source, destination: join(root, 'wiki'), repository: 'example/opticutlist', branch: 'master' }
}
function put(options: WikiOptions, name: string, content: string): void {
  const path = join(options.source, name)
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content)
}
function page(options: WikiOptions, name: string): string {
  const output = buildWiki(options).get(name)
  if (!output) throw new Error(`Missing generated page ${name}`)
  return output.toString('utf8')
}
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }) })

describe('Wiki generation and managed synchronization', () => {
  it('uses stable path-based names, maps the root README to Home and supports nesting', () => {
    expect(pageName('README.md')).toBe('Home')
    expect(pageName('getting-started.md')).toBe('Docs-getting-started')
    expect(pageName('guides/README.md')).toBe('Docs-guides--README')
    expect(pageName('guides/Install guide.markdown')).toBe('Docs-guides--Install-guide')
    const options = fixture()
    put(options, 'docs/guides/setup.md', '# Setup\n')
    expect(page(options, '_Sidebar.md')).toContain('## guides')
    expect(page(options, '_Sidebar.md')).toContain('/wiki/Docs-guides--setup')
    expect(page(options, 'Home.md')).toContain('# Developer guide')
    expect(page(options, 'Home.md')).toContain('# Developer documentation')
  })

  it('converts inline links, reference definitions, directories, anchors and queries', () => {
    const options = fixture()
    put(options, 'docs/guides/README.md', '# Guides\n')
    put(options, 'docs/guides/start.md', '# Start\n[Parent](../architecture.md?plain=1#layers)\n[Directory](./)\n[Home](../)\n[Same](#local)\n[Query](?plain=1#local)\n[ref][arch]\n\n[arch]: <../architecture.md> "Architecture title"\n')
    const result = page(options, 'Docs-guides--start.md')
    expect(result).toContain('(https://github.com/example/opticutlist/wiki/Docs-architecture?plain=1#layers)')
    expect(result).toContain('[Directory](https://github.com/example/opticutlist/wiki/Docs-guides--README)')
    expect(result).toContain('[Home](https://github.com/example/opticutlist/wiki/Home)')
    expect(result).toContain('[Same](#local)')
    expect(result).toContain('[Query](?plain=1#local)')
    expect(result).toContain('[arch]: <https://github.com/example/opticutlist/wiki/Docs-architecture> "Architecture title"')
  })

  it('preserves labels, nested brackets, code in labels, escaped parentheses and link titles', () => {
    const options = fixture()
    put(options, 'docs/a(b).md', '# Parentheses\n')
    put(options, 'docs/a file.md', '# Spaces\n')
    put(options, 'docs/links.md', '[Nested [label]](architecture.md "A title")\n[Code `[`](architecture.md)\n[Spaces](<a file.md> "keep me")\n[Escaped](a\\(b\\).md)\n')
    const result = page(options, 'Docs-links.md')
    expect(result).toContain('[Nested [label]](https://github.com/example/opticutlist/wiki/Docs-architecture "A title")')
    expect(result).toContain('[Code `[`](https://github.com/example/opticutlist/wiki/Docs-architecture)')
    expect(result).toContain('[Spaces](<https://github.com/example/opticutlist/wiki/Docs-a-file> "keep me")')
    expect(result).toContain('[Escaped](https://github.com/example/opticutlist/wiki/Docs-a-b)')
  })

  it('preserves fenced Mermaid, indented/inline code, tables and external destinations', () => {
    const options = fixture()
    const mermaid = '```mermaid\nflowchart LR\n  A["[sample](missing.md)"] --> B[Done]\n```\n'
    const examples = '`[sample](missing.md)`\n\n    [sample](missing.md)\n\n~~~md\n[sample](missing.md)\n~~~\n'
    const table = '| Column |\n| --- |\n| [Architecture](architecture.md) |\n'
    const external = '[Web](https://example.org/a.md)\n[Mail](mailto:hello@example.org)\n<https://example.org>\n'
    put(options, 'docs/visuals.md', '# Visuals\n\n' + mermaid + '\n' + examples + '\n' + table + '\n' + external)
    const result = page(options, 'Docs-visuals.md')
    expect(result).toContain(mermaid)
    expect(result).toContain(examples)
    expect(result).toContain('| [Architecture](https://github.com/example/opticutlist/wiki/Docs-architecture) |')
    expect(result).toContain(external)
  })

  it('copies docs assets, referenced repository images and rewrites HTML and reference images', () => {
    const options = fixture()
    put(options, 'docs/assets/panel image.png', 'image-bytes')
    put(options, 'docs/assets/template.json', '{"example":true}')
    put(options, 'public/sample.svg', '<svg/>')
    put(options, 'docs/images.md', '![Panel](assets/panel%20image.png)\n[Template](assets/template.json)\n![External asset][sample]\n\n[sample]: ../public/sample.svg\n\n<img src="assets/panel%20image.png" alt="Panel">\n<a href="architecture.md">Architecture</a>\n')
    const output = buildWiki(options)
    expect(output.get('_assets/opticutlist-docs/docs/assets/panel image.png')?.toString()).toBe('image-bytes')
    expect(output.get('_assets/opticutlist-docs/public/sample.svg')?.toString()).toBe('<svg/>')
    const result = output.get('Docs-images.md')?.toString()
    expect(result).toContain('https://raw.githubusercontent.com/wiki/example/opticutlist/_assets/opticutlist-docs/docs/assets/panel%20image.png')
    expect(result).toContain('[sample]: https://raw.githubusercontent.com/wiki/example/opticutlist/_assets/opticutlist-docs/public/sample.svg')
    expect(result).toContain('<a href="https://github.com/example/opticutlist/wiki/Docs-architecture">')
  })

  it('links source code, root documentation and non-doc directories to the main repository', () => {
    const options = fixture()
    put(options, 'src/example.ts', 'export const example = true')
    put(options, 'ARCHITECTURE.md', '# Root architecture')
    put(options, 'docs/code.md', '[Source](../src/example.ts#L1)\n[Folder](../src/)\n[Rules](../ARCHITECTURE.md)\n')
    const result = page(options, 'Docs-code.md')
    expect(result).toContain('/blob/master/src/example.ts#L1')
    expect(result).toContain('/tree/master/src)')
    expect(result).toContain('/blob/master/ARCHITECTURE.md')
  })

  it('is idempotent and removes only unmodified obsolete managed pages and assets', () => {
    const options = fixture()
    put(options, 'docs/old.md', '# Old\n')
    put(options, 'docs/old.png', 'old-image')
    syncWiki(options)
    writeFileSync(join(options.destination, 'Manual-notes.md'), '# Keep this\n')
    writeFileSync(join(options.destination, '_Footer.md'), 'Manual footer\n')
    expect(syncWiki(options)).toEqual({ changed: [], removed: [] })
    rmSync(join(options.source, 'docs/old.md')); rmSync(join(options.source, 'docs/old.png'))
    const result = syncWiki(options)
    expect(result.removed).toEqual(['Docs-old.md', '_assets/opticutlist-docs/docs/old.png'])
    expect(readFileSync(join(options.destination, 'Manual-notes.md'), 'utf8')).toBe('# Keep this\n')
    expect(readFileSync(join(options.destination, '_Footer.md'), 'utf8')).toBe('Manual footer\n')
    expect(syncWiki(options)).toEqual({ changed: [], removed: [] })
  })

  it.each(['Home.md', '_Sidebar.md', 'Docs-architecture.md', 'docs-architecture.markdown', 'Docs-architecture.textile', 'Docs architecture.md'])('refuses an unmanaged destination collision: %s', name => {
    const options = fixture()
    mkdirSync(options.destination)
    writeFileSync(join(options.destination, name), 'Manual content')
    expect(() => syncWiki(options)).toThrow(/unmanaged/)
    expect(readFileSync(join(options.destination, name), 'utf8')).toBe('Manual content')
    expect(existsSync(join(options.destination, MANIFEST))).toBe(false)
  })

  it('blocks overwriting or deleting manually modified managed pages before any write', () => {
    const options = fixture()
    syncWiki(options)
    writeFileSync(join(options.destination, 'Docs-architecture.md'), 'Edited manually')
    put(options, 'docs/new.md', '# New')
    expect(() => syncWiki(options)).toThrow(/edited manually/)
    expect(existsSync(join(options.destination, 'Docs-new.md'))).toBe(false)
    rmSync(join(options.source, 'docs/architecture.md'))
    put(options, 'docs/README.md', '# Home')
    expect(() => syncWiki(options)).toThrow(/edited manually/)
    expect(readFileSync(join(options.destination, 'Docs-architecture.md'), 'utf8')).toBe('Edited manually')
  })

  it('rejects unsafe manifest paths and a manifest for a different repository', () => {
    const options = fixture()
    mkdirSync(options.destination)
    writeFileSync(join(options.destination, MANIFEST), JSON.stringify({ version: 1, repository: 'example/opticutlist', files: { '../victim.md': '0'.repeat(64) } }))
    expect(() => syncWiki(options)).toThrow(/Unsafe managed path/)
    writeFileSync(join(options.destination, MANIFEST), JSON.stringify({ version: 1, repository: 'another/repository', files: {} }))
    expect(() => syncWiki(options)).toThrow(/another repository/)
  })

  it('rejects symlinks, missing targets and output inside the source checkout', () => {
    const options = fixture()
    symlinkSync(join(options.source, 'docs/architecture.md'), join(options.source, 'docs/alias.md'))
    expect(() => buildWiki(options)).toThrow(/Symbolic links/)
    rmSync(join(options.source, 'docs/alias.md'))
    put(options, 'docs/broken.md', '[Missing](missing.md)')
    expect(() => syncWiki(options)).toThrow(/Missing link target/)
    expect(existsSync(options.destination)).toBe(false)
    expect(() => syncWiki({ ...options, destination: join(options.source, 'wiki') })).toThrow(/separate/)
  })

  it('rejects case-folded and slug collisions while keeping nested paths distinct', () => {
    expect(pageName('a--b.md')).not.toBe(pageName('a/b.md'))
    for (const pair of [['Foo.md', 'foo.markdown'], ['a b.md', 'a-b.md']]) {
      const options = fixture()
      for (const name of pair) put(options, `docs/${name}`, '# Page')
      expect(() => buildWiki(options)).toThrow(/collision/)
    }
  })

  it('blocks a symlink at a managed output path without touching its target', () => {
    const options = fixture()
    syncWiki(options)
    const path = join(options.destination, 'Docs-architecture.md')
    rmSync(path)
    const unrelated = join(options.source, 'unrelated.txt')
    writeFileSync(unrelated, 'Keep this file')
    symlinkSync(unrelated, path)
    expect(() => syncWiki(options)).toThrow(/Symbolic links/)
    expect(readFileSync(unrelated, 'utf8')).toBe('Keep this file')
  })

  it('does not modify documentation source files during generation', () => {
    const options = fixture()
    const before = readdirSync(join(options.source, 'docs')).map(name => [name, readFileSync(join(options.source, 'docs', name), 'utf8')])
    syncWiki(options)
    expect(readdirSync(join(options.source, 'docs')).map(name => [name, readFileSync(join(options.source, 'docs', name), 'utf8')])).toEqual(before)
  })
})
