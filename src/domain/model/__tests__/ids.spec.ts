import { describe, expect, it } from 'vitest'

import { materialIdSchema, partIdSchema, stockItemIdSchema, supplierIdSchema, supplierProductIdSchema } from '../ids'
import type { MaterialId, PartId } from '../ids'

const idSchemas = {
  materialIdSchema,
  partIdSchema,
  supplierIdSchema,
  supplierProductIdSchema,
  stockItemIdSchema,
}

describe.each(Object.entries(idSchemas))('%s', (_name, schema) => {
  it.each(['a', 'mat-birch-18', '0b9a8f7e-3c2d-4e1f-9a8b-7c6d5e4f3a2b', 'x'.repeat(128)])(
    'accepts %s',
    (id) => {
      expect(schema.parse(id)).toBe(id)
    },
  )

  it.each(['', ' ', 'has space', ' leading', 'trailing ', 'tab\tinside', 'line\nbreak', 'x'.repeat(129)])(
    'rejects %j',
    (id) => {
      expect(schema.safeParse(id).success).toBe(false)
    },
  )

  it.each([null, undefined, 42, {}, []])('rejects non-string %o', (id) => {
    expect(schema.safeParse(id).success).toBe(false)
  })
})

describe('branded IDs', () => {
  it('cannot be used interchangeably at compile time', () => {
    const partId: PartId = partIdSchema.parse('same-value')
    // @ts-expect-error A PartId is not a MaterialId even with the same string value.
    const materialId: MaterialId = partId
    // @ts-expect-error Plain strings must be validated before being used as IDs.
    const unvalidated: MaterialId = 'mat-1'

    expect([materialId, unvalidated]).toEqual(['same-value', 'mat-1'])
  })
})
