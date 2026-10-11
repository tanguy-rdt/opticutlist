import type { ProjectJsonPort } from '../../application/projects/project-transfer-format'
/** UTF-8 browser Blobs encode this readable JSON; strict schemas/validators live in application. */
export const projectJson: ProjectJsonPort = {
  parse(text) { const value: unknown = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); return value },
  stringify(file) { return `${JSON.stringify(file, null, 2)}\n` },
}
