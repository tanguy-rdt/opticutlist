import { describe, expect, it } from 'vitest'

import { supplierSchema } from '../supplier'
import { validSupplierInput, without } from './fixtures'

describe('supplierSchema', () => {
  it('accepts a valid supplier', () => {
    expect(supplierSchema.parse(validSupplierInput)).toEqual(validSupplierInput)
  })

  it('accepts a supplier without website', () => {
    expect(supplierSchema.parse(without(validSupplierInput, 'websiteUrl'))).toEqual({
      id: validSupplierInput.id,
      name: validSupplierInput.name,
    })
  })

  it.each(['id', 'name'] as const)('requires %s', (key) => {
    expect(supplierSchema.safeParse(without(validSupplierInput, key)).success).toBe(false)
  })

  it.each(['http://shop.example.com', 'https://shop.example.com/path?q=1'])('accepts website %s', (websiteUrl) => {
    expect(supplierSchema.safeParse({ ...validSupplierInput, websiteUrl }).success).toBe(true)
  })

  it.each(['', 'shop.example.com', '/relative', 'ftp://shop.example.com', 'javascript:alert(1)', null])(
    'rejects website %o',
    (websiteUrl) => {
      expect(supplierSchema.safeParse({ ...validSupplierInput, websiteUrl }).success).toBe(false)
    },
  )

  it('rejects unknown keys', () => {
    expect(supplierSchema.safeParse({ ...validSupplierInput, phone: '123' }).success).toBe(false)
  })
})
