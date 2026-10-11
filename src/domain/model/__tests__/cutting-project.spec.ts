import { describe, expect, it } from 'vitest'
import { cuttingProjectSchema } from '../cutting-project'

const record = { id: 'cabinet-project', name: ' Cabinet ', partIds: ['side'], materialIds: ['birch'], supplierProductIds: ['panel'] }
describe('CuttingProject', () => {
  it('validates a named project and its stable catalog and Part references', () => {
    expect(cuttingProjectSchema.parse(record)).toEqual({ ...record, name: 'Cabinet' })
  })
  it.each(['partIds', 'materialIds', 'supplierProductIds'])('rejects duplicate, blank and malformed %s rather than discarding them', field => {
    for (const ids of [['same', 'same'], [''], ['has space'], [1], null]) {
      expect(cuttingProjectSchema.safeParse({ ...record, [field]: ids }).success).toBe(false)
    }
  })
  it('requires a valid ID, name and explicit associations and rejects unknown properties', () => {
    for (const invalid of [{ ...record, id: '' }, { ...record, name: ' ' }, { ...record, partIds: undefined }, { ...record, extra: true }]) {
      expect(cuttingProjectSchema.safeParse(invalid).success).toBe(false)
    }
  })
})

describe('project panel quantities', () => {
  it('accepts legacy records unchanged and explicit zero/non-negative safe quantities', () => {
    expect(cuttingProjectSchema.parse(record)).not.toHaveProperty('panelQuantities')
    expect(cuttingProjectSchema.parse({ ...record, panelQuantities: [{ supplierProductId: 'panel', quantity: 0 }] }).panelQuantities).toEqual([{ supplierProductId: 'panel', quantity: 0 }])
  })
  it('rejects unknown/unselected or duplicate references and invalid quantity values', () => {
    for (const quantity of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null]) expect(cuttingProjectSchema.safeParse({ ...record, panelQuantities: [{ supplierProductId: 'panel', quantity }] }).success).toBe(false)
    for (const panelQuantities of [
      [{ supplierProductId: 'unselected', quantity: 1 }],
      [{ supplierProductId: 'panel', quantity: 1 }, { supplierProductId: 'panel', quantity: 2 }],
      [{ supplierProductId: 'panel', quantity: 1, stock: true }],
    ]) expect(cuttingProjectSchema.safeParse({ ...record, panelQuantities }).success).toBe(false)
  })
})
