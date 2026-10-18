import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { isBuiltin, stripTypeScriptTypes } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import ts from 'typescript'

const execute = promisify(execFile)
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const [version, output = join(repository, 'dist-standalone')] = process.argv.slice(2)

// CD owns SemVer eligibility; local package labels only need to be safe filenames.
if (!version || !/^[0-9A-Za-z][0-9A-Za-z.-]*$/.test(version)) {
  throw new Error('Supply a filename-safe version label, for example v1.1.0-beta.1.')
}
const backend = await readFile(join(repository, 'server-dist/main.js'), 'utf8')
const dependencies = ts.preProcessFile(backend, true).importedFiles.map(file => file.fileName)
if (dependencies.some(name => !isBuiltin(name) && name !== 'zod')) {
  throw new Error('The backend has a new external dependency. Update standalone runtime packaging before publishing.')
}
if ((await readFile(join(repository, 'dist-self-hosted/storage-mode.txt'), 'utf8')).trim() !== 'server') {
  throw new Error('Build the self-hosted frontend before packaging.')
}
const guide = await readFile(join(repository, 'docs/deployment.md'), 'utf8')
const heading = '### Standalone archive\n'
const guideStart = guide.indexOf(heading)
if (guideStart === -1) {
  throw new Error('Missing standalone installation guide.')
}
const guideEnd = guide.indexOf('\n### ', guideStart + heading.length)
const instructions = guide.slice(guideStart + heading.length, guideEnd === -1 ? undefined : guideEnd)

const temporary = await mkdtemp(join(tmpdir(), 'opticutlist-package-'))
try {
  const application = join(temporary, 'opticutlist')
  await mkdir(join(application, 'server-dist'), { recursive: true })
  await writeFile(join(application, 'server-dist/main.js'), backend)
  await cp(join(repository, 'dist-self-hosted'), join(application, 'dist-self-hosted'), {
    recursive: true,
    filter: path => !basename(path).startsWith('.'),
  })
  await cp(join(repository, 'node_modules/zod'), join(application, 'node_modules/zod'), {
    recursive: true,
    filter: path => basename(path) !== 'src' && !/\.(?:ts|mts|cts|map)$/.test(path),
  })
  const launcher = await readFile(join(repository, 'scripts/self-hosted/start.ts'), 'utf8')
  await writeFile(join(application, 'start.mjs'), stripTypeScriptTypes(launcher))
  await writeFile(join(application, 'package.json'), JSON.stringify({
    name: 'opticutlist-self-hosted', private: true, type: 'module', engines: { node: '>=24' },
  }, null, 2) + '\n')
  await cp(join(repository, 'LICENSE'), join(application, 'LICENSE'))
  await writeFile(join(application, 'VERSION'), version + '\n')
  await writeFile(join(application, 'README.md'), '# OptiCutList standalone\n' + instructions.replace(/^#### /gm, '## '))
  await mkdir(resolve(output), { recursive: true })
  const archive = join(resolve(output), `opticutlist-${version}-self-hosted.tar.gz`)
  await execute('tar', ['-czf', archive, '-C', temporary, 'opticutlist'])
  process.stdout.write(`Standalone archive: ${archive}\n`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
