import { describe, expect, it } from 'vitest'
import { projectFilename } from '../project-filename'
describe('project JSON filenames', () => {
  it.each([
    ['Kitchen Cabinet', 'kitchen_cabinet'], ['Meuble TV', 'meuble_tv'], ['Étagère Salon', 'etagere_salon'],
    ['  Desk---/\\:*?"<>|   top__  ', 'desk_top'], ['Œuvre & façade', 'oeuvre_facade'], ['', 'project'], [' . / ', 'project'], ['CON', 'project_con'],
  ])('normalizes %j consistently for both exports', (name, stem) => {
    expect(projectFilename(name, 'project')).toBe(`${stem}.oclproject.json`)
    expect(projectFilename(name, 'parts')).toBe(`${stem}.oclparts.json`)
  })
})
