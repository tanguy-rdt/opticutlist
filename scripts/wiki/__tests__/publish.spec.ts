// @vitest-environment node
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { jpegCover } from '../../../src/infrastructure/pdf/__tests__/cover-image-fixtures'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildWiki, MANIFEST, pageName, syncWiki, type WikiOptions } from '../publish.ts'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
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
function put(options: WikiOptions, name: string, content: string | Buffer): void {
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
    expect(page(options, 'Home.md')).not.toContain('### Architecture & domain')
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

  it('copies only referenced verified documentation images and rewrites reference images', () => {
    const options = fixture()
    put(options, 'docs/assets/panel image.png', png)
    put(options, 'docs/assets/unused.png', png)
    put(options, 'docs/notes.txt', 'not a published page')
    put(options, 'docs/images.md', '![Panel](assets/panel%20image.png)\n![Reference][sample]\n\n[sample]: assets/panel%20image.png\n')
    const output = buildWiki(options)
    expect(output.get('_assets/opticutlist-docs/docs/assets/panel image.png')).toEqual(png)
    expect([...output.keys()]).not.toContain('_assets/opticutlist-docs/docs/assets/unused.png')
    expect([...output.keys()]).not.toContain('_assets/opticutlist-docs/docs/notes.txt')
    expect(output.get('Docs-images.md')?.toString()).toContain('[sample]: https://raw.githubusercontent.com/wiki/example/opticutlist/_assets/opticutlist-docs/docs/assets/panel%20image.png')
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
    put(options, 'docs/old.md', '# Old\n![Panel](old.png)\n')
    put(options, 'docs/old.png', png)
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
  it.each(['.env', '.hidden/page.md', 'credentials.md', 'private.key', 'backup.zip', 'database.sql', 'debug.log', 'project.export.json', 'image.png.md', 'secret.pem.png'])('rejects suspicious documentation files before writing: %s', name => {
    const options = fixture()
    put(options, `docs/${name}`, 'not public')
    // Unsupported ordinary files are never copied; references must fail closed.
    put(options, 'docs/unsafe.md', `![Image](${name})`)
    expect(() => syncWiki(options)).toThrow()
    expect(existsSync(options.destination)).toBe(false)
  })

  it.each(['../outside.png', '/absolute.png', '../../escape.png', '%2e%2e/outside.png', '%252e%252e/outside.png', 'assets/%2fetc.png', 'C:/image.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'file:///image.png', '//host/image.png', 'https://example.org/image.png'])('rejects unsafe image references without modifying an existing Wiki: %s', reference => {
    const options = fixture()
    syncWiki(options)
    put(options, 'outside.png', png)
    const before = readFileSync(join(options.destination, MANIFEST))
    put(options, 'docs/unsafe.md', `![Image](${reference})`)
    expect(() => syncWiki(options)).toThrow()
    expect(readFileSync(join(options.destination, MANIFEST))).toEqual(before)
    expect(existsSync(join(options.destination, 'Docs-unsafe.md'))).toBe(false)
  })

  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hello', 'vbscript:hello', '//example.org/path'])('rejects unsafe link schemes: %s', reference => {
    const options = fixture()
    put(options, 'docs/unsafe.md', `[Link](${reference})`)
    expect(() => buildWiki(options)).toThrow()
  })

  it.each(['<svg/>', '<svg><script>alert(1)</script></svg>'])('rejects all SVG, including active content', svg => {
    const options = fixture()
    put(options, 'docs/image.svg', svg)
    put(options, 'docs/image.md', '![Image](image.svg)')
    expect(() => syncWiki(options)).toThrow(/SVG is not supported/)
    expect(existsSync(options.destination)).toBe(false)
  })

  it('rejects disguised images, image metadata and trailing payloads', () => {
    for (const data of [Buffer.from('not an image'), Buffer.concat([png, Buffer.from('payload')]), Buffer.from('<svg/>')]) {
      const options = fixture()
      put(options, 'docs/image.png', data)
      put(options, 'docs/image.md', '![Image](image.png)')
      expect(() => syncWiki(options)).toThrow(/Image content/)
      expect(existsSync(options.destination)).toBe(false)
    }
  })

  it('rejects binary and private-key contents disguised as Markdown without echoing contents', () => {
    for (const data of [Buffer.from([0, 255]), Buffer.from('-----BEGIN PRIVATE KEY-----\nnot-a-real-key')]) {
      const options = fixture()
      put(options, 'docs/guide.md', data)
      expect(() => syncWiki(options)).toThrow('Invalid or sensitive Markdown content in docs/guide.md.')
      expect(existsSync(options.destination)).toBe(false)
    }
  })

  it('rejects raw HTML instead of attempting partial sanitization', () => {
    const options = fixture()
    put(options, 'docs/unsafe.md', '<img src="image.png" onerror="alert(1)">')
    expect(() => buildWiki(options)).toThrow(/Raw HTML/)
  })

  it('rejects symlinks in destination ancestors', () => {
    const options = fixture()
    const alias = join(options.source, 'alias')
    symlinkSync(options.source, alias)
    expect(() => syncWiki({ ...options, destination: join(alias, 'output') })).toThrow()
    expect(existsSync(join(options.source, 'output'))).toBe(false)
  })

  it('builds the actual documentation without publishing or modifying it', () => {
    const output = buildWiki({ source: process.cwd(), destination: '', repository: 'example/opticutlist', branch: 'master' })
    expect(output.has('Home.md')).toBe(true)
    expect(output.has('Docs-wiki-publishing.md')).toBe(true)
  })

  it('accepts verified JPEG and WebP images and rejects JPEG metadata', () => {
    const original = Buffer.from(jpegCover.data, 'base64')
    const profile = original.indexOf(Buffer.from([255, 226]))
    expect(profile).toBeGreaterThan(0)
    const jpeg = Buffer.concat([original.subarray(0, profile), original.subarray(profile + 2 + original.readUInt16BE(profile + 2))])
    for (const [name, data] of [['panel.jpeg', jpeg], ['panel.webp', readFileSync('public/materials/previews/mdf.webp')]] as const) {
      const options = fixture()
      put(options, `docs/${name}`, data)
      put(options, 'docs/image.md', `![Panel](${name})`)
      expect(buildWiki(options).get(`_assets/opticutlist-docs/docs/${name}`)).toEqual(data)
    }
    const options = fixture()
    put(options, 'docs/image.jpeg', original)
    put(options, 'docs/image.md', '![Panel](image.jpeg)')
    expect(() => buildWiki(options)).toThrow(/Image content/)
  })

  it('rejects PNG metadata chunks even with a valid container signature', () => {
    const options = fixture()
    const modified = Buffer.from(png)
    modified.write('tEXt', 37, 'ascii')
    put(options, 'docs/image.png', modified)
    put(options, 'docs/image.md', '![Panel](image.png)')
    expect(() => buildWiki(options)).toThrow(/Image content/)
  })

  it('validates through the CLI without requiring or creating a destination', () => {
    const options = fixture()
    const result = execFileSync(process.execPath, ['scripts/wiki/cli.ts', '--validate', '--source', options.source, '--repository', options.repository, '--branch', options.branch], { encoding: 'utf8' })
    expect(result).toContain('no files written.')
    expect(existsSync(options.destination)).toBe(false)
  })

  it('exposes the Wiki secret only to the clone and push steps', () => {
    const workflow = readFileSync('.github/workflows/publish-wiki.yml', 'utf8')
    const steps = workflow.split('      - name: ')
    const credentialed = steps.filter(step => step.includes('secrets.WIKI_PUBLISH_TOKEN'))
    expect(credentialed).toHaveLength(2)
    expect(credentialed.every(step => !step.includes('node ') && !step.includes('npm '))).toBe(true)
    expect(steps.find(step => step.startsWith('Validate documentation'))).toContain('--validate')
    expect(workflow.indexOf('--validate')).toBeLessThan(workflow.indexOf('secrets.WIKI_PUBLISH_TOKEN'))
    expect(workflow).toContain('github.event.repository.default_branch')
    expect(workflow).not.toContain('pull_request_target')
  })

  it('retains manually modified managed assets instead of deleting them', () => {
    const options = fixture()
    put(options, 'docs/image.png', png)
    put(options, 'docs/image.md', '![Panel](image.png)')
    syncWiki(options)
    const asset = join(options.destination, '_assets/opticutlist-docs/docs/image.png')
    writeFileSync(asset, 'Manual edit')
    put(options, 'docs/image.md', '# No image')
    expect(() => syncWiki(options)).toThrow(/edited manually/)
    expect(readFileSync(asset, 'utf8')).toBe('Manual edit')
  })

  it('rejects encoded parent traversal even when its target exists inside docs', () => {
    const options = fixture()
    put(options, 'docs/image.png', png)
    put(options, 'docs/nested/guide.md', '![Panel](%2e%2e/image.png)')
    expect(() => syncWiki(options)).toThrow(/Encoded traversal/)
    expect(existsSync(options.destination)).toBe(false)
  })

  it('supports ordinary parent-relative documentation images within docs', () => {
    const options = fixture()
    put(options, 'docs/image.png', png)
    put(options, 'docs/nested/guide.md', '![Panel](../image.png)')
    expect(buildWiki(options).get('_assets/opticutlist-docs/docs/image.png')).toEqual(png)
  })

})
