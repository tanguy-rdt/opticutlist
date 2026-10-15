import { describe, expect, it } from 'vitest'

import { supplierProductSchema } from '../supplier-product'
import { dimensionKeys, invalidDimensionValues, validSupplierProductInput, without } from './fixtures'

describe('supplierProductSchema', () => {
  it('accepts a valid supplier product', () => {
    expect(supplierProductSchema.parse(validSupplierProductInput)).toEqual(validSupplierProductInput)
  })

  it('accepts a missing price without substituting zero', () => {
    const product = supplierProductSchema.parse(without(validSupplierProductInput, 'price'))
    expect(product).not.toHaveProperty('price')
    expect(product.currency).toBe('EUR')
  })

  it('accepts a product without URL', () => {
    expect(supplierProductSchema.safeParse(without(validSupplierProductInput, 'productUrl')).success).toBe(true)
  })

  it.each([
    'id',
    'supplierId',
    'materialId',
    'name',
    'grainDirection',
    'currency',
    'availability',
  ] as const)('requires %s', (key) => {
    expect(supplierProductSchema.safeParse(without(validSupplierProductInput, key)).success).toBe(false)
  })

  describe.each(dimensionKeys)('%s', (key) => {
    it('is mandatory', () => {
      expect(supplierProductSchema.safeParse(without(validSupplierProductInput, key)).success).toBe(false)
    })

    it.each(invalidDimensionValues)('rejects %o', (value) => {
      expect(supplierProductSchema.safeParse({ ...validSupplierProductInput, [key]: value }).success).toBe(false)
    })
  })

  it.each([0, 0.01, 12.5, 100000])('accepts price %d', (price) => {
    expect(supplierProductSchema.safeParse({ ...validSupplierProductInput, price }).success).toBe(true)
  })

  it.each([-0.01, -1, Number.NaN, Number.POSITIVE_INFINITY, '89.90', null])('rejects price %o', (price) => {
    expect(supplierProductSchema.safeParse({ ...validSupplierProductInput, price }).success).toBe(false)
  })

  it.each(['EUR', 'USD', 'CHF', 'GBP'])('accepts currency %s', (currency) => {
    expect(supplierProductSchema.safeParse({ ...validSupplierProductInput, currency }).success).toBe(true)
  })

  it.each(['', 'eur', 'EURO', 'EU', '€', ' EUR'])('rejects currency %j', (currency) => {
    expect(supplierProductSchema.safeParse({ ...validSupplierProductInput, currency }).success).toBe(false)
  })

  it.each(['available', 'unavailable', 'unknown'])('accepts availability %s', (availability) => {
    expect(supplierProductSchema.safeParse({ ...validSupplierProductInput, availability }).success).toBe(true)
  })

  it.each(['in stock', '', true])('rejects availability %o', (availability) => {
    expect(supplierProductSchema.safeParse({ ...validSupplierProductInput, availability }).success).toBe(false)
  })

  it('rejects stock-only fields: catalog products are not owned stock', () => {
    expect(supplierProductSchema.safeParse({ ...validSupplierProductInput, quantity: 3 }).success).toBe(false)
    expect(
      supplierProductSchema.safeParse({ ...validSupplierProductInput, provenance: { source: 'manual' } }).success,
    ).toBe(false)
  })

  it('rejects invalid product URLs', () => {
    expect(supplierProductSchema.safeParse({ ...validSupplierProductInput, productUrl: 'not a url' }).success).toBe(
      false,
    )
  })
})
