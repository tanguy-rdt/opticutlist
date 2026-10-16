import { describe, expect, it } from 'vitest'
import { cuttingProjectSchema } from '../cutting-project'

const record = { id: 'cabinet-project', name: ' Cabinet ', partIds: ['side'], materialIds: ['birch'], supplierProductIds: ['panel'] }
describe('CuttingProject', () => {
  it('validates a named project and its stable catalog and Part references', () => {
    expect(cuttingProjectSchema.parse(record)).toEqual({ ...record, name: 'Cabinet' })
  })
  it('accepts missing/empty descriptions, trims text and rejects invalid descriptions', () => {
    expect(cuttingProjectSchema.parse(record)).not.toHaveProperty('description')
    expect(cuttingProjectSchema.parse({ ...record, description: '  ' }).description).toBe('')
    expect(cuttingProjectSchema.parse({ ...record, description: ' A cabinet.\nSecond line. ' }).description).toBe('A cabinet.\nSecond line.')
    for (const description of [null, 42, 'x'.repeat(2001)]) expect(cuttingProjectSchema.safeParse({ ...record, description }).success).toBe(false)
  })
  it.each(['partIds', 'materialIds', 'supplierProductIds', 'stockItemIds'])('rejects duplicate, blank and malformed %s rather than discarding them', field => {
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
    expect(cuttingProjectSchema.parse(record)).not.toHaveProperty('stockItemIds')
    expect(cuttingProjectSchema.parse({ ...record, stockItemIds: ['owned'] }).stockItemIds).toEqual(['owned'])
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


describe('saved technical cutting settings', () => {
  it('preserves legacy records and validates optional kerf and margin settings', () => {
    expect(cuttingProjectSchema.parse(record)).not.toHaveProperty('cuttingSettings')
    expect(cuttingProjectSchema.parse({ ...record, cuttingSettings: { kerfMm: 2.5, edgeMarginMm: 5 } }).cuttingSettings).toEqual({ kerfMm: 2.5, edgeMarginMm: 5 })
    for (const cuttingSettings of [{ kerfMm: -1, edgeMarginMm: 0 }, { kerfMm: '', edgeMarginMm: 0 }, { kerfMm: 1 }, { kerfMm: 1, edgeMarginMm: Infinity }]) expect(cuttingProjectSchema.safeParse({ ...record, cuttingSettings }).success).toBe(false)
  })
})
