/** Filesystem-safe, readable names for the two project JSON downloads. */
export function projectFilename(name: string, kind: 'project' | 'parts'): string {
  const normalized = name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100).replace(/_+$/g, '')
  const stem = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(normalized) ? `project_${normalized}` : normalized || 'project'
  return `${stem}.ocl${kind}.json`
}
