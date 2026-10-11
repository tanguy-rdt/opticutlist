import { describe, expect, it } from 'vitest'

import { materialSchema } from '../material'
import { validMaterialInput, without } from './fixtures'

describe('materialSchema', () => {
  it('accepts a valid material', () => {
    expect(materialSchema.parse(validMaterialInput)).toEqual(validMaterialInput)
  })

  it('accepts optional stable preset metadata without altering legacy records', () => {
    expect(materialSchema.parse({ ...validMaterialInput, libraryPresetId: 'pin' }).libraryPresetId).toBe('pin')
    expect(materialSchema.parse(validMaterialInput)).not.toHaveProperty('libraryPresetId')
    for (const libraryPresetId of ['', 'invalid id', null, 12]) expect(materialSchema.safeParse({ ...validMaterialInput, libraryPresetId }).success).toBe(false)
    expect(materialSchema.safeParse({ ...validMaterialInput, image: 'binary' }).success).toBe(false)
  })

  it('trims name and category', () => {
    const material = materialSchema.parse({ ...validMaterialInput, name: '  MDF  ', category: ' Boards ' })

    expect(material.name).toBe('MDF')
    expect(material.category).toBe('Boards')
  })

  it.each(['id', 'name', 'category'] as const)('requires %s', (key) => {
    expect(materialSchema.safeParse(without(validMaterialInput, key)).success).toBe(false)
  })

  it.each(['', '   ', 'x'.repeat(201)])('rejects invalid name %j', (name) => {
    expect(materialSchema.safeParse({ ...validMaterialInput, name }).success).toBe(false)
  })

  it('does not carry a thickness: thickness belongs to physical items', () => {
    expect(materialSchema.safeParse({ ...validMaterialInput, thicknessMm: 18 }).success).toBe(false)
  })
})
