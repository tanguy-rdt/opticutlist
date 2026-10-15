/** Filesystem-safe, readable names for full project JSON downloads. */
export function projectFilename(name: string): string {
  const normalized = name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100).replace(/_+$/g, '')
  const stem = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(normalized) ? `project_${normalized}` : normalized || 'project'
  return `${stem}.oclproject.json`
}
