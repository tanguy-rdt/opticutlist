import { describe, expect, it } from 'vitest'
import { supplierWebsiteInputSchema } from '../supplier-website'

describe('supplier website input', () => {
  it.each([
    ['leroymerlin.fr', 'https://leroymerlin.fr/'],
    ['www.leroymerlin.fr', 'https://www.leroymerlin.fr/'],
    ['https://leroymerlin.fr', 'https://leroymerlin.fr/'],
    ['https://www.leroymerlin.fr', 'https://www.leroymerlin.fr/'],
    ['http://leroymerlin.fr', 'http://leroymerlin.fr/'],
    ['  www.leroymerlin.fr  ', 'https://www.leroymerlin.fr/'],
    ['example.com:8443/panels?wood=oak#details', 'https://example.com:8443/panels?wood=oak#details'],
    ['http://example.com:8080/panels?wood=oak#details', 'http://example.com:8080/panels?wood=oak#details'],
    ['HTTPS://EXAMPLE.COM/panels', 'https://example.com/panels'],
    ['http://localhost:8080/catalog', 'http://localhost:8080/catalog'],
    ['müller.de', 'https://xn--mller-kva.de/'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(supplierWebsiteInputSchema.parse(input)).toBe(expected)
    expect(supplierWebsiteInputSchema.parse(expected)).toBe(expected)
  })
  it.each(['', '   '])('keeps the website optional for %j', input => {
    expect(supplierWebsiteInputSchema.parse(input)).toBeUndefined()
  })
  it.each(['hello', 'hello world', 'hello@example.com', 'https://bad..example.com', '-bad.example.com', 'example-.com', 'example_com.fr', 'https://', 'https:example.com', 'example.com:99999', 'ftp://example.com', 'javascript:alert(1)', 'mailto:hello@example.com', '//example.com', 'https://example.com\\path'])('rejects malformed or unsupported %j', input => {
    expect(supplierWebsiteInputSchema.safeParse(input).success).toBe(false)
  })
})
