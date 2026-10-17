import { parseArgs } from 'node:util'
import { buildWiki, syncWiki } from './publish.ts'

try {
  const { values } = parseArgs({
    options: {
      source: { type: 'string', default: '.' },
      destination: { type: 'string' },
      repository: { type: 'string' },
      branch: { type: 'string' },
      validate: { type: 'boolean', default: false },
    }
  })
  if ((!values.validate && !values.destination) || !values.repository || !values.branch) {
    throw new Error('Usage: node scripts/wiki/cli.ts (--validate | --destination /tmp/wiki-preview) --repository OWNER/REPO --branch DEFAULT_BRANCH [--source .]')
  }
  const options = { source: values.source, destination: values.destination ?? '', repository: values.repository, branch: values.branch }
  if (values.validate) {
    process.stdout.write(`Wiki files validated: ${String(buildWiki(options).size)}; no files written.\n`)
  } else {
    const result = syncWiki(options)
    process.stdout.write(`Wiki files changed: ${String(result.changed.length)}; obsolete managed files removed: ${String(result.removed.length)}\n`)
  }
} catch (error) {
  process.stderr.write(`Wiki generation failed: ${error instanceof Error ? error.message : 'Unknown error'}\n`)
  process.exitCode = 1
}
