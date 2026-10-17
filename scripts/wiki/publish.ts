import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Nodes } from 'mdast'
import { z } from 'zod'
import { WIKI_NAVIGATION } from './navigation.ts'
import { hasControlCharacters, validateImage, validateMarkdown, validateName } from './publication-policy.ts'

export const MANIFEST = '.opticutlist-docs-manifest.json'
const ASSETS = '_assets/opticutlist-docs/'
const PAGE_EXTENSION = /\.(md|markdown|mdown|mkd|rst|rest|textile|rdoc|org|creole|mediawiki|wiki|asciidoc|adoc|pod)$/i
const pageIdentity = (name: string): string => basename(name).replace(PAGE_EXTENSION, '').replace(/[ _]/g, '-').toLowerCase()
const manifestSchema = z.strictObject({
  version: z.literal(1),
  repository: z.string(),
  files: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
})
export interface WikiOptions { source: string; destination: string; repository: string; branch: string }
interface Patch { start: number; end: number; value: string }
const hash = (content: Uint8Array): string => createHash('sha256').update(content).digest('hex')
const urlPath = (path: string): string => path.split('/').map(encodeURIComponent).join('/')
const portable = (path: string): string => path.split(sep).join('/')
function inside(root: string, path: string): boolean {
  const offset = relative(root, path)
  return offset === '' || (!offset.startsWith(`..${sep}`) && offset !== '..' && !isAbsolute(offset))
}
function safePath(root: string, name: string): string {
  if (isAbsolute(name) || name.includes('\\') || hasControlCharacters(name)) throw new Error('Unsafe path.')
  const target = resolve(root, name)
  if (!inside(root, target)) throw new Error(`Path escapes its root: ${name}`)
  let cursor = target
  while (inside(root, cursor)) {
    const stat = lstatSync(cursor, { throwIfNoEntry: false })
    if (stat?.isSymbolicLink()) throw new Error(`Symbolic links are not supported: ${name}`)
    if (cursor !== target && stat && !stat.isDirectory()) throw new Error(`Path parent is not a directory: ${name}`)
    if (cursor === root) break
    cursor = dirname(cursor)
  }
  return target
}
function files(root: string, prefix = '', documentation = false): string[] {
  return readdirSync(resolve(root, prefix), { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1).flatMap(entry => {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name
    if (documentation) {
      try { validateName(name) } catch (error) { throw new Error(`Unsafe documentation file docs/${name}: ${error instanceof Error ? error.message : 'Invalid filename'}`, { cause: error }) }
    }
    if (entry.name === '.git') return []
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not supported: ${name}`)
    if (!entry.isDirectory() && !entry.isFile()) throw new Error(`Unsupported special file: ${name}`)
    return entry.isDirectory() ? files(root, name, documentation) : [name]
  })
}
function managed(name: string): boolean {
  return name === 'Home.md' || name === '_Sidebar.md' || /^Docs-[A-Za-z0-9-]+\.md$/.test(name)
    || name.startsWith(ASSETS) && !name.split('/').some(part => part === '..' || part === '.' || part === '.git' || part === '')
}
export function pageName(path: string): string {
  if (path === 'README.md') return 'Home'
  const parts = path.replace(/\.(?:md|markdown)$/i, '').split('/').map(part => part.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, ''))
  if (parts.some(part => !part)) throw new Error(`Cannot name Wiki page for ${path}`)
  return `Docs-${parts.join('--')}`
}
function offset(node: Nodes): { start: number; end: number } {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start === undefined || end === undefined) throw new Error('Markdown parser did not provide source offsets.')
  return { start, end }
}
/** Locate only the destination token; preserve labels, whitespace and optional titles byte-for-byte. */
function destinationRange(text: string, definition: boolean): { start: number; end: number } {
  let cursor = text.indexOf('[') + 1
  let depth = 1
  for (; cursor < text.length && depth; cursor++) {
    if (text[cursor] === '\\') { cursor++; continue }
    if (text[cursor] === '`') {
      const ticks = text.slice(cursor).match(/^`+/)?.[0] ?? '`'
      const end = text.indexOf(ticks, cursor + ticks.length)
      if (end !== -1) { cursor = end + ticks.length - 1; continue }
    }
    if (text[cursor] === '[') depth++
    if (text[cursor] === ']') depth--
  }
  if (depth) throw new Error('Cannot locate Markdown link label.')
  while (/\s/.test(text[cursor] ?? '') && cursor < text.length) cursor++
  if (text[cursor] !== (definition ? ':' : '(')) throw new Error('Cannot locate Markdown link destination.')
  cursor++
  while (/\s/.test(text[cursor] ?? '') && cursor < text.length) cursor++
  const angle = text[cursor] === '<'
  if (angle) cursor++
  const start = cursor
  let parentheses = 0
  for (; cursor < text.length; cursor++) {
    const char = text[cursor]
    if (char === '\\') { cursor++; continue }
    if (angle ? char === '>' : /\s/.test(char) || char === ')' && parentheses === 0) break
    if (char === '(') parentheses++
    if (char === ')') parentheses--
  }
  return { start, end: cursor }
}

export function buildWiki(options: WikiOptions): Map<string, Buffer> {
  const source = resolve(options.source)
  const docs = safePath(source, 'docs')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository)) throw new Error('Use repository OWNER/REPO, without credentials or a URL.')
  if (!options.branch || /[\r\n]/.test(options.branch)) throw new Error('A valid source branch is required.')
  const sourceFiles = files(docs, '', true)
  const pages = new Map(sourceFiles.filter(name => /\.(?:md|markdown)$/i.test(name)).map(name => [name, pageName(name)]))
  if (!pages.has('README.md')) throw new Error('docs/README.md is required for the Wiki Home page.')
  const names = [...pages.values()].map(name => name.toLowerCase())
  if (new Set(names).size !== names.length) throw new Error('Wiki page-name collision. Rename conflicting docs paths before publishing.')
  const output = new Map<string, Buffer>()
  const repoUrl = `https://github.com/${options.repository}`
  const wikiUrl = `${repoUrl}/wiki`
  const pageUrl = (name: string): string => `${wikiUrl}/${encodeURIComponent(name)}`
  function asset(path: string): string {
    const rel = portable(relative(source, path))
    const name = `${ASSETS}${rel}`
    if (!inside(docs, path)) throw new Error('Referenced assets must stay inside docs/.')
    const data = readFileSync(safePath(docs, portable(relative(docs, path))))
    validateImage(rel, data)
    output.set(name, data)
    return `https://raw.githubusercontent.com/wiki/${options.repository}/${urlPath(name)}`
  }
  function convert(url: string, current: string, image: boolean): string {
    const fail = (reason: string): never => { throw new Error(`Unsafe reference in ${portable(relative(source, current))}: ${reason}`) }
    if (!url || url.startsWith('#') || url.startsWith('?')) {
      if (image) return fail('Images must reference a local documentation file.')
      return url
    }
    if (url.startsWith('//') || url.includes('\\') || hasControlCharacters(url) || url.trim() !== url) return fail('Absolute or ambiguous URL is not allowed.')
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
      if (image) return fail('Images must be local documentation assets.')
      try {
        const external = new URL(url)
        if (!['https:', 'http:', 'mailto:'].includes(external.protocol) || external.username || external.password) return fail('Unsupported scheme or authenticated URL.')
      } catch { return fail('Invalid external URL.') }
      return url
    }
    const boundary = url.search(/[?#]/)
    const pathPart = boundary === -1 ? url : url.slice(0, boundary)
    const tail = url.slice(pathPart.length)
    let decoded: string
    try { decoded = decodeURIComponent(pathPart) } catch { return fail('Invalid path encoding.') }
    if (decoded.startsWith('/') || decoded.includes('\\') || /[%:]/.test(decoded) || hasControlCharacters(decoded)) return fail('Absolute or ambiguous path.')
    if (decoded !== pathPart && decoded.split('/').includes('..')) return fail('Encoded traversal is not allowed.')
    const target = safePath(source, portable(relative(source, resolve(dirname(current), decoded))))
    const relSource = portable(relative(source, target))
    try {
      if (inside(docs, target) || image) validateName(relSource)
      else if (relSource.split('/').some(part => part === '.git' || part.startsWith('.env'))) throw new Error('Hidden target')
    } catch { return fail('Sensitive or ambiguous target filename.') }
    if (!existsSync(target)) fail('Missing link target.')
    const stat = lstatSync(target)
    const relDocs = portable(relative(docs, target))
    if (!image && inside(docs, target)) {
      const page = stat.isDirectory() ? pages.get(relDocs === '' ? 'README.md' : `${relDocs}/README.md`) : pages.get(relDocs)
      if (page) return pageUrl(page) + tail
    }
    if (image && !inside(docs, target)) return fail('Referenced assets must stay inside docs/.')
    if (image || inside(docs, target) && stat.isFile() && !pages.has(relDocs)) {
      if (!stat.isFile()) return fail('Images must reference regular files.')
      try { return asset(target) + tail } catch (error) { return fail(error instanceof Error ? error.message : 'Invalid asset.') }
    }
    return `${repoUrl}/${stat.isDirectory() ? 'tree' : 'blob'}/${encodeURIComponent(options.branch)}/${urlPath(portable(relative(source, target)))}`.replace(/\/$/, '') + tail
  }
  const banner = '<!-- Generated from docs/ by cd.yml. Edit the main repository, not this page. -->\n\n'
  const titles = new Map<string, string>()
  for (const [name, page] of pages) {
    const current = resolve(docs, name)
    const data = readFileSync(current)
    try { validateMarkdown(data) } catch { throw new Error(`Invalid or sensitive Markdown content in docs/${name}.`) }
    const markdown = data.toString('utf8')
    const patches: Patch[] = []
    const root = fromMarkdown(markdown)
    const imageReferences = new Set<string>()
    function references(node: Nodes): void {
      if (node.type === 'imageReference') imageReferences.add(node.identifier)
      if ('children' in node) for (const child of node.children) references(child)
    }
    references(root)
    titles.set(name, markdown.match(/^#\s+(.+)$/m)?.[1] ?? name.replace(/\.(md|markdown)$/i, ''))
    function visit(node: Nodes): void {
      if (node.type === 'link' || node.type === 'image' || node.type === 'definition') {
        const range = offset(node)
        const segment = markdown.slice(range.start, range.end)
        // Absolute autolinks have no destination parentheses and already work unchanged.
        if (segment.startsWith('<')) { convert(node.url, current, false); return }
        const value = convert(node.url, current, node.type === 'image' || node.type === 'definition' && imageReferences.has(node.identifier))
        if (value !== node.url) {
          const local = destinationRange(segment, node.type === 'definition')
          patches.push({ start: range.start + local.start, end: range.start + local.end, value })
        }
      }
      if (node.type === 'html') throw new Error(`Raw HTML is not supported in docs/${name}; use Markdown links/images or fenced examples.`)
      if ('children' in node) for (const child of node.children) visit(child)
    }
    visit(root)
    let rendered = markdown
    for (const patch of patches.sort((a, b) => b.start - a.start)) rendered = rendered.slice(0, patch.start) + patch.value + rendered.slice(patch.end)
    output.set(`${page}.md`, Buffer.from(banner + rendered))
  }
  const navigation = ['**OptiCutList**', '', `[Documentation home](${pageUrl('Home')})`, '']
  const listed = new Set(['README.md'])
  const label = (text: string): string => text.replace(/[[\]\\]/g, '\\$&')
  for (const group of WIKI_NAVIGATION) {
    const available = group.pages.filter(([path]) => pages.has(path))
    if (!available.length) continue
    navigation.push(`### ${group.title}`, '')
    for (const [path, title] of available) {
      const page = pages.get(path)
      if (!page) continue
      navigation.push(`- [${label(title)}](${pageUrl(page)})`)
      listed.add(path)
    }
    navigation.push('')
  }
  // New/nested pages stay discoverable until their editorial placement is chosen.
  let previousGroup = ''
  for (const [name, page] of pages) {
    if (listed.has(name)) continue
    const group = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : 'More reference'
    if (group !== previousGroup) { navigation.push(`### ${label(group)}`, ''); previousGroup = group }
    navigation.push(`- [${label(titles.get(name) ?? name)}](${pageUrl(page)})`)
  }
  output.set('_Sidebar.md', Buffer.from(banner + navigation.join('\n') + '\n'))
  // Home is an authored portal, not a second copy of the entire sidebar.
  return output
}

/** Local generation only: no credentials, Git commit, clone, network request or push. */
export function syncWiki(options: WikiOptions): { changed: string[]; removed: string[] } {
  const source = resolve(options.source)
  const destination = resolve(options.destination)
  if (inside(source, destination) || inside(destination, source)) throw new Error('Wiki destination must be separate from the source checkout.')
  const output = buildWiki(options)
  let ancestor = destination
  for (;;) {
    // macOS supplies these root aliases; all application-controlled symlinks remain forbidden.
    if (lstatSync(ancestor, { throwIfNoEntry: false })?.isSymbolicLink() && !(['/var', '/tmp'].includes(ancestor) && realpathSync(ancestor) === `/private${ancestor}`)) throw new Error('Symbolic links are not supported in the destination path.')
    if (dirname(ancestor) === ancestor) break
    ancestor = dirname(ancestor)
  }
  safePath(destination, '')
  const manifestPath = safePath(destination, MANIFEST)
  const previous = existsSync(manifestPath) ? manifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8'))) : undefined
  if (previous && previous.repository !== options.repository) throw new Error('Wiki manifest belongs to another repository.')
  const priorFiles = previous?.files ?? {}
  if (Object.keys(priorFiles).some(name => !managed(name))) throw new Error('Unsafe managed path in Wiki manifest.')
  const next = Object.fromEntries([...output].map(([name, content]) => [name, hash(content)]))
  // Preflight all ownership, manual edits, symlinks and page collisions before writing anything.
  const existingPages = (existsSync(destination) ? files(destination) : []).filter(name => PAGE_EXTENSION.test(name))
  for (const name of new Set([...Object.keys(priorFiles), ...output.keys()])) {
    const path = safePath(destination, name)
    if (!managed(name)) throw new Error(`Unsafe output path: ${name}`)
    if (existsSync(path)) {
      if (!(name in priorFiles)) throw new Error(`Refusing to overwrite unmanaged Wiki file: ${name}. Move it before first publication.`)
      const actual = hash(readFileSync(path))
      if (actual !== priorFiles[name] && actual !== next[name]) throw new Error(`Managed Wiki file was edited manually: ${name}. Preserve the changes in docs/ or a manual page before publishing.`)
    }
    if (name.endsWith('.md')) {
      const canonical = pageIdentity(name)
      if (existingPages.some(file => pageIdentity(file) === canonical && file !== name && !(file in priorFiles))) throw new Error(`Wiki page conflicts with an unmanaged page: ${name}`)
    }
  }
  output.set(MANIFEST, Buffer.from(JSON.stringify({ version: 1, repository: options.repository, files: next }, null, 2) + '\n'))
  const removed = Object.keys(priorFiles).filter(name => !output.has(name)).sort()
  const changed: string[] = []
  for (const [name, content] of output) {
    const path = safePath(destination, name)
    if (existsSync(path) && readFileSync(path).equals(content)) continue
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
    changed.push(name)
  }
  for (const name of removed) {
    const path = safePath(destination, name)
    if (existsSync(path)) unlinkSync(path)
  }
  return { changed: changed.sort(), removed }
}
