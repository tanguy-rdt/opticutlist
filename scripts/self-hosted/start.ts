import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

if (Number(process.versions.node.split('.')[0]) < 24) {
  throw new Error('Install Node.js 24 or newer to run OptiCutList.')
}

const installation = realpathSync(dirname(fileURLToPath(import.meta.url)))
const database = resolve(process.env.OCL_DATABASE_PATH ?? join(homedir(), '.opticutlist', 'opticutlist.sqlite'))

// Resolve existing ancestors too, so a symlink cannot put persistent data in the installation.
let ancestor = database
const missing: string[] = []
while (!existsSync(ancestor)) {
  missing.unshift(basename(ancestor))
  ancestor = dirname(ancestor)
}
const physicalDatabase = resolve(realpathSync(ancestor), ...missing)
const location = relative(installation, physicalDatabase)
if (location === '' || (!isAbsolute(location) && location !== '..' && !location.startsWith(`..${sep}`))) {
  throw new Error('OCL_DATABASE_PATH must be outside the extracted OptiCutList installation directory.')
}

process.env.OCL_DATABASE_PATH = database
process.env.OCL_FRONTEND_PATH ??= join(installation, 'dist-self-hosted')
await import(new URL('./server-dist/main.js', import.meta.url).href)
