import { parseArgs } from 'node:util'
import { syncWiki } from './publish.ts'

try {
  const { values } = parseArgs({ options: {
    source: { type: 'string', default: '.' },
    destination: { type: 'string' },
    repository: { type: 'string' },
    branch: { type: 'string' },
  } })
  if (!values.destination || !values.repository || !values.branch) throw new Error('Usage: node scripts/wiki/cli.ts --destination /tmp/wiki-preview --repository OWNER/REPO --branch DEFAULT_BRANCH [--source .]')
  const result = syncWiki({ source: values.source, destination: values.destination, repository: values.repository, branch: values.branch })
  process.stdout.write(`Wiki files changed: ${String(result.changed.length)}; obsolete managed files removed: ${String(result.removed.length)}\n`)
} catch (error) {
  process.stderr.write(`Wiki generation failed: ${error instanceof Error ? error.message : 'Unknown error'}\n`)
  process.exitCode = 1
}
