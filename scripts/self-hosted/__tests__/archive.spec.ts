// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const repository = process.cwd()
let temporary: string
let installation: string
let archive: string
let port: number
let child: ChildProcess | undefined

async function stop() {
  if (!child || child.exitCode !== null) {
    child = undefined
    return
  }
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  expect(await exited).toEqual([0, null])
  child = undefined
}
async function start(directory: string, database?: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: join(temporary, 'home'), OCL_HOST: '127.0.0.1', OCL_PORT: String(port), OCL_ORIGIN: `http://127.0.0.1:${String(port)}` }
  delete env.OCL_DATABASE_PATH
  delete env.OCL_FRONTEND_PATH
  if (database) env.OCL_DATABASE_PATH = database
  child = spawn(process.execPath, [join(directory, 'start.mjs')], { cwd: temporary, env, stdio: ['ignore', 'pipe', 'pipe'] })
  if (!child.stdout) throw new Error('Missing server stdout')
  const exited = once(child, 'exit')
  await Promise.race([
    once(child.stdout, 'data'),
    exited.then(() => { throw new Error('Extracted server failed to start') }),
  ])
}

beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'ocl-archive-test-'))
  const listener = createServer()
  listener.listen(0, '127.0.0.1')
  await once(listener, 'listening')
  const address = listener.address()
  if (!address || typeof address === 'string') throw new Error('Missing test port')
  port = address.port
  await new Promise<void>(resolve => listener.close(() => { resolve() }))
  archive = process.env.OCL_TEST_ARCHIVE ?? join(temporary, 'archives/opticutlist-v0.0.0-smoke.1-self-hosted.tar.gz')
  if (!process.env.OCL_TEST_ARCHIVE) {
    await execute('npm', ['run', 'package:self-hosted', '--', 'v0.0.0-smoke.1', join(temporary, 'archives')], { cwd: repository, timeout: 60000 })
  }
  await mkdir(join(temporary, 'first'))
  await execute('tar', ['-xzf', archive, '-C', join(temporary, 'first')])
  installation = join(temporary, 'first/opticutlist')
}, 60000)

afterAll(async () => {
  await stop()
  if (temporary) await rm(temporary, { recursive: true, force: true })
})

describe('standalone archive', () => {
  it('runs independently, serves frontend/API and retains SQLite data after restart and installation replacement', async () => {
    expect(await readdir(join(installation, 'node_modules'))).toEqual(['zod'])
    expect(existsSync(join(installation, 'node_modules/zod/LICENSE'))).toBe(true)
    const version = (await readFile(join(installation, 'VERSION'), 'utf8')).trim()
    expect(archive.endsWith(`opticutlist-${version}-self-hosted.tar.gz`)).toBe(true)
    expect((await readFile(join(installation, 'README.md'), 'utf8'))).toContain('node start.mjs')
    const files = await execute('tar', ['-tzf', archive])
    expect(files.stdout).not.toMatch(/\.(?:node|sqlite|ts|mts|cts)\n/)
    expect(files.stdout).not.toContain('/data/')
    await start(installation)
    const origin = `http://127.0.0.1:${String(port)}`
    expect((await fetch(origin + '/api/v1/health')).status).toBe(200)
    const html = await (await fetch(origin + '/opticutlist/')).text()
    expect(html).toContain('OptiCutList')
    for (const asset of html.matchAll(/(?:src|href)="(\/opticutlist\/[^"#]+)"/g)) {
      expect((await fetch(origin + asset[1])).status).toBe(200)
    }
    const material = { id: 'archive-material', name: 'Archive material', category: 'Panels' }
    const response = await fetch(origin + '/api/v1/catalog/materials/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-OptiCutList': '1', 'Idempotency-Key': 'archive-smoke' },
      body: JSON.stringify([material]),
    })
    expect(response.status).toBe(200)
    await stop()
    expect(existsSync(join(temporary, 'home/.opticutlist/opticutlist.sqlite'))).toBe(true)
    expect(existsSync(join(installation, 'data'))).toBe(false)
    await mkdir(join(temporary, 'replacement'))
    await execute('tar', ['-xzf', archive, '-C', join(temporary, 'replacement')])
    await start(join(temporary, 'replacement/opticutlist'))
    const restored = await (await fetch(origin + '/api/v1/catalog/materials/get?args=' + encodeURIComponent(JSON.stringify([material.id])))).json() as unknown
    expect(restored).toEqual({ ok: true, value: material })
    await stop()
    const custom = join(temporary, 'custom-data/panels.sqlite')
    await start(installation, custom)
    expect((await fetch(origin + '/api/v1/health')).status).toBe(200)
    await stop()
    expect(existsSync(custom)).toBe(true)
  }, 30000)

  it('rejects persistent data inside the installation, including symlink aliases', async () => {
    const link = join(temporary, 'installation-link')
    await symlink(installation, link, 'dir')
    for (const database of [join(installation, 'data.sqlite'), join(link, 'data.sqlite')]) {
      await expect(execute(process.execPath, [join(installation, 'start.mjs')], {
        cwd: temporary, env: { ...process.env, OCL_DATABASE_PATH: database }, timeout: 10000,
      })).rejects.toThrow('must be outside')
      expect(existsSync(database)).toBe(false)
    }
  })

  it('rejects unsafe archive labels without creating an output', async () => {
    await expect(execute(process.execPath, ['scripts/self-hosted/package.ts', '../escape', join(temporary, 'unsafe')], { cwd: repository })).rejects.toThrow()
    expect(existsSync(join(temporary, 'unsafe'))).toBe(false)
  })
})
