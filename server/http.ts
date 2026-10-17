import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { existsSync, realpathSync } from 'node:fs'
import { resolve, relative, sep, extname, dirname } from 'node:path'
import { z } from 'zod'
import { createSqlitePersistence } from './sqlite'
import { createHandlers } from './operations'
import { createStorageServices } from '../src/application/storage/services'
import { projectJson } from '../src/infrastructure/projects/project-json'
import type { PersistenceResult } from '../src/application/persistence/repositories'

const MAX_BODY = 16 * 1024 * 1024
const requestKey = z.string().regex(/^[A-Za-z0-9-]{1,128}$/)
const mime: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}
class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}
function inside(root: string, path: string): boolean {
  const child = relative(root, path)
  return child === '' || child !== '..' && !child.startsWith(`..${sep}`) && !child.startsWith(sep)
}
// Resolve existing parents too, so a symlinked data directory cannot target public assets.
function physicalPath(path: string): string {
  let parent = path
  while (!existsSync(parent)) {
    parent = dirname(parent)
  }
  return resolve(realpathSync(parent), relative(parent, path))
}
async function body(req: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) {
    throw new HttpError(415, 'Use application/json.')
  }
  if (Number(req.headers['content-length']) > MAX_BODY) {
    throw new HttpError(413, 'Request exceeds 16 MiB.')
  }
  let size = 0
  const chunks: Buffer[] = []
  for await (const input of req) {
    const chunk: unknown = input
    if (!Buffer.isBuffer(chunk)) {
      throw new HttpError(400, 'Invalid request stream.')
    }
    size += chunk.length
    if (size > MAX_BODY) {
      throw new HttpError(413, 'Request exceeds 16 MiB.')
    }
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new HttpError(400, 'Invalid JSON request.')
  }
}
function send(res: ServerResponse, status: number, result: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(result))
}
function resultStatus(result: PersistenceResult<unknown>): number {
  if (result.ok) {
    return 200
  }
  if (result.error.kind === 'storageFailure') {
    return 503
  }
  if (result.error.kind === 'notFound') {
    return 404
  }
  if (result.error.kind === 'invalidRecord') {
    return 400
  }
  return 409
}

export function createSelfHostedServer(options: { databasePath: string; frontendPath: string; origin?: string }) {
  const root = resolve(options.frontendPath)
  const database = resolve(options.databasePath)
  if ([root, ...['dist', 'dist-self-hosted', 'server-dist'].map(dir => resolve(dir))]
    .some(directory => inside(physicalPath(directory), physicalPath(database)))) {
    throw new Error('SQLite must be outside frontend assets and generated build directories.')
  }
  if (options.origin && new URL(options.origin).origin !== options.origin) {
    throw new Error('OCL_ORIGIN must be an exact HTTP(S) origin without a path.')
  }
  if (options.origin && !/^https?:\/\//.test(options.origin)) {
    throw new Error('OCL_ORIGIN must use HTTP(S).')
  }

  const storage = createSqlitePersistence(database)
  const services = createStorageServices(storage.persistence, projectJson)
  const handlers = createHandlers(services)

  const server = createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'SAMEORIGIN')
    res.setHeader('Referrer-Policy', 'same-origin')
    void handle(req, res).catch((error: unknown) => {
      if (res.headersSent) {
        res.destroy()
        return
      }
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof HttpError ? error.message : 'Server storage operation failed.'
      send(res, status, {
        ok: false,
        error: {
          kind: status >= 500 ? 'storageFailure' : 'invalidRecord',
          ...(status >= 500 ? { message } : { issues: [{ path: ['request'], message }] })
        }
      })
    })
  })
  server.requestTimeout = 30_000
  server.headersTimeout = 15_000
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new HttpError(503, 'Server is not listening.')
    }
    const origin = options.origin ?? `http://127.0.0.1:${String(address.port)}`
    if (req.headers.host !== new URL(origin).host) {
      throw new HttpError(403, 'Unrecognized request host.')
    }
    if ((req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') {
      throw new HttpError(403, 'Cross-origin requests are not allowed.')
    }
    const url = new URL(req.url ?? '/', origin)
    if (url.pathname === '/api/v1/health' && req.method === 'GET') {
      send(res, 200, { status: 'ok', storage: 'sqlite', schemaVersion: 1 })
      return
    }
    if (url.pathname.startsWith('/api/')) {
      const operation = url.pathname.slice('/api/v1/'.length)
      if (!url.pathname.startsWith('/api/v1/') || !Object.hasOwn(handlers, operation)) {
        throw new HttpError(404, 'Unknown API operation.')
      }
      const handler = handlers[operation]
      if (!handler || handler.method !== req.method) {
        throw new HttpError(405, 'Method not allowed.')
      }
      if (req.method !== 'GET' && req.headers['x-opticutlist'] !== '1') {
        throw new HttpError(403, 'Missing application request header.')
      }
      let args: unknown
      if (req.method === 'GET') {
        const query = url.searchParams.get('args') ?? '[]'
        if (query.length > 8192) {
          throw new HttpError(414, 'Query is too large.')
        }
        try {
          args = JSON.parse(query) as unknown
        } catch {
          throw new HttpError(400, 'Invalid query arguments.')
        }
      } else {
        args = await body(req)
      }
      let result: PersistenceResult<unknown>
      if (req.method === 'GET') {
        result = await handler.execute(args)
      } else {
        const key = requestKey.safeParse(req.headers['idempotency-key'])
        if (!key.success) {
          throw new HttpError(400, 'Provide a valid Idempotency-Key header.')
        }
        const hash = createHash('sha256').update(`${handler.method}\n${operation}\n${JSON.stringify(args)}`).digest('hex')
        result = await storage.command(key.data, hash, () => handler.execute(args))
      }
      send(res, resultStatus(result), result)
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      throw new HttpError(405, 'Method not allowed.')
    }
    if (url.pathname === '/' || url.pathname === '/opticutlist') {
      res.writeHead(302, { Location: '/opticutlist/' })
      res.end()
      return
    }
    if (!url.pathname.startsWith('/opticutlist/')) {
      throw new HttpError(404, 'Not found.')
    }
    let name: string
    try {
      name = decodeURIComponent(url.pathname.slice('/opticutlist/'.length)) || 'index.html'
    } catch {
      throw new HttpError(400, 'Invalid asset path.')
    }
    if (name.includes('\\') || name.includes('\0') || name.split('/').some(part => part.startsWith('.') || part === '..')) {
      throw new HttpError(404, 'Not found.')
    }
    const file = resolve(root, name)
    if (!inside(root, file) || !mime[extname(file)]) {
      throw new HttpError(404, 'Not found.')
    }
    let actual: string
    try {
      actual = await realpath(file)
    } catch {
      throw new HttpError(404, 'Frontend asset missing. Build the self-hosted application first.')
    }
    if (!inside(await realpath(root), actual) || !(await stat(actual)).isFile()) {
      throw new HttpError(404, 'Not found.')
    }
    const data = await readFile(actual)
    res.writeHead(200, {
      'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Content-Length': data.length
    })
    res.end(req.method === 'HEAD' ? undefined : data)
  }
  return {
    server,
    services,
    close: () => new Promise<void>((resolveClose, reject) => {
      server.close(error => {
        storage.persistence.close()
        if (error) {
          reject(error)
        } else {
          resolveClose()
        }
      })
    })
  }
}
