import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createSelfHostedServer } from './http'

if (Number(process.versions.node.split('.')[0]) < 24) {
  throw new Error('Self-hosted OptiCutList requires Node.js 24 or newer.')
}
const host = process.env.OCL_HOST ?? '127.0.0.1'
const port = Number(process.env.OCL_PORT ?? '3000')
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
  throw new Error('OCL_PORT must be between 1 and 65535.')
}
if (!['127.0.0.1', '::1'].includes(host) && !process.env.OCL_ORIGIN) {
  throw new Error('Set OCL_ORIGIN explicitly before binding beyond loopback.')
}
const frontendPath = resolve(process.env.OCL_FRONTEND_PATH ?? 'dist-self-hosted')
if (readFileSync(resolve(frontendPath, 'storage-mode.txt'), 'utf8').trim() !== 'server') {
  throw new Error('Build the server-mode frontend with npm run build:self-hosted before starting.')
}
const origin = process.env.OCL_ORIGIN ?? `http://${host === '::1' ? '[::1]' : host}:${String(port)}`
const app = createSelfHostedServer({
  databasePath: resolve(process.env.OCL_DATABASE_PATH ?? 'data/opticutlist.sqlite'),
  frontendPath,
  origin,
})
app.server.listen(port, host, () => {
  process.stdout.write(`OptiCutList shared, unauthenticated instance: ${origin}/opticutlist/\nTrusted LAN/VPN use only.\n`)
})
let closing = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (closing) {
      return
    }
    closing = true
    void app.close().catch(() => {
      process.exitCode = 1
    })
  })
}
