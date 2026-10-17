import { projectFilename } from './project-filename'

export function downloadJson(text: string, name: string, extension: 'pocl' | 'cocl' | 'oclproject.json' | 'oclstock.json'): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a')
  try {
    link.href = url
    link.download = extension === 'oclproject.json' ? projectFilename(name) : `${name.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 100) || 'opticutlist'}.${extension}`
    document.body.append(link);
    link.click()
  } finally {
    link.remove();
    window.setTimeout(() => {
      URL.revokeObjectURL(url)
    }, 1000)
  }
}
