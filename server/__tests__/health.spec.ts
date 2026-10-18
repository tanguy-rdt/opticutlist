// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { get, type IncomingMessage } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { createSelfHostedServer } from '../http'
import { createSqlitePersistence } from '../sqlite'

const execute = promisify(execFile)

// Exercise the actual image probe, including its internal-port/external-Host handling.
async function dockerProbe(port: number, origin?: string) {
  const dockerfile = await readFile('docker/Dockerfile', 'utf8')
  const configuredOrigin = origin ?? dockerfile.match(/OCL_ORIGIN=(\S+)/)?.[1]
  if (!configuredOrigin) throw new Error('Missing Docker default origin')
  const command = dockerfile.match(/HEALTHCHECK[^\n]*\\\n\s+CMD (\[[^\n]+\])/)
  if (!command?.[1]) throw new Error('Missing Docker healthcheck')
  const args = z.tuple([z.literal('node'), z.literal('--input-type=module'), z.literal('-e'), z.string()]).parse(JSON.parse(command[1]))
  return execute(process.execPath, args.slice(1), {
    env: { OCL_PORT: String(port), OCL_ORIGIN: configuredOrigin }, timeout: 6000,
  })
}

describe('SQLite-backed readiness', () => {
  it('supports the image defaults without user environment variables and keeps origin protection', async () => {
    const dockerfile = await readFile('docker/Dockerfile', 'utf8')
    expect(dockerfile).toContain('OCL_PORT=3000')
    expect(dockerfile).toContain('OCL_DATABASE_PATH=/data/opticutlist.sqlite')
    expect(dockerfile).toContain('USER node')
    const origin = dockerfile.match(/OCL_ORIGIN=(\S+)/)?.[1]
    expect(origin).toBe('http://localhost:3000')
    if (!origin) throw new Error('Missing Docker default origin')
    const directory = await mkdtemp(join(tmpdir(), 'ocl-default-health-'))
    const frontendPath = join(directory, 'frontend')
    await mkdir(frontendPath)
    const app = createSelfHostedServer({ databasePath: join(directory, 'data/opticutlist.sqlite'), frontendPath, origin })
    try {
      await new Promise<void>(resolve => { app.server.listen(0, '127.0.0.1', resolve) })
      const address = app.server.address()
      if (!address || typeof address === 'string') throw new Error('Missing listener')
      await expect(dockerProbe(address.port)).resolves.toMatchObject({ stdout: '' })
      const url = `http://127.0.0.1:${String(address.port)}/api/v1/health`
      expect((await fetch(url)).status).toBe(403)
      for (const headers of [{ Origin: 'https://untrusted.invalid' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
        const crossOrigin = await new Promise<IncomingMessage>((resolve, reject) => {
          const request = get(url, { headers: { Host: 'localhost:3000', ...headers } }, response => {
            response.resume()
            resolve(response)
          })
          request.on('error', reject)
        })
        expect(crossOrigin.statusCode).toBe(403)
        expect(crossOrigin.headers['access-control-allow-origin']).toBeUndefined()
      }
    } finally {
      await app.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('returns a typed storage failure after the database closes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ocl-closed-health-'))
    const storage = createSqlitePersistence(join(directory, 'data.sqlite'))
    try {
      await expect(storage.persistence.open()).resolves.toEqual({ ok: true, value: undefined })
      storage.persistence.close()
      await expect(storage.persistence.open()).resolves.toEqual({
        ok: false,
        error: { kind: 'storageFailure', message: 'Server database is closed.' },
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('checks the database, hides failure details and supports Docker port mapping without weakening origin checks', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ocl-health-'))
    const frontendPath = join(directory, 'frontend')
    await mkdir(frontendPath)
    await writeFile(join(frontendPath, 'index.html'), '<title>Readiness test</title>')
    const databasePath = join(directory, 'data.sqlite')
    const origin = 'https://workshop.invalid:8443'
    const app = createSelfHostedServer({ databasePath, frontendPath, origin })
    await new Promise<void>((resolve, reject) => {
      app.server.once('error', reject)
      app.server.listen(0, '127.0.0.1', resolve)
    })
    const address = app.server.address()
    if (!address || typeof address === 'string') throw new Error('Missing listener')
    const port = address.port
    const inspect = new DatabaseSync(databasePath)
    async function health() {
      return new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
        const request = get({ hostname: '127.0.0.1', port, path: '/api/v1/health', headers: { Host: new URL(origin).host } }, response => {
          const chunks: Buffer[] = []
          response.on('data', (chunk: Buffer) => { chunks.push(chunk) })
          response.on('end', () => { resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }) })
        })
        request.on('error', reject)
      })
    }
    try {
      const healthy = await health()
      expect(healthy.status).toBe(200)
      expect(JSON.parse(healthy.body)).toEqual({ status: 'ok', storage: 'sqlite', schemaVersion: 1 })
      await expect(dockerProbe(port, origin)).resolves.toMatchObject({ stdout: '' })
      expect((await fetch(`http://127.0.0.1:${String(port)}/api/v1/health`)).status).toBe(403)
      inspect.exec('DROP TABLE schema_migrations')
      const unavailable = await health()
      expect(unavailable.status).toBe(503)
      expect(JSON.parse(unavailable.body)).toEqual({ status: 'unavailable' })
      expect(unavailable.body).not.toContain(databasePath)
      expect(unavailable.body).not.toContain('schema_migrations')
      await expect(dockerProbe(port, origin)).rejects.toMatchObject({ code: 1 })
      inspect.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, appliedAt TEXT NOT NULL) STRICT; INSERT INTO schema_migrations VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
      expect((await health()).status).toBe(200)
      await expect(dockerProbe(port, origin)).resolves.toMatchObject({ stdout: '' })
    } finally {
      inspect.close()
      await app.close()
      await rm(directory, { recursive: true, force: true })
    }
    await expect(dockerProbe(port, origin)).rejects.toMatchObject({ code: 1 })
  })
})
