import { describe, expect, it } from 'vitest'

import { stockItemSchema } from '../stock-item'
import {
  dimensionKeys,
  invalidDimensionValues,
  invalidQuantityValues,
  validStockItemInput,
  without,
} from './fixtures'

describe('stockItemSchema', () => {
  it('accepts a valid stock item', () => {
    expect(stockItemSchema.parse(validStockItemInput)).toEqual(validStockItemInput)
  })

  it.each(['id', 'kind', 'materialId', 'quantity', 'grainDirection', 'provenance'] as const)('requires %s', (key) => {
    expect(stockItemSchema.safeParse(without(validStockItemInput, key)).success).toBe(false)
  })

  describe.each(dimensionKeys)('%s', (key) => {
    it('is mandatory', () => {
      expect(stockItemSchema.safeParse(without(validStockItemInput, key)).success).toBe(false)
    })

    it.each(invalidDimensionValues)('rejects %o', (value) => {
      expect(stockItemSchema.safeParse({ ...validStockItemInput, [key]: value }).success).toBe(false)
    })
  })

  it.each(invalidQuantityValues)('rejects quantity %o', (quantity) => {
    expect(stockItemSchema.safeParse({ ...validStockItemInput, quantity }).success).toBe(false)
  })

  it.each(['fullPanel', 'offcut'])('accepts kind %s', (kind) => {
    expect(stockItemSchema.safeParse({ ...validStockItemInput, kind }).success).toBe(true)
  })

  it.each(['panel', 'scrap', ''])('rejects kind %j', (kind) => {
    expect(stockItemSchema.safeParse({ ...validStockItemInput, kind }).success).toBe(false)
  })

  describe('provenance', () => {
    it('accepts a purchase linked to a supplier product', () => {
      const provenance = { source: 'purchase', supplierProductId: 'prod-birch-18-2500x1250' }

      expect(stockItemSchema.parse({ ...validStockItemInput, provenance }).provenance).toEqual(provenance)
    })

    it.each([
      { source: 'purchase' },
      { source: 'purchase', supplierProductId: '' },
      { source: 'manual', supplierProductId: 'prod-1' },
      { source: 'gift' },
      {},
      'manual',
      null,
    ])('rejects %o', (provenance) => {
      expect(stockItemSchema.safeParse({ ...validStockItemInput, provenance }).success).toBe(false)
    })
  })

  it('rejects catalog-only fields: owned stock is not a supplier product', () => {
    expect(stockItemSchema.safeParse({ ...validStockItemInput, price: 10 }).success).toBe(false)
    expect(stockItemSchema.safeParse({ ...validStockItemInput, supplierId: 'sup-1' }).success).toBe(false)
  })
})
