import { z } from 'zod'
import { webUrlSchema } from '@/domain/model/common'

const domainLabel = /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i
/** Form input only: persisted records and transfers still require absolute HTTP(S) URLs. */
export const supplierWebsiteInputSchema = z.string().trim().transform((input, context) => {
  if (!input) {
    return undefined
  }
  const hostWithPort = /^[^:/?#\s]+:\d+(?:[/?#]|$)/.test(input)
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(input) && !hostWithPort
  const explicitHttp = /^https?:\/\//i.test(input)
  const invalid = () => {
    context.addIssue({ code: 'custom', message: 'Enter a valid domain name or HTTP(S) website URL.' })
    return z.NEVER
  }
  if (
    (hasScheme && !explicitHttp)
    || input.startsWith('//')
    || input.includes('\\')
    || (!explicitHttp && input.includes('@'))
  ) {
    return invalid()
  }
  const parsed = webUrlSchema.safeParse(explicitHttp ? input : `https://${input}`)
  if (!parsed.success) {
    return invalid()
  }
  const url = new URL(parsed.data)
  const hostname = url.hostname.replace(/\.$/, '')
  const ipv6 = hostname.startsWith('[') && hostname.endsWith(']')
  if (!ipv6 && (hostname.length > 253 || !hostname.split('.').every(label => domainLabel.test(label)))) {
    return invalid()
  }
  // Bare single words are not website domains; explicit URLs retain support for local hosts.
  if (!explicitHttp && !hostname.includes('.')) {
    return invalid()
  }
  return url.href
})
